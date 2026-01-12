import express from "express";
import {
  getAllStudents,
  upsertStudent,
  deleteStudent,
} from "../services/students";
import { authenticateToken, requireRole } from "../middleware/auth";

const router = express.Router();

router.get("/", authenticateToken, async (req: any, res) => {
  try {
    const user = req.user;
    let filterClass: string | undefined;

    if (user.role === "CLASS") {
      filterClass = user.assignedClassName;
      if (!filterClass) {
        // Should not happen if seeded correctly, but safety check
        return res.status(403).json({ error: "No class assigned to teacher" });
      }
    } else if (user.role === "HEAD") {
      // Optional filter for HEAD
      if (typeof req.query.class === "string") {
        filterClass = req.query.class;
      }
    }

    const students = await getAllStudents(filterClass);
    res.json(students);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/", authenticateToken, requireRole(["HEAD"]), async (req, res) => {
  try {
    const student = req.body;
    if (
      !student.id ||
      !student.surname ||
      !student.firstName ||
      !student.class
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    await upsertStudent(student);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post(
  "/batch",
  authenticateToken,
  requireRole(["HEAD"]),
  async (req, res) => {
    try {
      const students = req.body.students;
      if (!Array.isArray(students)) {
        return res.status(400).json({ error: "Expected array of students" });
      }
      // Process in serial or parallel? Serial is safer for DB connection limit
      for (const s of students) {
        await upsertStudent(s);
      }
      res.json({ ok: true, count: students.length });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

router.delete(
  "/:id",
  authenticateToken,
  requireRole(["HEAD"]),
  async (req, res) => {
    try {
      await deleteStudent(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

export default router;
