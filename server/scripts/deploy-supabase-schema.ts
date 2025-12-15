import fs from "fs";
import path from "path";
import pg from "pg";
const { Pool } = pg;
import dotenv from "dotenv";
import { fileURLToPath } from "url";
(() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [process.cwd(), path.resolve(here, "..", "..")];
  const files = [".env", ".env.development", ".env.local"];
  for (const r of roots) {
    for (const f of files) {
      const p = path.join(r, f);
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: true });
      }
    }
  }
})();

const connStr = (process.env.SUPABASE_PG_CONN || process.env.POSTGRES_URL) as
  | string
  | undefined;
const schemaDir = process.env.SCHEMA_DIR || path.join(process.cwd(), "SQL");
const auditDir = path.join(process.cwd(), "server", "backups");
const schemaVersion = process.env.SCHEMA_VERSION || new Date().toISOString();

async function main() {
  if (!connStr) {
    console.error("[schema] Missing SUPABASE_PG_CONN env");
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const statements: string[] = [];
    if (fs.existsSync(schemaDir)) {
      const files = fs
        .readdirSync(schemaDir)
        .filter((f) => f.toLowerCase().endsWith(".sql"))
        .sort();
      for (const f of files) {
        const p = path.join(schemaDir, f);
        const sql = fs.readFileSync(p, "utf8");
        if (sql.trim().length) statements.push(sql);
      }
    }

    if (statements.length === 0) {
      statements.push(
        `CREATE TABLE IF NOT EXISTS subjects (
          subject_id SERIAL PRIMARY KEY,
          subject_name TEXT NOT NULL UNIQUE
        );`
      );
      statements.push(
        `CREATE TABLE IF NOT EXISTS classes (
          class_id SERIAL PRIMARY KEY,
          class_name TEXT NOT NULL UNIQUE
        );`
      );
      statements.push(
        `CREATE TABLE IF NOT EXISTS students (
          student_id TEXT PRIMARY KEY,
          surname TEXT NOT NULL,
          first_name TEXT NOT NULL,
          middle_name TEXT,
          gender TEXT NOT NULL CHECK (gender IN ('Male','Female','Other')),
          dob DATE NOT NULL,
          guardian_contact TEXT,
          current_class_id INTEGER REFERENCES classes(class_id) ON UPDATE CASCADE ON DELETE RESTRICT,
          status TEXT NOT NULL CHECK (status IN ('Active','Inactive','Withdrawn')),
          version INTEGER NOT NULL DEFAULT 1
        );`
      );
      statements.push(
        `CREATE TABLE IF NOT EXISTS academic_sessions (
          session_id SERIAL PRIMARY KEY,
          academic_year TEXT NOT NULL,
          term TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT FALSE,
          UNIQUE(academic_year, term)
        );`
      );
      statements.push(
        `CREATE TABLE IF NOT EXISTS assessments (
          student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
          subject_id INTEGER NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
          session_id INTEGER NOT NULL REFERENCES academic_sessions(session_id) ON DELETE CASCADE,
          cat1_score INTEGER NOT NULL DEFAULT 0,
          cat2_score INTEGER NOT NULL DEFAULT 0,
          cat3_score INTEGER NOT NULL DEFAULT 0,
          cat4_score INTEGER NOT NULL DEFAULT 0,
          group_work_score INTEGER NOT NULL DEFAULT 0,
          project_work_score INTEGER NOT NULL DEFAULT 0,
          exam_score INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (student_id, subject_id, session_id)
        );`
      );
      statements.push(
        `CREATE TABLE IF NOT EXISTS signatures (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          url TEXT NOT NULL,
          academicYear TEXT NOT NULL,
          term TEXT NOT NULL,
          uploadedAt BIGINT NOT NULL,
          width INT NULL,
          height INT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          version INT NOT NULL DEFAULT 1
        );`
      );
      statements.push(
        `CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGSERIAL PRIMARY KEY,
          event TEXT NOT NULL,
          detail JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );`
      );
      statements.push(
        `CREATE INDEX IF NOT EXISTS idx_students_class ON students(current_class_id);`
      );
      statements.push(
        `CREATE INDEX IF NOT EXISTS idx_assessments_session ON assessments(session_id);`
      );
    }

    await client.query("BEGIN");
    let applied = 0;
    const hardening: string[] = [
      `ALTER VIEW IF EXISTS public.vw_assessment_overview SET (security_invoker = true);`,
      `ALTER VIEW IF EXISTS public.vw_student_master SET (security_invoker = true);`,
      `ALTER TABLE IF EXISTS public.subjects ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.subjects FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.classes ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.classes FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.students ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.students FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.academic_sessions ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.academic_sessions FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.assessments ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.assessments FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.signatures ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.signatures FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.audit_logs ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.audit_logs FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.school_settings ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.school_settings FORCE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.grading_system ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE IF EXISTS public.grading_system FORCE ROW LEVEL SECURITY;`,
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subjects' AND polname = 'subjects_select_authenticated'
        ) THEN
          CREATE POLICY subjects_select_authenticated ON public.subjects FOR SELECT TO authenticated USING (true);
        END IF;
      END $$;`,
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'classes' AND polname = 'classes_select_authenticated'
        ) THEN
          CREATE POLICY classes_select_authenticated ON public.classes FOR SELECT TO authenticated USING (true);
        END IF;
      END $$;`,
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'school_settings' AND polname = 'school_settings_select_authenticated'
        ) THEN
          CREATE POLICY school_settings_select_authenticated ON public.school_settings FOR SELECT TO authenticated USING (true);
        END IF;
      END $$;`,
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grading_system' AND polname = 'grading_system_select_authenticated'
        ) THEN
          CREATE POLICY grading_system_select_authenticated ON public.grading_system FOR SELECT TO authenticated USING (true);
        END IF;
      END $$;`,
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'signatures' AND polname = 'signatures_select_authenticated'
        ) THEN
          CREATE POLICY signatures_select_authenticated ON public.signatures FOR SELECT TO authenticated USING (true);
        END IF;
      END $$;`,
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'academic_sessions' AND polname = 'academic_sessions_select_authenticated'
        ) THEN
          CREATE POLICY academic_sessions_select_authenticated ON public.academic_sessions FOR SELECT TO authenticated USING (true);
        END IF;
      END $$;`,
      `CREATE INDEX IF NOT EXISTS idx_assessments_subject_session ON public.assessments(subject_id, session_id);`,
      `CREATE INDEX IF NOT EXISTS idx_students_status_class ON public.students(status, current_class_id);`,
    ];
    for (const sql of statements) {
      try {
        await client.query(sql);
        applied++;
      } catch (e) {
        console.error("[schema] failed statement:\n", sql);
        throw e;
      }
    }
    for (const sql of hardening) {
      try {
        await client.query(sql);
        applied++;
      } catch (e) {
        console.error("[schema] failed hardening:\n", sql);
        throw e;
      }
    }
    await client.query("COMMIT");

    const checks = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN (
        'subjects','classes','students','academic_sessions','assessments','signatures','audit_logs'
      )`
    );

    fs.mkdirSync(auditDir, { recursive: true });
    const auditPath = path.join(auditDir, "schema_audit.log");
    const entry = {
      at: new Date().toISOString(),
      version: schemaVersion,
      statements: applied,
      tablesPresent: checks.rows
        .map((r: { table_name: string }) => r.table_name)
        .sort(),
    };
    fs.appendFileSync(auditPath, JSON.stringify(entry) + "\n", "utf8");

    console.log("[schema] applied", { applied, present: entry.tablesPresent });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    console.error("[schema] deployment failed:", (e as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
