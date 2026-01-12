import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../lib/db";
import { AuthRequest, authenticateToken } from "../middleware/auth";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-change-this";

// Login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT u.*, c.class_name, s.subject_name 
       FROM users u
       LEFT JOIN classes c ON u.assigned_class_id = c.class_id
       LEFT JOIN subjects s ON u.assigned_subject_id = s.subject_id
       WHERE u.username = $1`,
      [username]
    );

    const user = rows[0];
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
        assignedSubjectId: user.assigned_subject_id,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
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
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// Get Current User
router.get("/me", authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT u.user_id, u.username, u.full_name, u.role, 
              u.assigned_class_id, u.assigned_subject_id,
              c.class_name, s.subject_name
       FROM users u
       LEFT JOIN classes c ON u.assigned_class_id = c.class_id
       LEFT JOIN subjects s ON u.assigned_subject_id = s.subject_id
       WHERE u.user_id = $1`,
      [userId]
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
  } catch (_error) {
    void _error;
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;
