import { Router, Response } from "express";
import { pool } from "../lib/db";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = Router();

async function ensureOnboardingSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS organization_onboarding (
    organization_id INT PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
    completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    dismissed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function getOrganizationId(req: AuthRequest) {
  const { rows } = await pool.query(`SELECT organization_id FROM organization_members WHERE user_id = $1 ORDER BY organization_id LIMIT 1`, [req.user!.userId]);
  return rows[0]?.organization_id as number | undefined;
}

router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await ensureOnboardingSchema();
    const organizationId = await getOrganizationId(req);
    if (!organizationId) return res.status(404).json({ error: "Organization not found" });
    const { rows } = await pool.query(`SELECT completed_steps, dismissed FROM organization_onboarding WHERE organization_id = $1`, [organizationId]);
    const state = rows[0] || { completed_steps: [], dismissed: false };
    res.json({ organizationId, completedSteps: state.completed_steps, dismissed: state.dismissed, steps: [
      { id: "organization", label: "Confirm organization profile" },
      { id: "members", label: "Invite your team" },
      { id: "students", label: "Add your first students" },
      { id: "assessment", label: "Create an assessment" },
    ] });
  } catch {
    res.status(500).json({ error: "Unable to load onboarding" });
  }
});

router.post("/progress", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await ensureOnboardingSchema();
    const organizationId = await getOrganizationId(req);
    const step = typeof req.body?.step === "string" ? req.body.step : "";
    const allowed = new Set(["organization", "members", "students", "assessment"]);
    if (!organizationId) return res.status(404).json({ error: "Organization not found" });
    if (!allowed.has(step)) return res.status(400).json({ error: "Invalid onboarding step" });
    await pool.query(`INSERT INTO organization_onboarding (organization_id, completed_steps) VALUES ($1, jsonb_build_array($2::text))
      ON CONFLICT (organization_id) DO UPDATE SET completed_steps = CASE WHEN organization_onboarding.completed_steps ? $2 THEN organization_onboarding.completed_steps ELSE organization_onboarding.completed_steps || jsonb_build_array($2::text) END, updated_at = NOW()`, [organizationId, step]);
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Unable to save onboarding progress" });
  }
});

router.post("/dismiss", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await ensureOnboardingSchema();
    const organizationId = await getOrganizationId(req);
    if (!organizationId) return res.status(404).json({ error: "Organization not found" });
    await pool.query(`INSERT INTO organization_onboarding (organization_id, dismissed) VALUES ($1, TRUE) ON CONFLICT (organization_id) DO UPDATE SET dismissed = TRUE, updated_at = NOW()`, [organizationId]);
    res.status(204).end();
  } catch {
    res.status(500).json({ error: "Unable to dismiss onboarding" });
  }
});

export default router;
