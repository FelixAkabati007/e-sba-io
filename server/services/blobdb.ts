import { pool } from "../lib/db";

export type StudentDoc = {
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

export async function listStudents(): Promise<
  Array<{ id: string; url?: string }>
> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT student_id FROM students");
    return rows.map((r) => ({ id: r.student_id }));
  } finally {
    client.release();
  }
}

export async function getStudent(id: string): Promise<StudentDoc | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT s.*, c.class_name 
       FROM students s 
       LEFT JOIN classes c ON s.current_class_id = c.class_id 
       WHERE s.student_id = $1`,
      [id]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.student_id,
      surname: r.surname,
      firstName: r.first_name,
      middleName: r.middle_name || undefined,
      gender: r.gender,
      dob: r.date_of_birth
        ? new Date(r.date_of_birth).toISOString().split("T")[0]
        : "",
      guardianContact: r.guardian_contact || undefined,
      class: r.class_name || "",
      status: r.enrollment_status,
      version: r.version || 1,
    };
  } finally {
    client.release();
  }
}

export async function upsertStudent(
  doc: StudentDoc
): Promise<{ id: string; url: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Resolve Class ID
    let classId: number | null = null;
    if (doc.class) {
      const { rows: cRows } = await client.query(
        "SELECT class_id FROM classes WHERE class_name = $1",
        [doc.class]
      );
      if (cRows.length > 0) {
        classId = cRows[0].class_id;
      } else {
        // Optional: Auto-create class if not exists?
        // For now, let's assume classes are seeded.
        // If not found, we can't insert.
        // But maybe we should fallback or throw.
        // Let's insert it just in case to be safe.
        const { rows: newC } = await client.query(
          "INSERT INTO classes (class_name) VALUES ($1) RETURNING class_id",
          [doc.class]
        );
        classId = newC[0].class_id;
      }
    }

    if (classId === null) throw new Error(`Invalid class: ${doc.class}`);

    await client.query(
      `INSERT INTO students (
         student_id, surname, first_name, middle_name, gender, date_of_birth, 
         guardian_contact, current_class_id, enrollment_status, version, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (student_id) DO UPDATE SET
         surname = EXCLUDED.surname,
         first_name = EXCLUDED.first_name,
         middle_name = EXCLUDED.middle_name,
         gender = EXCLUDED.gender,
         date_of_birth = EXCLUDED.date_of_birth,
         guardian_contact = EXCLUDED.guardian_contact,
         current_class_id = EXCLUDED.current_class_id,
         enrollment_status = EXCLUDED.enrollment_status,
         version = EXCLUDED.version,
         updated_at = NOW()`,
      [
        doc.id,
        doc.surname,
        doc.firstName,
        doc.middleName || null,
        doc.gender,
        doc.dob || null,
        doc.guardianContact || null,
        classId,
        doc.status,
        doc.version,
      ]
    );

    await client.query("COMMIT");
    // Return a dummy URL since we are using SQL now.
    // The Sync logic might need it, but if we don't use Blob anymore, it's fine.
    return { id: doc.id, url: `/api/blobdb/students/${doc.id}` };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteStudent(id: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM students WHERE student_id = $1", [id]);
    return true;
  } finally {
    client.release();
  }
}

export async function snapshotAll(): Promise<{
  ok: boolean;
  indexURL: string;
}> {
  // Not implemented for SQL mode yet
  return { ok: true, indexURL: "" };
}
