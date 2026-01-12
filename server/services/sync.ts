import { pool } from "../lib/db";
import { upsertStudent, deleteStudent, getStudent } from "./blobdb";

type ChangeType = "upsert" | "delete";
type Change = {
  id: string;
  type: ChangeType;
  doc?: Record<string, unknown>;
  version: number;
  clientId: string;
  timestamp: number;
};

type ChangeIndexItem = {
  ts: number;
  id: string;
  type: ChangeType;
  url?: string;
};

export async function getCheckpoint(): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT MAX(timestamp) as last FROM sync_changes"
    );
    return Number(rows[0]?.last || 0);
  } finally {
    client.release();
  }
}

export async function listChanges(
  since: number,
  limit = 1000
): Promise<ChangeIndexItem[]> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT entity_id as id, change_type as type, timestamp as ts FROM sync_changes WHERE timestamp > $1 ORDER BY timestamp ASC LIMIT $2",
      [since, limit]
    );
    // In SQL mode, we don't really have "url" for JSON blob anymore,
    // but we can construct one if the client relies on it to fetch individual docs.
    // However, the client pull logic seems to rely on ID.
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      ts: Number(r.ts),
      url: `/api/blobdb/students/${r.id}`, // Virtual URL
    }));
  } finally {
    client.release();
  }
}

async function appendChangeIndex(
  item: ChangeIndexItem,
  clientId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "INSERT INTO sync_changes (entity_id, change_type, timestamp, client_id) VALUES ($1, $2, $3, $4)",
      [item.id, item.type, item.ts, clientId]
    );
  } finally {
    client.release();
  }
}

export async function applyChanges(changes: Change[]): Promise<{
  results: Array<{
    id: string;
    status: string;
    latestVersion?: number;
    latestDoc?: Record<string, unknown>;
  }>;
  checkpoint: number;
}> {
  const results: Array<{
    id: string;
    status: string;
    latestVersion?: number;
    latestDoc?: Record<string, unknown>;
  }> = [];

  for (const c of changes) {
    const ts = c.timestamp || Date.now();
    console.info("[sync_apply]", {
      id: c.id,
      clientId: c.clientId,
      ts,
    });

    try {
      if (c.type === "upsert" && c.doc) {
        const doc = c.doc as Record<string, unknown>;
        const id = String(doc.id || c.id);
        const version = Number(doc.version || c.version || 1);

        const existing = await getStudent(id);
        const existingVersion = existing ? existing.version : 0;

        if (existing && version <= existingVersion) {
          results.push({
            id,
            status: "conflict",
            latestVersion: existingVersion,
            latestDoc: existing as unknown as Record<string, unknown>,
          });
          continue;
        }

        const res = await upsertStudent({
          id,
          surname: String(doc.surname || ""),
          firstName: String(doc.firstName || ""),
          middleName: String(doc.middleName || ""),
          gender: String(doc.gender || "Other"),
          dob: String(doc.dob || ""),
          guardianContact: String(doc.guardianContact || ""),
          class: String(doc.class || ""),
          status: String(doc.status || "Active"),
          version,
        });

        await appendChangeIndex(
          { ts, id, type: "upsert", url: res.url },
          c.clientId
        );
        results.push({ id, status: "ok" });
      } else if (c.type === "delete") {
        const id = c.id;
        await deleteStudent(id);
        await appendChangeIndex({ ts, id, type: "delete" }, c.clientId);
        results.push({ id, status: "ok" });
      } else {
        results.push({ id: c.id, status: "skipped" });
      }
    } catch (e) {
      console.error("[sync_apply_error]", e);
      results.push({ id: c.id, status: "error" });
    }
  }

  const checkpoint = await getCheckpoint();
  return { results, checkpoint };
}
