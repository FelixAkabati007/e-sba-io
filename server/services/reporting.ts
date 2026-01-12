import { pool } from "../lib/db";
import { ensureSession } from "./assessments";

export async function saveTalent(
  studentId: string,
  academicYear: string,
  term: string,
  data: { talent?: string; teacher?: string; head?: string },
  userId?: number
) {
  const client = await pool.connect();
  try {
    const sessionId = await ensureSession(client, academicYear, term);

    // 1. Archive existing record if it exists
    const { rows: existing } = await client.query(
      "SELECT * FROM talent_interests WHERE student_id = $1 AND session_id = $2",
      [studentId, sessionId]
    );

    if (existing.length > 0) {
      const rec = existing[0];
      await client.query(
        `INSERT INTO talent_interests_history 
         (record_id, student_id, session_id, talent_remark, class_teacher_remark, head_teacher_remark, changed_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          rec.record_id,
          rec.student_id,
          rec.session_id,
          rec.talent_remark,
          rec.class_teacher_remark,
          rec.head_teacher_remark,
          userId || null,
        ]
      );
    }

    // 2. Upsert new data
    await client.query(
      `INSERT INTO talent_interests (student_id, session_id, talent_remark, class_teacher_remark, head_teacher_remark)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, session_id) DO UPDATE SET
       talent_remark = COALESCE($3, talent_interests.talent_remark),
       class_teacher_remark = COALESCE($4, talent_interests.class_teacher_remark),
       head_teacher_remark = COALESCE($5, talent_interests.head_teacher_remark),
       updated_at = NOW()`,
      [
        studentId,
        sessionId,
        data.talent || null,
        data.teacher || null,
        data.head || null,
      ]
    );
  } finally {
    client.release();
  }
}

export async function getTalent(
  studentId: string,
  academicYear: string,
  term: string
) {
  const client = await pool.connect();
  try {
    const sessionId = await ensureSession(client, academicYear, term);
    const { rows } = await client.query(
      "SELECT talent_remark, class_teacher_remark, head_teacher_remark FROM talent_interests WHERE student_id=$1 AND session_id=$2",
      [studentId, sessionId]
    );
    return rows[0] || {};
  } finally {
    client.release();
  }
}

export async function saveAttendance(
  studentId: string,
  academicYear: string,
  term: string,
  present: number,
  total: number
) {
  const client = await pool.connect();
  try {
    const sessionId = await ensureSession(client, academicYear, term);
    await client.query(
      `INSERT INTO attendance (student_id, session_id, days_present, days_total)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, session_id) DO UPDATE SET
       days_present = EXCLUDED.days_present,
       days_total = EXCLUDED.days_total,
       updated_at = NOW()`,
      [studentId, sessionId, present, total]
    );
  } finally {
    client.release();
  }
}

export async function getAttendance(
  studentId: string,
  academicYear: string,
  term: string
) {
  const client = await pool.connect();
  try {
    const sessionId = await ensureSession(client, academicYear, term);
    const { rows } = await client.query(
      "SELECT days_present, days_total FROM attendance WHERE student_id=$1 AND session_id=$2",
      [studentId, sessionId]
    );
    return rows[0] || { days_present: 0, days_total: 0 };
  } finally {
    client.release();
  }
}
