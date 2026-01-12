BEGIN;

-- Seed Subjects
INSERT INTO subjects (subject_name, is_core)
VALUES
('Mathematics', true),
('English Language', true),
('Integrated Science', true),
('Social Studies', true),
('Computing', true),
('Career Technology', false),
('Creative Arts', false),
('French', false),
('Ghanaian Language', false),
('RME', false)
ON CONFLICT (subject_name) DO NOTHING;

-- Seed Class Teachers for JHS 1 Subgroups
-- Assuming JHS 1(A), 1(B), 1(C) exist from 002

-- Teacher 1A
INSERT INTO users (username, password_hash, full_name, role, assigned_class_id)
SELECT 'teacher_1a', '$2b$10$EpOss..j.fQ.D.w.z.v.e.1.1.1.1.1.1.1.1.1.1.1', 'Class Teacher 1A', 'CLASS', class_id
FROM classes WHERE class_name = 'JHS 1(A)'
ON CONFLICT (username) DO NOTHING;

-- Teacher 1B
INSERT INTO users (username, password_hash, full_name, role, assigned_class_id)
SELECT 'teacher_1b', '$2b$10$EpOss..j.fQ.D.w.z.v.e.1.1.1.1.1.1.1.1.1.1.1', 'Class Teacher 1B', 'CLASS', class_id
FROM classes WHERE class_name = 'JHS 1(B)'
ON CONFLICT (username) DO NOTHING;

-- Teacher 1C
INSERT INTO users (username, password_hash, full_name, role, assigned_class_id)
SELECT 'teacher_1c', '$2b$10$EpOss..j.fQ.D.w.z.v.e.1.1.1.1.1.1.1.1.1.1.1', 'Class Teacher 1C', 'CLASS', class_id
FROM classes WHERE class_name = 'JHS 1(C)'
ON CONFLICT (username) DO NOTHING;

-- Seed Subject Teacher
INSERT INTO users (username, password_hash, full_name, role, assigned_subject_id)
SELECT 'math_teacher', '$2b$10$EpOss..j.fQ.D.w.z.v.e.1.1.1.1.1.1.1.1.1.1.1', 'Math Teacher', 'SUBJECT', subject_id
FROM subjects WHERE subject_name = 'Mathematics'
ON CONFLICT (username) DO NOTHING;

COMMIT;
