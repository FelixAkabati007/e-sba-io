BEGIN;

CREATE TABLE IF NOT EXISTS talent_interests_history (
    history_id SERIAL PRIMARY KEY,
    record_id INT NOT NULL,
    student_id TEXT NOT NULL,
    session_id INT NOT NULL,
    talent_remark TEXT,
    class_teacher_remark TEXT,
    head_teacher_remark TEXT,
    changed_by_user_id INT, -- Track who made the change
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
