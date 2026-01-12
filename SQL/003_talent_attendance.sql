BEGIN;
CREATE TABLE IF NOT EXISTS talent_interests (
    record_id SERIAL PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    session_id INT NOT NULL REFERENCES academic_sessions(session_id),
    talent_remark TEXT,
    class_teacher_remark TEXT,
    head_teacher_remark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, session_id)
);
CREATE TABLE IF NOT EXISTS attendance (
    record_id SERIAL PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    session_id INT NOT NULL REFERENCES academic_sessions(session_id),
    days_present INT NOT NULL DEFAULT 0,
    days_total INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, session_id)
);
COMMIT;