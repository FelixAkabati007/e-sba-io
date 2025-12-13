import fs from "fs";
import path from "path";
import { put } from "@vercel/blob";
import { EventEmitter } from "events";
import { supabaseAdmin } from "../lib/supabase";

// roles are validated at the router level
type ChangeType = "upsert" | "delete";

export type SheetMeta = {
  id: string;
  subject: string;
  assessmentType: string;
  dateISO: string;
  version: number;
  filename: string;
  contentType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  url?: string;
};

export type SheetDoc = SheetMeta & {
  rows?: Array<Record<string, unknown>>;
  cells?: Array<{
    addr: string;
    r: number;
    c: number;
    t?: string;
    v?: unknown;
    w?: string;
    f?: string;
    z?: string;
  }>;
};

export type Change = {
  id: string;
  type: ChangeType;
  version: number;
  clientId: string;
  timestamp: number;
  doc?: Partial<SheetDoc>;
};

type ApplyResult =
  | { id: string; status: "ok" }
  | {
      id: string;
      status: "conflict";
      latestVersion: number;
      latestDoc?: SheetDoc;
    };

const baseDir = path.join(process.cwd(), "uploads", "assessmentRepo");
const xlsxDir = path.join(baseDir, "xlsx");
const jsonDir = path.join(baseDir, "json");
const indexPath = path.join(baseDir, "index.json");
const backupDir = path.join(baseDir, "backups");
fs.mkdirSync(xlsxDir, { recursive: true });
fs.mkdirSync(jsonDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

const emitter = new EventEmitter();

function now(): number {
  return Date.now();
}
function fmtDate(dt: number): string {
  return new Date(dt).toISOString().split("T")[0];
}
export function makeName(
  subject: string,
  assessmentType: string,
  dateISO?: string
): string {
  const s = subject.replace(/[^a-zA-Z0-9-_]/g, "_");
  const a = assessmentType.replace(/[^a-zA-Z0-9-_]/g, "_");
  const d = dateISO || fmtDate(now());
  return `${s}_${a}_${d}`;
}

function readIndex(): Record<string, SheetMeta> {
  try {
    const raw = fs.readFileSync(indexPath, { encoding: "utf8" });
    const idx = JSON.parse(raw) as Record<string, SheetMeta>;
    return idx;
  } catch {
    return {};
  }
}

function writeIndex(idx: Record<string, SheetMeta>): void {
  fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2), {
    encoding: "utf8",
  });
}

export function onChange(cb: (c: Change) => void): void {
  emitter.on("change", cb);
}

function hasBlobToken(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN
  );
}
function getToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
}

export async function storeXLSX(
  subject: string,
  assessmentType: string,
  buf: Buffer,
  dateISO?: string
): Promise<SheetMeta> {
  const name = makeName(subject, assessmentType, dateISO);
  const filename = `${name}.xlsx`;
  const p = path.join(xlsxDir, filename);
  fs.writeFileSync(p, buf);
  let url: string | undefined;
  if (hasBlobToken()) {
    const token = getToken() as string;
    const res = await put(`assessmentRepo/${filename}`, buf, {
      access: "public",
      token,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    url = res.url;
  }
  const idx = readIndex();
  const id = name;
  const ts = now();
  const meta: SheetMeta = {
    id,
    subject,
    assessmentType,
    dateISO: dateISO || fmtDate(ts),
    version: (idx[id]?.version || 0) + 1,
    filename,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: buf.length,
    createdAt: idx[id]?.createdAt || ts,
    updatedAt: ts,
    url,
  };
  idx[id] = meta;
  writeIndex(idx);
  await audit("upload_xlsx", { id, filename, size: buf.length });
  emitter.emit("change", {
    id,
    type: "upsert",
    version: meta.version,
    clientId: "server",
    timestamp: ts,
  });
  return meta;
}

export async function putJSON(doc: SheetDoc): Promise<SheetMeta> {
  const idx = readIndex();
  const id = doc.id;
  const latest = idx[id];
  const ts = now();
  const nextVersion = (latest?.version || 0) + 1;
  const meta: SheetMeta = {
    id,
    subject: doc.subject,
    assessmentType: doc.assessmentType,
    dateISO: doc.dateISO,
    version: nextVersion,
    filename: `${id}.json`,
    contentType: "application/json",
    size: Buffer.byteLength(JSON.stringify(doc)),
    createdAt: latest?.createdAt || ts,
    updatedAt: ts,
    url: latest?.url,
  };
  fs.writeFileSync(path.join(jsonDir, meta.filename), JSON.stringify(doc));
  idx[id] = meta;
  writeIndex(idx);
  await audit("upsert_json", { id, version: nextVersion });
  emitter.emit("change", {
    id,
    type: "upsert",
    version: nextVersion,
    clientId: "server",
    timestamp: ts,
    doc,
  });
  return meta;
}

export function getJSON(id: string): SheetDoc | null {
  try {
    const p = path.join(jsonDir, `${id}.json`);
    const raw = fs.readFileSync(p, { encoding: "utf8" });
    const doc = JSON.parse(raw) as SheetDoc;
    return doc;
  } catch {
    return null;
  }
}

export function list(
  filter?: Partial<{
    subject: string;
    assessmentType: string;
    dateFrom: string;
    dateTo: string;
  }>
): SheetMeta[] {
  const idx = readIndex();
  const items = Object.values(idx);
  const f = filter || {};
  return items
    .filter((m) => {
      if (f.subject && m.subject !== f.subject) return false;
      if (f.assessmentType && m.assessmentType !== f.assessmentType)
        return false;
      if (f.dateFrom && m.dateISO < f.dateFrom) return false;
      if (f.dateTo && m.dateISO > f.dateTo) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function applyChanges(
  changes: Change[]
): Promise<{ results: ApplyResult[] }> {
  const idx = readIndex();
  const results: ApplyResult[] = [];
  for (const c of changes) {
    const latest = idx[c.id];
    if (c.type === "delete") {
      if (latest) {
        delete idx[c.id];
        writeIndex(idx);
        await audit("delete_sheet", { id: c.id });
        emitter.emit("change", c);
        results.push({ id: c.id, status: "ok" });
      } else {
        results.push({ id: c.id, status: "ok" });
      }
      continue;
    }
    if (latest && c.version < latest.version) {
      results.push({
        id: c.id,
        status: "conflict",
        latestVersion: latest.version,
        latestDoc: getJSON(c.id) || undefined,
      });
      continue;
    }
    const next = {
      ...(getJSON(c.id) || {}),
      ...(c.doc || {}),
      id: c.id,
    } as SheetDoc;
    await putJSON(next);
    results.push({ id: c.id, status: "ok" });
  }
  return { results };
}

export async function backupIndex(): Promise<{
  ok: boolean;
  url?: string;
  path?: string;
}> {
  const ts = new Date().toISOString().replace(/[:.]/g, "_");
  const fname = `index_${ts}.json`;
  const raw = JSON.stringify(readIndex(), null, 2);
  if (hasBlobToken()) {
    const token = getToken() as string;
    const { url } = await put(`assessmentRepo/backups/${fname}`, raw, {
      access: "public",
      token,
      contentType: "application/json",
    });
    await audit("backup_index", { url });
    return { ok: true, url };
  }
  const p = path.join(backupDir, fname);
  fs.writeFileSync(p, raw, { encoding: "utf8" });
  await audit("backup_index", { path: p });
  return { ok: true, path: p };
}

export async function audit(event: string, detail?: unknown): Promise<void> {
  try {
    if (supabaseAdmin) {
      await supabaseAdmin.from("audit_logs").insert({ event, detail });
    } else {
      const p = path.join(baseDir, "audit_events.log");
      const line =
        JSON.stringify({ at: new Date().toISOString(), event, detail }) + "\n";
      fs.appendFileSync(p, line);
    }
  } catch {
    // ignore audit failures
  }
}
