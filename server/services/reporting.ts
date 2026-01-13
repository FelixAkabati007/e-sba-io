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

export type RankingEntry = {
  student_id: string;
  surname: string;
  first_name: string;
  middle_name: string;
  class_name: string;
  overall_score: number;
  position: number;
};

export async function getRankings(
  baseClass: string,
  academicYear: string,
  term: string,
  page: number = 1,
  limit: number = 50
): Promise<{ data: RankingEntry[]; total: number }> {
  const client = await pool.connect();
  try {
    const sessionId = await ensureSession(client, academicYear, term);
    const offset = (page - 1) * limit;

    const query = `
      WITH StudentScores AS (
        SELECT
          s.student_id,
          s.surname,
          s.first_name,
          s.middle_name,
          c.class_name,
          COALESCE(SUM(
            COALESCE(a.cat1_score, 0) +
            COALESCE(a.cat2_score, 0) +
            COALESCE(a.cat3_score, 0) +
            COALESCE(a.cat4_score, 0) +
            COALESCE(a.group_work_score, 0) +
            COALESCE(a.project_work_score, 0) +
            COALESCE(a.exam_score, 0)
          ), 0) as overall_score
        FROM students s
        JOIN classes c ON s.current_class_id = c.class_id
        LEFT JOIN assessments a ON s.student_id = a.student_id AND a.session_id = $2
        WHERE c.class_name LIKE $1 || '%'
        GROUP BY s.student_id, c.class_name, s.surname, s.first_name, s.middle_name
      ),
      RankedStudents AS (
        SELECT
          *,
          RANK() OVER (ORDER BY overall_score DESC) as position
        FROM StudentScores
      )
      SELECT *, COUNT(*) OVER() as full_count
      FROM RankedStudents
      ORDER BY position ASC
      LIMIT $3 OFFSET $4
    `;

    const { rows } = await client.query(query, [
      baseClass,
      sessionId,
      limit,
      offset,
    ]);

    const total = rows.length > 0 ? Number(rows[0].full_count) : 0;
    const data = rows.map((r) => ({
      student_id: r.student_id,
      surname: r.surname,
      first_name: r.first_name,
      middle_name: r.middle_name || "",
      class_name: r.class_name,
      overall_score: Number(r.overall_score),
      position: Number(r.position),
    }));

    return { data, total };
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

export async function getClassAttendance(
  className: string,
  academicYear: string,
  term: string
) {
  const client = await pool.connect();
  try {
    const sessionId = await ensureSession(client, academicYear, term);
    const query = `
      SELECT s.student_id, a.days_present, a.days_total
      FROM students s
      JOIN classes c ON s.current_class_id = c.class_id
      LEFT JOIN attendance a ON s.student_id = a.student_id AND a.session_id = $2
      WHERE c.class_name = $1
    `;
    const { rows } = await client.query(query, [className, sessionId]);
    return rows;
  } finally {
    client.release();
  }
}
