import * as XLSX from "xlsx";
import type { PoolClient } from "pg";

export type Row = {
  student_id: string;
  cat1: number;
  cat2: number;
  cat3: number;
  cat4: number;
  group: number;
  project: number;
  exam: number;
};

const clamp = (f: string, n: number) => {
  const v = Number.isFinite(n) ? n : 0;
  if (f === "exam") return Math.max(0, Math.min(100, v));
  if (f === "group" || f === "project") return Math.max(0, Math.min(20, v));
  if (["cat1", "cat2", "cat3", "cat4"].includes(f))
    return Math.max(0, Math.min(10, v));
  return Math.max(0, v);
};

export async function parseAssessmentSheet(
  filePath: string
): Promise<{ rows: Row[]; errors: string[] }> {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
  const errors: string[] = [];
  const required = [
    "student_id",
    "cat1",
    "cat2",
    "cat3",
    "cat4",
    "group",
    "project",
    "exam",
  ] as const;
  const normalizeKey = (k: string): string =>
    k
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, "_")
      .replace(/__+/g, "_")
      .replace(/^_+|_+$/g, "");
  const alias: Record<string, string> = {
    studentid: "student_id",
    student_id: "student_id",
    id: "student_id",
    cat1_score: "cat1",
    cat2_score: "cat2",
    cat3_score: "cat3",
    cat4_score: "cat4",
    group_work: "group",
    group_work_score: "group",
    project_work: "project",
    project_work_score: "project",
    exam_score: "exam",
  };
  const mapKey = (raw: string): string => {
    const n = normalizeKey(raw);
    return alias[n] || n;
  };
  const keys = json[0] ? Object.keys(json[0]).map((k) => mapKey(k)) : [];
  const missing = required.filter((k) => !keys.includes(k));
  if (missing.length) errors.push(`Missing columns: ${missing.join(", ")}`);
  const rows: Row[] = json
    .map((r, i) => {
      const lower: Record<string, unknown> = {};
      Object.keys(r).forEach(
        (k) => (lower[mapKey(k)] = (r as Record<string, unknown>)[k])
      );
      const student_id = String(lower["student_id"] || "").trim();
      const fields = [
        "cat1",
        "cat2",
        "cat3",
        "cat4",
        "group",
        "project",
        "exam",
      ] as const;
      const base: Partial<Row> = { student_id };
      fields.forEach((f) => {
        const raw = parseFloat(String(lower[f] ?? ""));
        if (!Number.isFinite(raw))
          errors.push(`Row ${i + 2}: ${f} is not a number`);
        const n = clamp(f, Number.isFinite(raw) ? raw : 0);
        base[f] = n;
      });
      if (!student_id) errors.push(`Row ${i + 2}: missing student_id`);
      return base as Row;
    })
    .filter((r) => !!r.student_id);
  return { rows, errors };
}

export async function ensureSession(
  client: PoolClient,
  academicYear: string,
  term: string
): Promise<number> {
  const { rows } = await client.query(
    "SELECT session_id FROM academic_sessions WHERE academic_year=$1 AND term=$2 LIMIT 1",
    [academicYear, term]
  );
  if (rows.length) return rows[0].session_id;
  const { rows: insRows } = await client.query(
    "INSERT INTO academic_sessions (academic_year, term, is_active) VALUES ($1, $2, FALSE) RETURNING session_id",
    [academicYear, term]
  );
  return insRows[0].session_id;
}

export async function saveMarksTransaction(
  client: PoolClient,
  subjectName: string,
  academicYear: string,
  term: string,
  rows: Row[]
): Promise<void> {
  await client.query("BEGIN");
  try {
    const { rows: subRows } = await client.query(
      "SELECT subject_id FROM subjects WHERE subject_name=$1 LIMIT 1",
      [subjectName]
    );
    if (!subRows.length) throw new Error("Subject not found");
    const subject_id = subRows[0].subject_id;
    const session_id = await ensureSession(client, academicYear, term);

    for (const r of rows) {
      await client.query(
        `INSERT INTO assessments (student_id, subject_id, session_id, cat1_score, cat2_score, cat3_score, cat4_score, group_work_score, project_work_score, exam_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (student_id, subject_id, session_id) DO UPDATE SET
           cat1_score=EXCLUDED.cat1_score,
           cat2_score=EXCLUDED.cat2_score,
           cat3_score=EXCLUDED.cat3_score,
           cat4_score=EXCLUDED.cat4_score,
           group_work_score=EXCLUDED.group_work_score,
           project_work_score=EXCLUDED.project_work_score,
           exam_score=EXCLUDED.exam_score,
           updated_at=NOW()`,
        [
          r.student_id,
          subject_id,
          session_id,
          r.cat1,
          r.cat2,
          r.cat3,
          r.cat4,
          r.group,
          r.project,
          r.exam,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

export async function getSubjectMarks(
  client: PoolClient,
  className: string,
  subjectName: string,
  academicYear: string,
  term: string
): Promise<Row[]> {
  // First ensure session exists to get ID (or just get it)
  const sessionId = await ensureSession(client, academicYear, term);

  // Use the stored procedure or a direct query
  // The SP sp_get_subject_sheet returns what we need
  const { rows } = await client.query(
    "SELECT * FROM sp_get_subject_sheet($1, $2, $3)",
    [className, subjectName, sessionId]
  );

  return rows.map((r) => ({
    student_id: r.student_id,
    cat1: Number(r.cat1_score || 0),
    cat2: Number(r.cat2_score || 0),
    cat3: Number(r.cat3_score || 0),
    cat4: Number(r.cat4_score || 0),
    group: Number(r.group_work_score || 0),
    project: Number(r.project_work_score || 0),
    exam: Number(r.exam_score || 0),
  }));
}
