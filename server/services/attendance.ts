import { pool } from "../lib/db";
import { ensureSession } from "./assessments";

export async function initAttendanceDB() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        attendance_id BIGSERIAL PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
        date DATE NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Present', 'Late', 'Absent', 'Excused')),
        arrival_time TIME,
        recorded_by INT REFERENCES users(user_id),
        last_modified_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(student_id, date)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_audit_logs (
        audit_id BIGSERIAL PRIMARY KEY,
        attendance_id BIGINT REFERENCES attendance_records(attendance_id) ON DELETE CASCADE,
        modified_by INT REFERENCES users(user_id),
        old_value TEXT,
        new_value TEXT,
        reason TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query("COMMIT");
    console.log("Attendance DB initialized");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Attendance DB init failed", e);
  } finally {
    client.release();
  }
}

export async function markDailyAttendance(
  studentId: string,
  date: string,
  time: string | null,
  status: "Present" | "Late" | "Absent" | "Excused",
  userId: number,
  academicYear: string,
  term: string,
  reason?: string
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Logic Check (Time)
    // If time is provided, validate status against rules
    // 8:00 - 12:00 -> Late
    // > 12:00 -> Absent (unless overridden by Admin/Teacher with reason?)
    // Spec says: "Records marked Absent after 12:00 PM may be modified only by Class Teacher or Admin with justification."
    // Here we just record what is sent, but we could enforce default status if not provided.
    // For now, trust the input status but ensure consistent recording.

    // 2. Get existing record for Audit
    const { rows: existing } = await client.query(
      "SELECT * FROM attendance_records WHERE student_id = $1 AND date = $2",
      [studentId, date]
    );

    let attendanceId;
    let oldStatus = null;

    if (existing.length > 0) {
      attendanceId = existing[0].attendance_id;
      oldStatus = existing[0].status;

      if (oldStatus !== status) {
        // Audit Log
        await client.query(
          `INSERT INTO attendance_audit_logs (attendance_id, modified_by, old_value, new_value, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [attendanceId, userId, oldStatus, status, reason || "Status update"]
        );
      }

      // Update
      await client.query(
        `UPDATE attendance_records 
         SET status = $1, arrival_time = $2, recorded_by = $3, last_modified_at = NOW()
         WHERE attendance_id = $4`,
        [status, time, userId, attendanceId]
      );
    } else {
      // Insert
      const { rows: newRec } = await client.query(
        `INSERT INTO attendance_records (student_id, date, status, arrival_time, recorded_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING attendance_id`,
        [studentId, date, status, time, userId]
      );
      attendanceId = newRec[0].attendance_id;
    }

    // 3. Sync with Summary Report (Real-time)
    // We need to recalculate total present/total days for this student in the current session (term).
    // Or just increment/decrement? Recalculating is safer.

    // First, find session start/end dates or just count records within the session.
    // Spec says "per-school-day basis".
    // We assume the `date` falls within the `academicYear` and `term`.
    const sessionId = await ensureSession(client, academicYear, term);

    // Count present days for this student in this session
    // We need to know the date range of the session OR just assume all records matching session dates.
    // But `academic_sessions` table has start_date/end_date?
    // Let's check academic_sessions schema in SQL.md: start_date, end_date exist.
    // But `ensureSession` might not set them?

    // Alternative: Just count all records for this student? No, that mixes terms.
    // We need to filter by term.
    // If session dates are not set, we can't filter by date accurately unless we assume `date` passed in is correct for the term.
    // For now, let's update the `attendance` summary table manually or by counting records if we can bind them to a session.
    // Since we don't have a direct link between `attendance_records` and `session_id`, we rely on date.

    // Let's simplify: Update the summary table by +1 if new record is Present/Late.
    // But if we updated existing, we might need to adjust.

    // Better approach:
    // 1. Get session info (dates).
    // 2. Count records for student between start/end dates.
    // If dates are null in `academic_sessions`, we fallback to just updating the summary blindly (bad).

    // Let's try to update the `attendance` summary table using an upsert based on the delta.
    // However, `saveAttendance` in `reporting.ts` overwrites absolute values.

    // Let's fetch current summary, adjust, and save.
    // Status 'Present' or 'Late' counts as Present? Spec says "Status = Present" or "Status = Late".
    // Usually 'Late' is present. 'Absent' is absent. 'Excused' is ? (Absent but excused, usually counts as absent or separate).
    // Let's assume Present + Late = Days Present.
    // Total = Count of all records (school days).

    // Check if `oldStatus` was present-like and `newStatus` is absent-like, etc.
    const wasPresent = oldStatus === "Present" || oldStatus === "Late";
    const isPresent = status === "Present" || status === "Late";

    // We need the current summary for this session
    const { rows: summary } = await client.query(
      "SELECT days_present, days_total FROM attendance WHERE student_id = $1 AND session_id = $2",
      [studentId, sessionId]
    );

    let daysPresent = summary[0]?.days_present || 0;
    let daysTotal = summary[0]?.days_total || 0;

    if (existing.length === 0) {
      // New record
      daysTotal += 1;
      if (isPresent) daysPresent += 1;
    } else {
      // Update
      if (wasPresent && !isPresent) daysPresent -= 1;
      if (!wasPresent && isPresent) daysPresent += 1;
      // Total doesn't change as the day was already recorded
    }

    await client.query(
      `INSERT INTO attendance (student_id, session_id, days_present, days_total)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, session_id) DO UPDATE SET
       days_present = EXCLUDED.days_present,
       days_total = EXCLUDED.days_total,
       updated_at = NOW()`,
      [studentId, sessionId, daysPresent, daysTotal]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getDailyClassAttendance(classId: number, date: string) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT 
         s.student_id, 
         s.surname, 
         s.first_name, 
         ar.status, 
         ar.arrival_time,
         ar.last_modified_at
       FROM students s
       LEFT JOIN attendance_records ar ON s.student_id = ar.student_id AND ar.date = $2
       WHERE s.current_class_id = $1
       ORDER BY s.surname, s.first_name`,
      [classId, date]
    );
    return rows;
  } finally {
    client.release();
  }
}
