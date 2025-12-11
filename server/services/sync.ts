import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { upsertStudent, deleteStudent, getStudent } from "./blobdb";

type Access = "public";
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

const baseDir = path.join(process.cwd(), "uploads", "blobdb");
fs.mkdirSync(baseDir, { recursive: true });

function hasBlobToken(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN
  );
}

function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
}

function localPath(key: string): string {
  return path.join(baseDir, key);
}

async function writeJSON(
  key: string,
  data: unknown,
  access: Access = "public"
): Promise<{ url: string }> {
  if (hasBlobToken()) {
    const token = getToken() as string;
    const body = Buffer.from(JSON.stringify(data));
    const { url } = await put(key, body, {
      access,
      token,
      contentType: "application/json",
    });
    return { url };
  }
  const p = localPath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data));
  return { url: p };
}

function readLocalJSON<T>(key: string): T | null {
  try {
    const p = localPath(key);
    const raw = fs.readFileSync(p, { encoding: "utf8" });
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const CHANGES_INDEX_KEY = "blobdb/index/changes.json";
const CHECKPOINT_KEY = "blobdb/index/checkpoint.json";

export async function getCheckpoint(): Promise<number> {
  if (!hasBlobToken()) {
    const val = readLocalJSON<{ last: number }>(CHECKPOINT_KEY);
    return val?.last || 0;
  }
  const val = readLocalJSON<{ last: number }>(CHECKPOINT_KEY);
  return val?.last || 0;
}

async function setCheckpoint(ts: number): Promise<void> {
  await writeJSON(CHECKPOINT_KEY, { last: ts });
}

export async function listChanges(
  since: number,
  limit = 1000
): Promise<ChangeIndexItem[]> {
  const idx = readLocalJSON<{ items: ChangeIndexItem[] }>(CHANGES_INDEX_KEY);
  const items = idx?.items || [];
  return items.filter((i) => i.ts > since).slice(0, limit);
}

async function appendChangeIndex(item: ChangeIndexItem): Promise<void> {
  const idx = readLocalJSON<{ items: ChangeIndexItem[] }>(
    CHANGES_INDEX_KEY
  ) || { items: [] };
  idx.items.push(item);
  await writeJSON(CHANGES_INDEX_KEY, idx);
  await setCheckpoint(item.ts);
}

export async function applyChanges(
  changes: Change[]
): Promise<{
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
    if (c.type === "upsert" && c.doc) {
      const doc = c.doc as Record<string, unknown>;
      const id = String(doc.id || c.id);
      const version = Number(doc.version || c.version || 1);
      const existing = await getStudent(id);
      const existingVersion = existing
        ? Number((existing as Record<string, unknown>).version || 0)
        : 0;
      if (existing && version <= existingVersion) {
        results.push({
          id,
          status: "conflict",
          latestVersion: existingVersion,
          latestDoc: existing as Record<string, unknown>,
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
      await appendChangeIndex({ ts, id, type: "upsert", url: res.url });
      results.push({ id, status: "ok" });
    } else if (c.type === "delete") {
      const id = c.id;
      await deleteStudent(id);
      await appendChangeIndex({ ts, id, type: "delete" });
      results.push({ id, status: "ok" });
    } else {
      results.push({ id: c.id, status: "skipped" });
    }
  }
  const checkpoint = await getCheckpoint();
  return { results, checkpoint };
}
