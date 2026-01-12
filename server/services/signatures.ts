import fs from "fs";
import path from "path";
import crypto from "crypto";
import { imageSize } from "image-size";
import { pool } from "../lib/db";

const baseDir = path.join(process.cwd(), "uploads", "signatures");
fs.mkdirSync(baseDir, { recursive: true });

/**
 * Signature metadata stored for versioning and retrieval.
 * When the database is unavailable, a file-based fallback (meta.json) is used.
 */
type SignatureMeta = {
  id: string;
  filename: string;
  url: string;
  academicYear: string;
  term: string;
  uploadedAt: number;
  width?: number;
  height?: number;
  enabled: boolean;
  version?: number;
};

const metaPath = path.join(baseDir, "meta.json");

function readMeta(): SignatureMeta[] {
  try {
    if (!fs.existsSync(metaPath)) return [];
    const buf = fs.readFileSync(metaPath, "utf8");
    return JSON.parse(buf) as SignatureMeta[];
  } catch {
    return [];
  }
}

function writeMeta(list: SignatureMeta[]) {
  fs.writeFileSync(metaPath, JSON.stringify(list, null, 2), "utf8");
}

async function ensureTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS signatures (
      id VARCHAR(64) PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      url VARCHAR(255) NOT NULL,
      academicYear VARCHAR(32) NOT NULL,
      term VARCHAR(32) NOT NULL,
      uploadedAt BIGINT NOT NULL,
      width INT NULL,
      height INT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      version INT NOT NULL
    )`
  );
}

async function nextVersion(
  academicYear: string,
  term: string
): Promise<number> {
  await ensureTable();
  const { rows } = await pool.query<{ v: number }>(
    "SELECT COALESCE(MAX(version),0) AS v FROM signatures WHERE academicYear=$1 AND term=$2",
    [academicYear, term]
  );
  const v = rows[0]?.v ?? 0;
  return v + 1;
}

export async function storeSignature(
  filePath: string,
  academicYear: string,
  term: string
): Promise<SignatureMeta> {
  const id = crypto.randomUUID();
  const ext = path.extname(filePath).toLowerCase();
  const safeName = `${Date.now()}_${id}${ext}`;
  const dest = path.join(baseDir, safeName);
  fs.renameSync(filePath, dest);
  let width: number | undefined;
  let height: number | undefined;
  try {
    const dim = imageSize(dest);
    width = dim.width;
    height = dim.height;
  } catch {
    width = undefined;
    height = undefined;
  }
  const url = `/uploads/signatures/${safeName}`;
  const meta: SignatureMeta = {
    id,
    filename: safeName,
    url,
    academicYear,
    term,
    uploadedAt: Date.now(),
    width,
    height,
    enabled: true,
  };
  // Primary: write to DB with versioning; Fallback: write to file meta.json
  try {
    const version = await nextVersion(academicYear, term);
    meta.version = version;
    await ensureTable();
    await pool.query(
      "INSERT INTO signatures (id, filename, url, academicYear, term, uploadedAt, width, height, enabled, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        meta.id,
        meta.filename,
        meta.url,
        meta.academicYear,
        meta.term,
        meta.uploadedAt,
        meta.width ?? null,
        meta.height ?? null,
        meta.enabled,
        meta.version,
      ]
    );
  } catch {
    const list = readMeta();
    const prev = list.filter(
      (s) => s.academicYear === academicYear && s.term === term
    );
    meta.version =
      (prev.length ? Math.max(...prev.map((p) => p.version || 0)) : 0) + 1;
    list.push(meta);
    writeMeta(list);
  }
  return meta;
}

export async function listSignatures(
  academicYear?: string,
  term?: string
): Promise<SignatureMeta[]> {
  try {
    await ensureTable();
    const params: Array<string> = [];
    const where: string[] = [];
    if (academicYear) {
      where.push("academicYear=$" + (params.length + 1));
      params.push(academicYear);
    }
    if (term) {
      where.push("term=$" + (params.length + 1));
      params.push(term);
    }
    const sql = `SELECT * FROM signatures${
      where.length ? " WHERE " + where.join(" AND ") : ""
    } ORDER BY uploadedAt DESC`;
    const { rows } = await pool.query(sql, params);
    return (rows as unknown as SignatureMeta[]).map((r) => ({
      ...r,
      enabled: !!(r as unknown as { enabled: boolean }).enabled,
    }));
  } catch {
    const list = readMeta();
    return list.filter(
      (s) =>
        (!academicYear || s.academicYear === academicYear) &&
        (!term || s.term === term)
    );
  }
}

export async function setSignatureEnabled(
  id: string,
  enabled: boolean
): Promise<SignatureMeta | undefined> {
  try {
    await ensureTable();
    await pool.query("UPDATE signatures SET enabled=$1 WHERE id=$2", [
      enabled,
      id,
    ]);
    const { rows } = await pool.query<SignatureMeta[]>(
      "SELECT * FROM signatures WHERE id=$1",
      [id]
    );
    if (!rows.length) return undefined;
    const meta = rows[0] as unknown as SignatureMeta;
    meta.enabled = !!(meta as unknown as { enabled: boolean }).enabled;
    return meta;
  } catch {
    const list = readMeta();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return undefined;
    list[idx].enabled = enabled;
    writeMeta(list);
    return list[idx];
  }
}

export async function getCurrentSignature(
  academicYear: string,
  term: string
): Promise<SignatureMeta | undefined> {
  try {
    await ensureTable();
    const { rows } = await pool.query<SignatureMeta[]>(
      "SELECT * FROM signatures WHERE academicYear=$1 AND term=$2 AND enabled=true ORDER BY uploadedAt DESC LIMIT 1",
      [academicYear, term]
    );
    if (!rows.length) return undefined;
    const meta = rows[0] as unknown as SignatureMeta;
    meta.enabled = !!(meta as unknown as { enabled: boolean }).enabled;
    return meta;
  } catch {
    const list = await listSignatures(academicYear, term);
    const filtered = list
      .filter((s) => s.enabled)
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
    return filtered[0];
  }
}
