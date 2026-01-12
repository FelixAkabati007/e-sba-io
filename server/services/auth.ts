import { pool } from "../lib/db";
import bcrypt from "bcryptjs";

export async function seedAuth() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('HEAD', 'CLASS', 'SUBJECT')),
        assigned_class_id INT REFERENCES classes(class_id),
        assigned_subject_id INT REFERENCES subjects(subject_id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Populate Classes with Subgroups
    const classes = [
      "JHS 1(A)",
      "JHS 1(B)",
      "JHS 1(C)",
      "JHS 2(A)",
      "JHS 2(B)",
      "JHS 2(C)",
      "JHS 3(A)",
      "JHS 3(B)",
      "JHS 3(C)",
    ];

    for (const className of classes) {
      await client.query(
        "INSERT INTO classes (class_name) VALUES ($1) ON CONFLICT (class_name) DO NOTHING",
        [className]
      );
    }

    // Populate Subjects
    const subjects = [
      { name: "Mathematics", isCore: true },
      { name: "English Language", isCore: true },
      { name: "Integrated Science", isCore: true },
      { name: "Social Studies", isCore: true },
      { name: "Computing", isCore: true },
      { name: "Career Technology", isCore: false },
      { name: "Creative Arts and Design", isCore: false },
      { name: "French", isCore: false },
      { name: "Ghanaian Language", isCore: false },
      { name: "RME", isCore: false },
    ];

    for (const sub of subjects) {
      await client.query(
        "INSERT INTO subjects (subject_name, is_core) VALUES ($1, $2) ON CONFLICT (subject_name) DO NOTHING",
        [sub.name, sub.isCore]
      );
    }

    // Seed Teachers
    const teachers = [
      // Class Teachers
      {
        username: "teacher_1a",
        name: "Class Teacher 1A",
        role: "CLASS",
        className: "JHS 1(A)",
      },
      {
        username: "teacher_1b",
        name: "Class Teacher 1B",
        role: "CLASS",
        className: "JHS 1(B)",
      },
      {
        username: "teacher_1c",
        name: "Class Teacher 1C",
        role: "CLASS",
        className: "JHS 1(C)",
      },
      {
        username: "teacher_2a",
        name: "Class Teacher 2A",
        role: "CLASS",
        className: "JHS 2(A)",
      },
      {
        username: "teacher_2b",
        name: "Class Teacher 2B",
        role: "CLASS",
        className: "JHS 2(B)",
      },
      {
        username: "teacher_2c",
        name: "Class Teacher 2C",
        role: "CLASS",
        className: "JHS 2(C)",
      },
      {
        username: "teacher_3a",
        name: "Class Teacher 3A",
        role: "CLASS",
        className: "JHS 3(A)",
      },
      {
        username: "teacher_3b",
        name: "Class Teacher 3B",
        role: "CLASS",
        className: "JHS 3(B)",
      },
      {
        username: "teacher_3c",
        name: "Class Teacher 3C",
        role: "CLASS",
        className: "JHS 3(C)",
      },

      // Subject Teachers
      {
        username: "teacher_social",
        name: "Social Studies Teacher",
        role: "SUBJECT",
        subjectName: "Social Studies",
      },
      {
        username: "teacher_science",
        name: "Science Teacher",
        role: "SUBJECT",
        subjectName: "Integrated Science",
      },
      {
        username: "teacher_rme",
        name: "RME Teacher",
        role: "SUBJECT",
        subjectName: "RME",
      },
      {
        username: "teacher_math",
        name: "Mathematics Teacher",
        role: "SUBJECT",
        subjectName: "Mathematics",
      },
      {
        username: "teacher_gh_lang",
        name: "Ghanaian Language Teacher",
        role: "SUBJECT",
        subjectName: "Ghanaian Language",
      },
      {
        username: "teacher_french",
        name: "French Teacher",
        role: "SUBJECT",
        subjectName: "French",
      },
      {
        username: "teacher_english",
        name: "English Teacher",
        role: "SUBJECT",
        subjectName: "English Language",
      },
      {
        username: "teacher_cad",
        name: "CAD Teacher",
        role: "SUBJECT",
        subjectName: "Creative Arts and Design",
      },
      {
        username: "teacher_computing",
        name: "Computing Teacher",
        role: "SUBJECT",
        subjectName: "Computing",
      },
      {
        username: "teacher_career_tech",
        name: "Career Tech Teacher",
        role: "SUBJECT",
        subjectName: "Career Technology",
      },
    ];

    const defaultPass = await bcrypt.hash("password123", 10);

    for (const t of teachers) {
      let assignedClassId = null;
      let assignedSubjectId = null;

      if (t.className) {
        const { rows: cRows } = await client.query(
          "SELECT class_id FROM classes WHERE class_name = $1",
          [t.className]
        );
        if (cRows.length > 0) assignedClassId = cRows[0].class_id;
      }

      if (t.subjectName) {
        const { rows: sRows } = await client.query(
          "SELECT subject_id FROM subjects WHERE subject_name = $1",
          [t.subjectName]
        );
        if (sRows.length > 0) assignedSubjectId = sRows[0].subject_id;
      }

      await client.query(
        `INSERT INTO users (username, password_hash, full_name, role, assigned_class_id, assigned_subject_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (username) DO NOTHING`,
        [
          t.username,
          defaultPass,
          t.name,
          t.role,
          assignedClassId,
          assignedSubjectId,
        ]
      );
    }

    // Seed Admin User
    const adminUsername = "admin";
    const { rows } = await client.query(
      "SELECT * FROM users WHERE username = $1",
      [adminUsername]
    );

    const targetPassword = "Admin123";

    if (rows.length === 0) {
      const passwordHash = await bcrypt.hash(targetPassword, 10);
      await client.query(
        "INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)",
        [adminUsername, passwordHash, "Head Teacher", "HEAD"]
      );
      console.log(`Seeded admin user (password: ${targetPassword})`);
    } else {
      const currentHash = rows[0].password_hash;
      const isPlaceholder = currentHash.startsWith("$2b$10$EpOss");
      // Check if it's the old default "admin123"
      const isOldDefault = await bcrypt.compare("admin123", currentHash);

      if (isPlaceholder || isOldDefault) {
        const passwordHash = await bcrypt.hash(targetPassword, 10);
        await client.query(
          "UPDATE users SET password_hash=$1 WHERE username=$2",
          [passwordHash, adminUsername]
        );
        console.log(`Updated admin user password to: ${targetPassword}`);
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Auth seeding failed:", e);
  } finally {
    client.release();
  }
}
