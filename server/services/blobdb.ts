import fs from "fs";
import path from "path";
import { put } from "@vercel/blob";

type Access = "public";

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

export async function putJSON(
  key: string,
  data: unknown,
  access: Access = "public"
): Promise<{ url: string }> {
  const body = Buffer.from(JSON.stringify(data));
  if (hasBlobToken()) {
    const token = getToken() as string;
    const { url } = await put(key, body, {
      access,
      token,
      contentType: "application/json",
    });
    return { url };
  }
  const p = localPath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return { url: p };
}

export async function getJSONByURL(urlOrPath: string): Promise<unknown | null> {
  try {
    if (urlOrPath.startsWith("http")) {
      const resp = await fetch(urlOrPath);
      if (!resp.ok) return null;
      return await resp.json();
    }
    const raw = fs.readFileSync(urlOrPath, { encoding: "utf8" });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getJSONByKey(key: string): Promise<unknown | null> {
  if (hasBlobToken()) {
    return null;
  }
  const p = localPath(key);
  try {
    const raw = fs.readFileSync(p, { encoding: "utf8" });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type StudentDoc = {
  id: string;
  surname: string;
  firstName: string;
  middleName?: string;
  gender: string;
  dob: string;
  guardianContact?: string;
  class: string;
  status: string;
  version: number;
};

type IndexDoc<T> = { items: Array<T> };

const INDEX_STUDENTS = "blobdb/index/students.json";

export async function listStudents(): Promise<
  Array<{ id: string; url?: string }>
> {
  const idx = (await getJSONByKey(INDEX_STUDENTS)) as IndexDoc<{
    id: string;
    url?: string;
  }> | null;
  return idx?.items || [];
}

async function writeStudentsIndex(
  items: Array<{ id: string; url?: string }>
): Promise<void> {
  await putJSON(INDEX_STUDENTS, { items });
}

export async function upsertStudent(
  doc: StudentDoc
): Promise<{ id: string; url: string }> {
  const key = `blobdb/students/${doc.id}.json`;
  const existingIdx = await listStudents();
  const { url } = await putJSON(key, doc);
  const found = existingIdx.find((i) => i.id === doc.id);
  if (found) {
    found.url = url;
  } else {
    existingIdx.push({ id: doc.id, url });
  }
  await writeStudentsIndex(existingIdx);
  return { id: doc.id, url };
}

export async function getStudent(id: string): Promise<StudentDoc | null> {
  const items = await listStudents();
  const found = items.find((i) => i.id === id);
  if (found?.url) {
    const json = await getJSONByURL(found.url);
    return (json as StudentDoc) || null;
  }
  if (!hasBlobToken()) {
    const json = await getJSONByKey(`blobdb/students/${id}.json`);
    return (json as StudentDoc) || null;
  }
  return null;
}

export async function deleteStudent(id: string): Promise<boolean> {
  const items = await listStudents();
  const next = items.filter((i) => i.id !== id);
  await writeStudentsIndex(next);
  const p = localPath(`blobdb/students/${id}.json`);
  try {
    fs.unlinkSync(p);
  } catch {
    void 0;
  }
  return true;
}

export async function snapshotAll(): Promise<{
  ok: boolean;
  indexURL: string;
}> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const snapIndexKey = `blobdb/backups/${ts}/index/students.json`;
  const items = await listStudents();
  const { url } = await putJSON(snapIndexKey, { items });
  return { ok: true, indexURL: url };
}
