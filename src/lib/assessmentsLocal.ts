import {
  list,
  getData,
  saveDownloadedContent,
  remove,
  getUsage,
} from "./storage";
import { logger } from "./logger";

export type AssessmentScores = {
  student_id: string;
  cat1: number;
  cat2: number;
  cat3: number;
  cat4: number;
  group: number;
  project: number;
  exam: number;
};

export type AssessmentRecord = {
  id?: string;
  subject: string;
  subjectId?: string;
  assessmentType: string;
  results: AssessmentScores[];
  timestamp: number;
  metadata?: Record<string, unknown>;
  version?: number;
};

function clamp(field: keyof AssessmentScores, n: number): number {
  const v = Number.isFinite(n) ? n : 0;
  if (field === "exam") return Math.max(0, Math.min(100, v));
  if (field === "group" || field === "project")
    return Math.max(0, Math.min(20, v));
  if (["cat1", "cat2", "cat3", "cat4"].includes(field))
    return Math.max(0, Math.min(10, v));
  return Math.max(0, v);
}

function normalize(rec: AssessmentRecord): AssessmentRecord {
  const subject = String(rec.subject || "").trim();
  const assessmentType = String(rec.assessmentType || "").trim();
  const timestamp = Number(rec.timestamp || Date.now());
  const subjectId =
    typeof rec.subjectId === "string" && rec.subjectId.trim()
      ? rec.subjectId.trim()
      : undefined;
  const metadata =
    rec.metadata && typeof rec.metadata === "object" ? rec.metadata : undefined;
  const results: AssessmentScores[] = Array.isArray(rec.results)
    ? rec.results
        .map((r) => ({
          student_id: String(r.student_id || "").trim(),
          cat1: clamp("cat1", Number(r.cat1)),
          cat2: clamp("cat2", Number(r.cat2)),
          cat3: clamp("cat3", Number(r.cat3)),
          cat4: clamp("cat4", Number(r.cat4)),
          group: clamp("group", Number(r.group)),
          project: clamp("project", Number(r.project)),
          exam: clamp("exam", Number(r.exam)),
        }))
        .filter((r) => !!r.student_id)
    : [];
  const version = typeof rec.version === "number" ? rec.version : undefined;
  return {
    id: rec.id,
    subject,
    subjectId,
    assessmentType,
    results,
    timestamp,
    metadata,
    version,
  };
}

function isValid(rec: AssessmentRecord): boolean {
  if (!rec.subject || !rec.assessmentType) return false;
  if (!Array.isArray(rec.results) || rec.results.length === 0) return false;
  if (!Number.isFinite(rec.timestamp)) return false;
  for (const r of rec.results) {
    if (!r.student_id) return false;
    const fields: (keyof AssessmentScores)[] = [
      "cat1",
      "cat2",
      "cat3",
      "cat4",
      "group",
      "project",
      "exam",
    ];
    for (const f of fields) {
      if (!Number.isFinite(r[f])) return false;
    }
  }
  return true;
}

function makeName(rec: AssessmentRecord): string {
  return `assessment_${rec.subject}_${rec.assessmentType}_${rec.timestamp}.json`;
}

function tagsFor(rec: AssessmentRecord): string[] {
  const out = ["assessment", rec.subject, rec.assessmentType];
  return Array.from(new Set(out));
}

async function findExistingIdByName(name: string): Promise<string | undefined> {
  const metas = await list({ tag: "assessment" });
  const m = metas.find((m) => (m.name || "") === name);
  return m?.id;
}

export async function saveAssessment(
  rec: AssessmentRecord,
  options?: { encrypt?: boolean; passphrase?: string; compress?: boolean }
): Promise<{ id: string }> {
  const norm = normalize(rec);
  if (!isValid(norm)) throw new Error("Invalid assessment record");
  const name = makeName(norm);
  const tags = tagsFor(norm);
  const existingId = await findExistingIdByName(name);
  const payload = JSON.stringify(norm);
  const pass = options?.encrypt ? options?.passphrase : undefined;
  const { id } = await saveDownloadedContent(
    existingId,
    payload,
    "application/json",
    tags,
    pass,
    options?.compress,
    name
  );
  return { id };
}

export async function getAssessmentsBySubject(
  subject: string,
  passphrase?: string
): Promise<AssessmentRecord[]> {
  const metas = await list({ tag: "assessment" });
  const ids = metas
    .filter((m) => (m.tags || []).includes("assessment"))
    .filter((m) => (m.tags || []).includes(subject))
    .map((m) => m.id);
  const out: AssessmentRecord[] = [];
  for (const id of ids) {
    try {
      const got = await getData(id, passphrase);
      if (!got) continue;
      const json =
        typeof got.data === "string"
          ? got.data
          : new TextDecoder().decode(got.data as ArrayBuffer);
      const rec = normalize(JSON.parse(json) as AssessmentRecord);
      if (isValid(rec)) out.push({ ...rec, id });
    } catch (e) {
      logger.warn("assessment_load_failed", e);
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getAssessment(
  id: string,
  passphrase?: string
): Promise<AssessmentRecord | null> {
  try {
    const got = await getData(id, passphrase);
    if (!got) return null;
    const json =
      typeof got.data === "string"
        ? got.data
        : new TextDecoder().decode(got.data as ArrayBuffer);
    const rec = normalize(JSON.parse(json) as AssessmentRecord);
    return isValid(rec) ? { ...rec, id } : null;
  } catch (e) {
    logger.warn("assessment_get_failed", e);
    return null;
  }
}

export async function updateAssessment(
  id: string,
  patch: Partial<AssessmentRecord>,
  options?: { encrypt?: boolean; passphrase?: string; compress?: boolean }
): Promise<{ id: string }> {
  const current = await getAssessment(id, options?.passphrase);
  if (!current) throw new Error("Assessment not found");
  const next = normalize({
    ...current,
    ...patch,
    id,
    subject: patch.subject ?? current.subject,
    assessmentType: patch.assessmentType ?? current.assessmentType,
    timestamp: patch.timestamp ?? current.timestamp,
    results: patch.results ?? current.results,
  });
  if (!isValid(next)) throw new Error("Invalid assessment record");
  const name = makeName(next);
  const tags = tagsFor(next);
  const payload = JSON.stringify(next);
  const pass = options?.encrypt ? options?.passphrase : undefined;
  const res = await saveDownloadedContent(
    id,
    payload,
    "application/json",
    tags,
    pass,
    options?.compress,
    name
  );
  return { id: res.id };
}

export async function deleteAssessment(id: string): Promise<void> {
  await remove(id);
}

export async function exportAssessments(
  subject?: string,
  passphrase?: string
): Promise<{
  items: Array<{
    id: string;
    name?: string;
    record?: AssessmentRecord;
    raw?: string;
  }>;
}> {
  const metas = await list({ tag: "assessment" });
  const filtered = subject
    ? metas.filter((m) => (m.tags || []).includes(subject))
    : metas;
  const items: Array<{
    id: string;
    name?: string;
    record?: AssessmentRecord;
    raw?: string;
  }> = [];
  for (const m of filtered) {
    try {
      const got = await getData(m.id, passphrase);
      if (!got) continue;
      const json =
        typeof got.data === "string"
          ? got.data
          : new TextDecoder().decode(got.data as ArrayBuffer);
      const rec = normalize(JSON.parse(json) as AssessmentRecord);
      if (isValid(rec))
        items.push({ id: m.id, name: m.name, record: { ...rec, id: m.id } });
      else items.push({ id: m.id, name: m.name, raw: json });
    } catch (e) {
      logger.warn("assessment_export_failed", e);
    }
  }
  return { items };
}

export async function importAssessments(
  records: AssessmentRecord[],
  options?: { encrypt?: boolean; passphrase?: string; compress?: boolean }
): Promise<{ saved: number; errors: number }> {
  let saved = 0;
  let errors = 0;
  for (const rec of records) {
    try {
      await saveAssessment(rec, options);
      saved++;
    } catch (e) {
      logger.warn("assessment_import_failed", e);
      errors++;
    }
  }
  return { saved, errors };
}

export async function checkIntegrity(): Promise<{
  valid: number;
  invalid: number;
  issues: string[];
}> {
  const metas = await list({ tag: "assessment" });
  let valid = 0;
  let invalid = 0;
  const issues: string[] = [];
  for (const m of metas) {
    try {
      const got = await getData(m.id);
      if (!got) {
        invalid++;
        issues.push(`missing:${m.id}`);
        continue;
      }
      const json =
        typeof got.data === "string"
          ? got.data
          : new TextDecoder().decode(got.data as ArrayBuffer);
      const rec = normalize(JSON.parse(json) as AssessmentRecord);
      if (isValid(rec)) valid++;
      else {
        invalid++;
        issues.push(`invalid:${m.id}`);
      }
    } catch {
      invalid++;
      issues.push(`error:${m.id}`);
    }
  }
  return { valid, invalid, issues };
}

export async function shouldWarnLowStorage(
  thresholdPct = 0.8
): Promise<boolean> {
  const usage = await getUsage();
  if (
    typeof usage.quota === "number" &&
    typeof usage.usage === "number" &&
    usage.quota > 0
  ) {
    return usage.usage / usage.quota >= thresholdPct;
  }
  return usage.lsBytes >= 4 * 1024 * 1024;
}

export async function clearAllAssessments(subject?: string): Promise<number> {
  const metas = await list({ tag: "assessment" });
  const filtered = subject
    ? metas.filter((m) => (m.tags || []).includes(subject))
    : metas;
  for (const m of filtered) {
    try {
      await remove(m.id);
    } catch {
      void 0;
    }
  }
  return filtered.length;
}
