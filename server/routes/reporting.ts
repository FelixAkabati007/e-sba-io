import express from "express";
import {
  saveTalent,
  getTalent,
  saveAttendance,
  getAttendance,
} from "../services/reporting";
import { getStudentClass } from "../services/students";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = express.Router();

router.use(authenticateToken);

async function verifyStudentAccess(req: AuthRequest, studentId: string) {
  const user = req.user!;
  if (user.role === "HEAD") return true;

  const studentClass = await getStudentClass(studentId);
  if (!studentClass) return false; // Student not found or has no class

  if (user.role === "CLASS") {
    return user.assignedClassName === studentClass;
  }
  // For SUBJECT teachers, we might need more logic, but for now allow?
  // Or maybe strictly block for attendance/talent if they are not class teacher?
  // Usually Class Teachers mark attendance.
  return false;
}

router.post("/talent", async (req: any, res) => {
  try {
    const { studentId, academicYear, term, talent, teacher, head } = req.body;
    if (!studentId || !academicYear || !term) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!(await verifyStudentAccess(req, studentId))) {
      return res.status(403).json({ error: "Access denied to this student" });
    }

    await saveTalent(
      studentId,
      academicYear,
      term,
      { talent, teacher, head },
      req.user?.id
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/talent", async (req: any, res) => {
  try {
    const { studentId, academicYear, term } = req.query;
    if (!studentId || !academicYear || !term) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    if (!(await verifyStudentAccess(req, String(studentId)))) {
      return res.status(403).json({ error: "Access denied to this student" });
    }

    const data = await getTalent(
      String(studentId),
      String(academicYear),
      String(term)
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/attendance", async (req: any, res) => {
  try {
    const { studentId, academicYear, term, present, total } = req.body;
    if (!studentId || !academicYear || !term) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!(await verifyStudentAccess(req, studentId))) {
      return res.status(403).json({ error: "Access denied to this student" });
    }

    await saveAttendance(
      studentId,
      academicYear,
      term,
      Number(present),
      Number(total)
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/attendance", async (req: any, res) => {
  try {
    const { studentId, academicYear, term } = req.query;
    if (!studentId || !academicYear || !term) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    if (!(await verifyStudentAccess(req, String(studentId)))) {
      return res.status(403).json({ error: "Access denied to this student" });
    }

    const data = await getAttendance(
      String(studentId),
      String(academicYear),
      String(term)
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
