import * as XLSX from "xlsx";
import type { PoolConnection } from "mysql2/promise";
import type { ResultSetHeader } from "mysql2";

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
  if (["cat1", "cat2", "cat3", "cat4"].includes(f)) return Math.max(0, Math.min(10, v));
  return Math.max(0, v);
};

export async function parseAssessmentSheet(filePath: string): Promise<{ rows: Row[]; errors: string[] }> {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
  const errors: string[] = [];
  const rows: Row[] = json.map((r, i) => {
    const lower: Record<string, unknown> = {};
    Object.keys(r).forEach((k) => (lower[k.toLowerCase().trim()] = (r as Record<string, unknown>)[k]));
    const student_id = String(lower["student_id"] || lower["id"] || "").trim();
    const fields = ["cat1", "cat2", "cat3", "cat4", "group", "project", "exam"] as const;
    const base: Partial<Row> = { student_id };
    fields.forEach((f) => {
      const n = clamp(f, parseFloat(String(lower[f] ?? 0)) || 0);
      base[f] = n;
    });
    if (!student_id) errors.push(`Row ${i + 2}: missing student_id`);
    return base as Row;
  }).filter((r) => !!r.student_id);
  return { rows, errors };
}

async function ensureSession(conn: PoolConnection, academicYear: string, term: string): Promise<number> {
  const [rows] = await conn.query("SELECT session_id FROM academic_sessions WHERE academic_year=? AND term=? LIMIT 1", [academicYear, term]);
  const arr = rows as Array<{ session_id: number }>;
  if (arr.length) return arr[0].session_id;
  const [res] = await conn.query<ResultSetHeader>(
    "INSERT INTO academic_sessions (academic_year, term, is_active) VALUES (?, ?, FALSE)",
    [academicYear, term]
  );
  return res.insertId as number;
}

export async function saveMarksTransaction(conn: PoolConnection, subjectName: string, academicYear: string, term: string, rows: Row[]): Promise<void> {
  await conn.beginTransaction();
  try {
    const [subRows] = await conn.query("SELECT subject_id FROM subjects WHERE subject_name=? LIMIT 1", [subjectName]);
    const sArr = subRows as Array<{ subject_id: number }>;
    if (!sArr.length) throw new Error("Subject not found");
    const subject_id = sArr[0].subject_id;
    const session_id = await ensureSession(conn, academicYear, term);

    for (const r of rows) {
      await conn.query(
        `INSERT INTO assessments (student_id, subject_id, session_id, cat1_score, cat2_score, cat3_score, cat4_score, group_work_score, project_work_score, exam_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE cat1_score=VALUES(cat1_score), cat2_score=VALUES(cat2_score), cat3_score=VALUES(cat3_score), cat4_score=VALUES(cat4_score), group_work_score=VALUES(group_work_score), project_work_score=VALUES(project_work_score), exam_score=VALUES(exam_score)`,
        [r.student_id, subject_id, session_id, r.cat1, r.cat2, r.cat3, r.cat4, r.group, r.project, r.exam]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  }
}
