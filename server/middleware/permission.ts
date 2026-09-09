import { Response, NextFunction } from "express";
import { pool } from "../lib/db";
import { AuthRequest } from "./auth";

export const requirePermission = (permission: string) => async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.role === "HEAD") return next();
  const organizationId = Number(req.headers["x-organization-id"] || 0);
  if (!Number.isInteger(organizationId) || organizationId < 1) {
    return res.status(400).json({ error: "Organization context required" });
  }
  const { rows } = await pool.query(
    `SELECT 1 FROM organization_members om
     JOIN role_permissions rp ON rp.organization_id = om.organization_id AND rp.role = om.role
     JOIN permissions p ON p.permission_id = rp.permission_id
     WHERE om.organization_id = $1 AND om.user_id = $2 AND p.name = $3
     LIMIT 1`,
    [organizationId, req.user.userId, permission],
  );
  if (!rows.length) return res.status(403).json({ error: "Forbidden: insufficient permissions" });
  next();
};
