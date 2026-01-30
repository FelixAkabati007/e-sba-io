import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool } from "../lib/db";
import { AuthRequest, authenticateToken } from "../middleware/auth";
import { PoolClient } from "pg";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-this";
const JWT_ISSUER = process.env.JWT_ISSUER || "e-sba";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "e-sba-users";
const SESSION_TTL_MIN = parseInt(process.env.SESSION_TTL_MIN || "120", 10);
type DBUserRow = {
  user_id: number;
  username: string;
  password_hash: string;
  role: string;
  full_name: string;
  assigned_class_id: number | null;
  assigned_subject_id: number | null;
  class_name: string | null;
  subject_name: string | null;
};
const HAS_DB =
  !!process.env.DATABASE_URL ||
  !!process.env.POSTGRES_URL ||
  !!process.env.NEON_DATABASE_URL;

router.get("/csrf", (_req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  res.cookie("csrf-token", token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 30 * 60 * 1000,
  });
  res.json({ token });
});

// Login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.log(`[Auth] Login attempt for user: ${username}`);

  const cookies: Record<string, string> = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(";").forEach((cookie) => {
      const [key, value] = cookie.trim().split("=");
      if (key && value) {
        cookies[key] = decodeURIComponent(value);
      }
    });
  }
  const csrfHeader = String(req.headers["x-csrf-token"] || "");
  const csrfCookie = String(cookies["csrf-token"] || "");
  if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
    return res.status(403).json({ error: "Forbidden: CSRF validation failed" });
  }

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }
  const u = String(username).trim();
  const p = String(password);
  const uValid = /^[a-zA-Z0-9_\\.\\-]{3,32}$/.test(u);
  const pValid = p.length >= 8 && p.length <= 128;
  if (!uValid || !pValid) {
    return res.status(400).json({ error: "Invalid credentials format" });
  }

  // Preview fallback when database is not configured (for Vercel previews)
  if (!HAS_DB) {
    const allow = String(process.env.PREVIEW_LOGIN_ALLOW || "0") === "1";
    if (!allow) {
      return res.status(503).json({
        error:
          "Service unavailable: database not configured (set PREVIEW_LOGIN_ALLOW=1 to enable preview login)",
      });
    }
    const uEnv = String(process.env.PREVIEW_LOGIN_USER || "preview").trim();
    const pEnv = String(process.env.PREVIEW_LOGIN_PASS || "preview").trim();
    if (username !== uEnv || password !== pEnv) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign(
      {
        userId: 0,
        username: uEnv,
        role: "HEAD",
        assignedClassId: undefined,
        assignedClassName: undefined,
        assignedSubjectId: undefined,
        assignedSubjectName: undefined,
      },
      JWT_SECRET,
      { expiresIn: "8h" },
    );
    return res.json({
      token,
      user: {
        id: 0,
        username: uEnv,
        fullName: "Preview User",
        role: "HEAD",
        assignedClassId: undefined,
        assignedClassName: undefined,
        assignedSubjectId: undefined,
        assignedSubjectName: undefined,
      },
    });
  }

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();

    const { rows } = await client!.query(
      `SELECT u.*, c.class_name, s.subject_name 
       FROM users u
       LEFT JOIN classes c ON u.assigned_class_id = c.class_id
       LEFT JOIN subjects s ON u.assigned_subject_id = s.subject_id
       WHERE u.username = $1`,
      [username],
    );

    const user = rows[0] as unknown as DBUserRow;
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        userId: user.user_id,
        username: user.username,
        role: user.role,
        assignedClassId: user.assigned_class_id,
        assignedClassName: user.class_name,
        assignedSubjectId: user.assigned_subject_id,
        assignedSubjectName: user.subject_name,
        sub: String(user.user_id),
        aud: JWT_AUDIENCE,
        iss: JWT_ISSUER,
      },
      JWT_SECRET,
      { expiresIn: `${SESSION_TTL_MIN}m` },
    );

    res.json({
      token,
      user: {
        id: user.user_id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        assignedClassId: user.assigned_class_id,
        assignedClassName: user.class_name,
        assignedSubjectId: user.assigned_subject_id,
        assignedSubjectName: user.subject_name,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    if (
      lower.includes("db connection timeout") ||
      lower.includes("timeout") ||
      lower.includes("getaddrinfo") ||
      lower.includes("ecconnrefused") ||
      lower.includes("refused") ||
      lower.includes("certificate") ||
      lower.includes("tls")
    ) {
      return res
        .status(503)
        .json({ error: "Database connection failed", details: msg });
    }
    res.status(500).json({ error: "Internal server error", details: msg });
  } finally {
    if (client) client.release();
  }
});

// Get Current User
router.get("/me", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const { rows } = await client.query(
      `SELECT u.user_id, u.username, u.full_name, u.role, 
              u.assigned_class_id, u.assigned_subject_id,
              c.class_name, s.subject_name
       FROM users u
       LEFT JOIN classes c ON u.assigned_class_id = c.class_id
       LEFT JOIN subjects s ON u.assigned_subject_id = s.subject_id
       WHERE u.user_id = $1`,
      [userId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = rows[0];
    res.json({
      user: {
        id: user.user_id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        assignedClassId: user.assigned_class_id,
        assignedClassName: user.class_name,
        assignedSubjectId: user.assigned_subject_id,
        assignedSubjectName: user.subject_name,
      },
    });
  } catch (error) {
    console.error("Auth /me error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: "Internal server error", details: msg });
  } finally {
    if (client) client.release();
  }
});

export default router;
