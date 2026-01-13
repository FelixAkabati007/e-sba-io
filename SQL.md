BEGIN;

CREATE TABLE IF NOT EXISTS school_settings (
setting_id SERIAL PRIMARY KEY,
school_name TEXT NOT NULL,
motto TEXT,
head_teacher_name TEXT,
school_address TEXT,
logo_url TEXT,
cat_weight_percent NUMERIC(5,2) NOT NULL DEFAULT 50.00 CHECK (cat_weight_percent BETWEEN 0 AND 100),
exam_weight_percent NUMERIC(5,2) NOT NULL DEFAULT 50.00 CHECK (exam_weight_percent BETWEEN 0 AND 100),
current_academic_year TEXT NOT NULL DEFAULT '2025/2026',
current_term TEXT NOT NULL DEFAULT 'Term 1' CHECK (current_term IN ('Term 1','Term 2','Term 3')),
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grading_system (
grade_id SERIAL PRIMARY KEY,
min_score NUMERIC(5,2) NOT NULL,
max_score NUMERIC(5,2) NOT NULL,
grade_value INT NOT NULL,
remark TEXT NOT NULL,
description TEXT NOT NULL,
UNIQUE(min_score, max_score)
);

CREATE TABLE IF NOT EXISTS classes (
class_id SERIAL PRIMARY KEY,
class_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS students (
student_id TEXT PRIMARY KEY,
surname TEXT NOT NULL,
first_name TEXT NOT NULL,
middle_name TEXT,
gender TEXT NOT NULL CHECK (gender IN ('Male','Female','Other')),
date_of_birth DATE NOT NULL,
guardian_contact TEXT,
current_class_id INT NOT NULL REFERENCES classes(class_id),
enrollment_status TEXT NOT NULL DEFAULT 'Active' CHECK (enrollment_status IN ('Active','Withdrawn','Inactive')),
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subjects (
subject_id SERIAL PRIMARY KEY,
subject_name TEXT NOT NULL UNIQUE,
subject_code TEXT UNIQUE,
is_core BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS academic_sessions (
session_id SERIAL PRIMARY KEY,
academic_year TEXT NOT NULL,
term TEXT NOT NULL CHECK (term IN ('Term 1','Term 2','Term 3')),
start_date DATE,
end_date DATE,
is_active BOOLEAN NOT NULL DEFAULT FALSE,
UNIQUE(academic_year, term)
);

CREATE TABLE IF NOT EXISTS assessments (
assessment_id BIGSERIAL PRIMARY KEY,
student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
subject_id INT NOT NULL REFERENCES subjects(subject_id),
session_id INT NOT NULL REFERENCES academic_sessions(session_id),
cat1_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (cat1_score <= 10),
cat2_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (cat2_score <= 10),
cat3_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (cat3_score <= 10),
cat4_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (cat4_score <= 10),
group_work_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (group_work_score <= 20),
project_work_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (project_work_score <= 20),
exam_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (exam_score <= 100),
raw_sba_total NUMERIC(5,2) GENERATED ALWAYS AS (
cat1_score + cat2_score + cat3_score + cat4_score + group_work_score + project_work_score
) STORED,
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
UNIQUE(student_id, subject_id, session_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
log_id BIGSERIAL PRIMARY KEY,
action_type TEXT NOT NULL CHECK (action_type IN ('INSERT','UPDATE','DELETE')),
table_name TEXT NOT NULL,
record_id TEXT NOT NULL,
user_id TEXT NOT NULL DEFAULT 'SYSTEM',
details JSONB,
timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS attendance_audit_logs (
audit_id BIGSERIAL PRIMARY KEY,
attendance_id BIGINT REFERENCES attendance_records(attendance_id) ON DELETE CASCADE,
modified_by INT REFERENCES users(user_id),
old_value TEXT,
new_value TEXT,
reason TEXT,
timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subject_core ON subjects(is_core);
CREATE INDEX IF NOT EXISTS idx_session_active ON academic_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_assessment_subject_session ON assessments(subject_id, session_id);
CREATE INDEX IF NOT EXISTS idx_student_surname ON students(surname);
CREATE INDEX IF NOT EXISTS idx_student_class ON students(current_class_id);
CREATE INDEX IF NOT EXISTS idx_student_status ON students(enrollment_status);

CREATE OR REPLACE VIEW vw_student_master AS
SELECT s.student_id,
s.surname,
s.first_name,
s.middle_name,
s.gender,
s.date_of_birth,
s.guardian_contact,
s.current_class_id,
c.class_name,
s.enrollment_status,
s.created_at,
s.updated_at
FROM students s
JOIN classes c ON s.current_class_id = c.class_id;

CREATE OR REPLACE VIEW vw_assessment_overview AS
SELECT a.assessment_id,
a.student_id,
s.surname,
s.first_name,
s.middle_name,
c.class_name,
a.subject_id,
sub.subject_name,
a.session_id,
ses.academic_year,
ses.term,
a.cat1_score,
a.cat2_score,
a.cat3_score,
a.cat4_score,
a.group_work_score,
a.project_work_score,
a.exam_score,
a.raw_sba_total,
a.created_at,
a.updated_at
FROM assessments a
JOIN students s ON a.student_id = s.student_id
JOIN classes c ON s.current_class_id = c.class_id
JOIN subjects sub ON a.subject_id = sub.subject_id
JOIN academic_sessions ses ON a.session_id = ses.session_id;

CREATE OR REPLACE FUNCTION sp_save_marks(
p_student_id TEXT,
p_subject_id INT,
p_session_id INT,
p_cat1 NUMERIC(5,2),
p_cat2 NUMERIC(5,2),
p_cat3 NUMERIC(5,2),
p_cat4 NUMERIC(5,2),
p_group NUMERIC(5,2),
p_project NUMERIC(5,2),
p_exam NUMERIC(5,2)
) RETURNS VOID AS $$
BEGIN
INSERT INTO assessments (
student_id, subject_id, session_id,
cat1_score, cat2_score, cat3_score, cat4_score,
group_work_score, project_work_score, exam_score
) VALUES (
p_student_id, p_subject_id, p_session_id,
p_cat1, p_cat2, p_cat3, p_cat4,
p_group, p_project, p_exam
)
ON CONFLICT (student_id, subject_id, session_id)
DO UPDATE SET
cat1_score = EXCLUDED.cat1_score,
cat2_score = EXCLUDED.cat2_score,
cat3_score = EXCLUDED.cat3_score,
cat4_score = EXCLUDED.cat4_score,
group_work_score = EXCLUDED.group_work_score,
project_work_score = EXCLUDED.project_work_score,
exam_score = EXCLUDED.exam_score,
updated_at = NOW();
END;

$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_save_marks_v2(
  p_student_id TEXT,
  p_subject_name TEXT,
  p_session_id INT,
  p_cat1 NUMERIC(5,2),
  p_cat2 NUMERIC(5,2),
  p_cat3 NUMERIC(5,2),
  p_cat4 NUMERIC(5,2),
  p_group NUMERIC(5,2),
  p_project NUMERIC(5,2),
  p_exam NUMERIC(5,2)
) RETURNS VOID AS
$$

DECLARE v_subject_id INT;
BEGIN
SELECT subject_id INTO v_subject_id FROM subjects WHERE subject_name = p_subject_name LIMIT 1;
IF v_subject_id IS NULL THEN
RAISE EXCEPTION 'Subject name not found';
END IF;
PERFORM sp_save_marks(
p_student_id, v_subject_id, p_session_id,
p_cat1, p_cat2, p_cat3, p_cat4, p_group, p_project, p_exam
);
END;

$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_get_subject_sheet(
  p_class_name TEXT,
  p_subject_name TEXT,
  p_session_id INT
) RETURNS TABLE (
  student_id TEXT,
  surname TEXT,
  first_name TEXT,
  class_name TEXT,
  subject_name TEXT,
  cat1_score NUMERIC(5,2),
  cat2_score NUMERIC(5,2),
  cat3_score NUMERIC(5,2),
  cat4_score NUMERIC(5,2),
  group_work_score NUMERIC(5,2),
  project_work_score NUMERIC(5,2),
  exam_score NUMERIC(5,2),
  raw_sba_total NUMERIC(5,2)
) AS
$$

BEGIN
RETURN QUERY
SELECT s.student_id, s.surname, s.first_name, c.class_name, sub.subject_name,
a.cat1_score, a.cat2_score, a.cat3_score, a.cat4_score,
a.group_work_score, a.project_work_score, a.exam_score, a.raw_sba_total
FROM students s
JOIN classes c ON s.current_class_id = c.class_id
JOIN subjects sub ON sub.subject_name = p_subject_name
LEFT JOIN assessments a ON a.student_id = s.student_id
AND a.subject_id = sub.subject_id
AND a.session_id = p_session_id
WHERE c.class_name = p_class_name
ORDER BY s.surname, s.first_name;
END;

$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_get_report_card(
  p_student_id TEXT,
  p_session_id INT
) RETURNS TABLE (
  subject_name TEXT,
  raw_sba_total NUMERIC(5,2),
  exam_score NUMERIC(5,2),
  class_weighted NUMERIC(5,1),
  exam_weighted NUMERIC(5,1),
  final_score NUMERIC(5,0),
  grade_value INT,
  remark TEXT,
  description TEXT
) AS
$$

BEGIN
RETURN QUERY
SELECT sub.subject*name,
a.raw_sba_total,
a.exam_score,
ROUND((a.raw_sba_total / 80) * ss.cat*weight_percent, 1) AS class_weighted,
ROUND((a.exam_score / 100) * ss.exam*weight_percent, 1) AS exam_weighted,
ROUND(((a.raw_sba_total / 80) * ss.cat*weight_percent) + ((a.exam_score / 100) * ss.exam*weight_percent)) AS final_score,
gs.grade_value,
gs.remark,
gs.description
FROM subjects sub
LEFT JOIN assessments a ON a.subject_id = sub.subject_id AND a.student_id = p_student_id AND a.session_id = p_session_id
CROSS JOIN school_settings ss
LEFT JOIN grading_system gs ON ROUND(((a.raw_sba_total / 80) * ss.cat*weight_percent) + ((a.exam_score / 100) * ss.exam_weight_percent)) BETWEEN gs.min_score AND gs.max_score
ORDER BY sub.subject_name;
END;

$$
LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sp_set_active_session(
  p_academic_year TEXT,
  p_term TEXT
) RETURNS VOID AS
$$

BEGIN
BEGIN
PERFORM 1;
EXCEPTION WHEN OTHERS THEN
NULL;
END;
UPDATE academic_sessions SET is_active = FALSE WHERE is_active = TRUE;
INSERT INTO academic_sessions (academic_year, term, is_active)
VALUES (p_academic_year, p_term, TRUE)
ON CONFLICT (academic_year, term) DO UPDATE SET is_active = EXCLUDED.is_active;
END;

$$
LANGUAGE plpgsql;

INSERT INTO classes (class_name) VALUES ('JHS 1') ON CONFLICT DO NOTHING;
INSERT INTO classes (class_name) VALUES ('JHS 2') ON CONFLICT DO NOTHING;
INSERT INTO classes (class_name) VALUES ('JHS 3') ON CONFLICT DO NOTHING;

INSERT INTO subjects (subject_name, is_core) VALUES ('Mathematics', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('English Language', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('Integrated Science', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('Social Studies', TRUE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('Computing', FALSE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('Career Technology', FALSE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('Creative Arts', FALSE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('French', FALSE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('Ghanaian Language', FALSE) ON CONFLICT DO NOTHING;
INSERT INTO subjects (subject_name, is_core) VALUES ('Religious & Moral Education', FALSE) ON CONFLICT DO NOTHING;

INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (80, 100, 1, 'Highest', 'Distinction') ON CONFLICT DO NOTHING;
INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (70, 79, 2, 'High', 'Very Good') ON CONFLICT DO NOTHING;
INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (60, 69, 3, 'High Average', 'Good') ON CONFLICT DO NOTHING;
INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (55, 59, 4, 'Average', 'Credit') ON CONFLICT DO NOTHING;
INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (50, 54, 5, 'Low Average', 'Pass') ON CONFLICT DO NOTHING;
INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (45, 49, 6, 'Low', 'Weak') ON CONFLICT DO NOTHING;
INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (40, 44, 7, 'Lower', 'Very Weak') ON CONFLICT DO NOTHING;
INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (35, 39, 8, 'Lowest', 'Fail') ON CONFLICT DO NOTHING;
INSERT INTO grading_system (min_score, max_score, grade_value, remark, description) VALUES (0, 34, 9, 'Fail', 'Fail') ON CONFLICT DO NOTHING;

INSERT INTO school_settings (school_name, motto) VALUES ('Accra Excellence JHS', 'Discipline and Hard Work') ON CONFLICT DO NOTHING;

COMMIT;
$$
