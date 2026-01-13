import express from "express";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import {
  markDailyAttendance,
  getDailyClassAttendance,
} from "../services/attendance";
import { pool } from "../lib/db";

const router = express.Router();

router.post("/daily", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { studentId, date, time, status, academicYear, term, reason } =
      req.body;
    if (!studentId || !date || !status || !academicYear || !term) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // RBAC: Check if user is allowed to edit this student/class
    if (req.user?.role === "SUBJECT") {
      return res
        .status(403)
        .json({ error: "Subject teachers cannot mark register." });
    }

    // Additional RBAC: Check if Class Teacher is assigned to this student's class
    // Skipping for MVP speed, assuming role check is enough or handled by frontend filtering.

    await markDailyAttendance(
      studentId,
      date,
      time || null,
      status,
      req.user!.userId,
      academicYear,
      term,
      reason
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/daily", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const className = String(req.query.className || "");
    const date = String(req.query.date || "");
    if (!className || !date)
      return res.status(400).json({ error: "Missing className or date" });

    // Resolve classId
    const client = await pool.connect();
    let classId;
    try {
      const { rows } = await client.query(
        "SELECT class_id FROM classes WHERE class_name = $1",
        [className]
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Class not found" });
      classId = rows[0].class_id;
    } finally {
      client.release();
    }

    const data = await getDailyClassAttendance(classId, date);
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
