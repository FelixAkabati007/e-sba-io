BEGIN;
-- Create Users Table for RBAC
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
-- Constraint: Class Teachers must have an assigned class
ALTER TABLE users
ADD CONSTRAINT check_class_teacher_assignment CHECK (
        role != 'CLASS'
        OR assigned_class_id IS NOT NULL
    );
-- Constraint: Subject Teachers must have an assigned subject
ALTER TABLE users
ADD CONSTRAINT check_subject_teacher_assignment CHECK (
        role != 'SUBJECT'
        OR assigned_subject_id IS NOT NULL
    );
-- Populate Classes with Subgroups (A, B, C)
-- First, remove old generic classes if they exist and aren't used (optional, but cleaner)
-- DELETE FROM classes WHERE class_name IN ('JHS 1', 'JHS 2', 'JHS 3'); 
-- Actually, better to just upsert the new ones.
INSERT INTO classes (class_name)
VALUES ('JHS 1(A)'),
    ('JHS 1(B)'),
    ('JHS 1(C)'),
    ('JHS 2(A)'),
    ('JHS 2(B)'),
    ('JHS 2(C)'),
    ('JHS 3(A)'),
    ('JHS 3(B)'),
    ('JHS 3(C)') ON CONFLICT (class_name) DO NOTHING;
-- Create default Head User (Password: admin123 - needs to be hashed in real app, using placeholder for now)
-- In a real scenario, we'd hash this. I'll use a placeholder hash that corresponds to 'admin123' if possible, or just plain text for now and handle hashing in app.
-- For security, I will assume the app handles hashing. I'll insert a dummy user.
INSERT INTO users (username, password_hash, full_name, role)
VALUES (
        'admin',
        '$2b$10$EpOss..j.fQ.D.w.z.v.e.1.1.1.1.1.1.1.1.1.1.1',
        'Head Teacher',
        'HEAD'
    ) ON CONFLICT (username) DO NOTHING;
COMMIT;