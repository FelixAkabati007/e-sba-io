BEGIN;

-- 1. Ensure Headmaster Account
INSERT INTO users (username, password_hash, full_name, role)
VALUES ('headmaster', '$2b$10$EpOss..j.fQ.D.w.z.v.e.1.1.1.1.1.1.1.1.1.1.1', 'Headmaster', 'HEAD')
ON CONFLICT (username) DO NOTHING;

-- 2. Seed All 10 Subject Teachers
-- We use a CTE or temporary table approach to map usernames to subjects
DO $$
DECLARE
    subj RECORD;
    u_name TEXT;
    f_name TEXT;
BEGIN
    FOR subj IN SELECT * FROM subjects LOOP
        -- Generate username like 'teacher_math', 'teacher_english'
        -- Simple normalization: lower case, remove spaces
        u_name := 'teacher_' || lower(regexp_replace(subj.subject_name, '\s+', '', 'g'));
        f_name := subj.subject_name || ' Teacher';
        
        INSERT INTO users (username, password_hash, full_name, role, assigned_subject_id)
        SELECT u_name, '$2b$10$EpOss..j.fQ.D.w.z.v.e.1.1.1.1.1.1.1.1.1.1.1', f_name, 'SUBJECT', subj.subject_id
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = u_name);
    END LOOP;
END $$;

-- 3. Seed Class Teachers for JHS 2 and JHS 3 (A, B, C)
-- JHS 1 is already handled in 005, but we can safely re-run logic with WHERE NOT EXISTS
DO $$
DECLARE
    cls RECORD;
    u_name TEXT;
    f_name TEXT;
BEGIN
    FOR cls IN SELECT * FROM classes LOOP
        -- Generate username like 'teacher_jhs1a', 'teacher_jhs2b'
        -- Normalize: remove spaces, remove parentheses, lower case
        u_name := 'teacher_' || lower(regexp_replace(cls.class_name, '[\s\(\)]+', '', 'g'));
        f_name := 'Class Teacher ' || cls.class_name;
        
        INSERT INTO users (username, password_hash, full_name, role, assigned_class_id)
        SELECT u_name, '$2b$10$EpOss..j.fQ.D.w.z.v.e.1.1.1.1.1.1.1.1.1.1.1', f_name, 'CLASS', cls.class_id
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = u_name);
    END LOOP;
END $$;

COMMIT;
