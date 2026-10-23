import express from "express";
import { pool } from "../lib/db";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth";

const router = express.Router();
router.use(authenticateToken);

router.get("/", async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    `SELECT o.organization_id AS id, o.name, om.role, o.created_at
     FROM organizations o JOIN organization_members om ON om.organization_id = o.organization_id
     WHERE om.user_id = $1 AND o.deleted_at IS NULL ORDER BY o.created_at`,
    [req.user!.userId],
  );
  res.json({ organizations: rows });
});

router.post("/", requireRole(["HEAD"]), async (req: AuthRequest, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: "Organization name must be 2-120 characters" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO organizations (name, created_by) VALUES ($1, $2) RETURNING organization_id AS id, name, created_at`,
      [name, req.user!.userId],
    );
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [rows[0].id, req.user!.userId],
    );
    await client.query("COMMIT");
    res.status(201).json({ organization: { ...rows[0], role: "OWNER" } });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Unable to create organization" });
  } finally { client.release(); }
});

router.get("/:organizationId/members", async (req: AuthRequest, res) => {
  const organizationId = Number(req.params.organizationId);
  const { rows } = await pool.query(
    `SELECT u.user_id AS id, u.username, u.full_name AS "fullName", om.role, om.created_at
     FROM organization_members om JOIN users u ON u.user_id = om.user_id
     WHERE om.organization_id = $1 AND EXISTS (
       SELECT 1 FROM organization_members viewer WHERE viewer.organization_id = $1 AND viewer.user_id = $2
     ) ORDER BY u.full_name`,
    [organizationId, req.user!.userId],
  );
  res.json({ members: rows });
});

export default router;
