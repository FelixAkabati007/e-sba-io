import { pool } from "../lib/db";

export async function ensureAuditSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    user_id INT,
    organization_id INT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS audit_log_org_created_idx ON audit_log (organization_id, created_at DESC)`);
}

export async function recordAudit(input: {
  userId?: number;
  organizationId?: number;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}) {
  await ensureAuditSchema();
  await pool.query(
    `INSERT INTO audit_log (user_id, organization_id, action, resource_type, resource_id, metadata, request_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [input.userId ?? null, input.organizationId ?? null, input.action, input.resourceType, input.resourceId ?? null, JSON.stringify(input.metadata ?? {}), input.requestId ?? null],
  );
}
