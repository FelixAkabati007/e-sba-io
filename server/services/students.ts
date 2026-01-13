import { pool } from "../lib/db";

export type Student = {
  id: string;
  surname: string;
  firstName: string;
  middleName?: string;
  gender: "Male" | "Female";
  dateOfBirth: string;
  dob?: string; // Alias for client compatibility
  guardianContact: string;
  class: string;
  status: "Active" | "Withdrawn" | "Inactive";
};

export async function getAllStudents(className?: string): Promise<Student[]> {
  const client = await pool.connect();
  try {
    let query = `SELECT s.student_id, s.surname, s.first_name, s.middle_name, s.gender, s.date_of_birth, s.guardian_contact, c.class_name, s.enrollment_status
       FROM students s
       JOIN classes c ON s.current_class_id = c.class_id`;

    const params: unknown[] = [];
    if (className) {
      query += ` WHERE c.class_name = $1`;
      params.push(className);
    }

    query += ` ORDER BY s.surname, s.first_name`;

    const { rows } = await client.query(query, params);
    return rows.map((r) => {
      const dob = r.date_of_birth
        ? new Date(r.date_of_birth).toISOString().split("T")[0]
        : "";
      return {
        id: r.student_id,
        surname: r.surname,
        firstName: r.first_name,
        middleName: r.middle_name || "",
        gender: r.gender,
        dateOfBirth: dob,
        dob: dob, // Alias
        guardianContact: r.guardian_contact || "",
        class: r.class_name,
        status: r.enrollment_status,
      };
    });
  } finally {
    client.release();
  }
}

export async function getStudentClass(
  studentId: string
): Promise<string | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT c.class_name 
       FROM students s
       JOIN classes c ON s.current_class_id = c.class_id
       WHERE s.student_id = $1`,
      [studentId]
    );
    return rows[0]?.class_name || null;
  } finally {
    client.release();
  }
}

export async function upsertStudent(student: Student): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get Class ID
    const { rows: cRows } = await client.query(
      "SELECT class_id FROM classes WHERE class_name = $1",
      [student.class]
    );
    if (cRows.length === 0) {
      // Auto-create class if not exists (optional, but safe)
      await client.query(
        "INSERT INTO classes (class_name) VALUES ($1) ON CONFLICT DO NOTHING",
        [student.class]
      );
    }
    const { rows: cRows2 } = await client.query(
      "SELECT class_id FROM classes WHERE class_name = $1",
      [student.class]
    );
    const classId = cRows2[0].class_id;

    // Ensure dateOfBirth is never null
    const dob = student.dateOfBirth || student.dob || "2000-01-01";

    await client.query(
      `INSERT INTO students (student_id, surname, first_name, middle_name, gender, date_of_birth, guardian_contact, current_class_id, enrollment_status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (student_id) DO UPDATE SET
         surname = EXCLUDED.surname,
         first_name = EXCLUDED.first_name,
         middle_name = EXCLUDED.middle_name,
         gender = EXCLUDED.gender,
         date_of_birth = EXCLUDED.date_of_birth,
         guardian_contact = EXCLUDED.guardian_contact,
         current_class_id = EXCLUDED.current_class_id,
         enrollment_status = EXCLUDED.enrollment_status,
         updated_at = NOW()`,
      [
        student.id,
        student.surname,
        student.firstName,
        student.middleName || null,
        student.gender,
        dob,
        student.guardianContact || null,
        classId,
        student.status,
      ]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteStudent(studentId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM students WHERE student_id = $1", [
      studentId,
    ]);
  } finally {
    client.release();
  }
}
