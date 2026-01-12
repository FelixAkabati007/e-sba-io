BEGIN;
CREATE TABLE IF NOT EXISTS sync_changes (
    change_id BIGSERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('upsert', 'delete')),
    timestamp BIGINT NOT NULL,
    client_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_ts ON sync_changes(timestamp);
ALTER TABLE students
ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
COMMIT;