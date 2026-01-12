import { Router, Response } from "express";
import { pool } from "../lib/db";
import {
  authenticateToken as requireAuth,
  AuthRequest,
} from "../middleware/auth";

const router = Router();

// Helper to get total students in a class
async function getTotalStudents(className: string): Promise<number> {
  const res = await pool.query(
    "SELECT COUNT(*) as count FROM students WHERE class = $1 AND status = 'Active'",
    [className]
  );
  return parseInt(res.rows[0]?.count || "0");
}

async function getSessionId(
  academicYear: string,
  term: string
): Promise<number | null> {
  const res = await pool.query(
    "SELECT session_id FROM academic_sessions WHERE academic_year = $1 AND term = $2",
    [academicYear, term]
  );
  return res.rows[0]?.session_id || null;
}

// Get Progress for a specific context
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { scope, className, subjectName, academicYear, term } = req.query;
    const user = req.user!;

    if (!academicYear || !term || !className) {
      return res.status(400).json({ error: "Missing required params" });
    }

    const sessionId = await getSessionId(String(academicYear), String(term));
    if (!sessionId) {
      return res.json({ progress: 0, total: 0, incomplete: [] });
    }

    let completedCount = 0;
    let incompleteStudents: { id: string; name: string }[] = [];

    const total = await getTotalStudents(String(className));
    if (total === 0) return res.json({ progress: 0, total: 0, incomplete: [] });

    // 1. Subject Progress
    if (scope === "subject" && subjectName) {
      // Enforce RBAC
      if (
        user.role === "SUBJECT" &&
        user.assignedSubjectName !== String(subjectName)
      ) {
        return res.status(403).json({ error: "Access denied to this subject" });
      }

      const { rows: subRows } = await pool.query(
        "SELECT subject_id FROM subjects WHERE subject_name = $1",
        [subjectName]
      );
      if (!subRows.length)
        return res.json({ progress: 0, total, incomplete: [] });
      const subjectId = subRows[0].subject_id;

      // Find students who have marks (exam_score is a good proxy for 'started/done' but user might want 'any entry')
      // We'll count if they have a record in assessments table
      const { rows: doneRows } = await pool.query(
        `SELECT student_id FROM assessments 
         WHERE subject_id = $1 AND session_id = $2 
         AND student_id IN (SELECT id FROM students WHERE class = $3 AND status = 'Active')`,
        [subjectId, sessionId, className]
      );

      const doneIds = new Set(doneRows.map((r) => r.student_id));
      completedCount = doneIds.size;

      // Find incomplete details
      const { rows: allStudents } = await pool.query(
        "SELECT id, surname, first_name FROM students WHERE class = $1 AND status = 'Active' ORDER BY surname, first_name",
        [className]
      );

      incompleteStudents = allStudents
        .filter((s) => !doneIds.has(s.id))
        .map((s) => ({ id: s.id, name: `${s.surname} ${s.first_name}` }));
    }
    // 2. Class Teacher Progress (Talent/Interest & Attendance)
    else if (scope === "class") {
      // Enforce RBAC
      if (
        user.role === "CLASS" &&
        user.assignedClassName !== String(className)
      ) {
        // Class teachers can only see their own class progress
        return res.status(403).json({ error: "Access denied to this class" });
      }

      // Check for Talent Remarks (class_teacher_remark)
      const { rows: remarkRows } = await pool.query(
        `SELECT student_id FROM talent_interests
         WHERE session_id = $1 AND class_teacher_remark IS NOT NULL AND class_teacher_remark != ''
         AND student_id IN (SELECT id FROM students WHERE class = $2 AND status = 'Active')`,
        [sessionId, className]
      );

      const doneIds = new Set(remarkRows.map((r) => r.student_id));
      completedCount = doneIds.size;

      const { rows: allStudents } = await pool.query(
        "SELECT id, surname, first_name FROM students WHERE class = $1 AND status = 'Active' ORDER BY surname, first_name",
        [className]
      );

      incompleteStudents = allStudents
        .filter((s) => !doneIds.has(s.id))
        .map((s) => ({ id: s.id, name: `${s.surname} ${s.first_name}` }));
    }

    const percentage = Math.round((completedCount / total) * 100);

    res.json({
      progress: percentage,
      total,
      completed: completedCount,
      incomplete: incompleteStudents,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
