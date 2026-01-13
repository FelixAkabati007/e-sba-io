import express, { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { pool } from "../lib/db";
import {
  parseAssessmentSheet,
  saveMarksTransaction,
  getSubjectMarks,
  getAllClassMarks,
} from "../services/assessments";
import {
  buildAssessmentTemplateXLSX,
  buildAssessmentTemplateCSV,
} from "../services/templates";
import { audit } from "../services/assessmentRepo"; // Using existing audit for now
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

type AuthenticatedRequest = Request & {
  user: {
    role: string;
    assignedClassName?: string;
    assignedSubjectName?: string;
    username?: string;
  };
};

// --- Upload Configuration ---
const uploadDir = path.join(process.cwd(), "uploads", "assessments");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const name = path
      .parse(file.originalname)
      .name.replace(/[^a-zA-Z0-9-_]/g, "_");
    cb(null, `${Date.now()}_${name}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = [".xlsx", ".xls"].includes(
      path.extname(file.originalname).toLowerCase()
    );
    if (ok) cb(null, true);
    else cb(new Error("Invalid file type"));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function scanFileForVirus(_filePath: string): Promise<boolean> {
  if (String(process.env.SCAN_ENABLED || "0") !== "1") return true;
  void _filePath;
  return true;
}

// --- Routes ---

// GET /api/assessments?class=...&subject=...&year=...&term=...
router.get("/", authenticateToken, async (req, res) => {
  const className = String(req.query.class || "");
  const subject = String(req.query.subject || "");
  const academicYear = String(req.query.year || "");
  const term = String(req.query.term || "");

  if (!className || !academicYear || !term) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  // RBAC Check
  const user = (req as AuthenticatedRequest).user;
  if (user.role === "CLASS" && user.assignedClassName !== className) {
    return res.status(403).json({ error: "Access denied to this class" });
  }
  if (
    subject &&
    user.role === "SUBJECT" &&
    user.assignedSubjectName !== subject
  ) {
    return res.status(403).json({ error: "Access denied to this subject" });
  }
  if (!subject && user.role === "SUBJECT") {
    return res
      .status(403)
      .json({ error: "Subject teachers must specify a subject" });
  }

  const client = await pool.connect();
  try {
    if (subject) {
      const rows = await getSubjectMarks(
        client,
        className,
        subject,
        academicYear,
        term
      );
      res.json({ rows });
    } else {
      const allMarks = await getAllClassMarks(
        client,
        className,
        academicYear,
        term
      );
      res.json({ allMarks });
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  } finally {
    client.release();
  }
});

// GET /api/assessments/template?class=...&subject=...&year=...&term=...&format=...
router.get("/template", authenticateToken, async (req, res) => {
  const className = String(req.query.class || "");
  const subject = String(req.query.subject || "");
  const academicYear = String(req.query.year || req.query.academicYear || "");
  const term = String(req.query.term || "");
  const format = String(req.query.format || "xlsx").toLowerCase();

  if (!className || !subject || !academicYear || !term) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  // RBAC Check
  const user = (req as AuthenticatedRequest).user;
  if (user.role === "CLASS" && user.assignedClassName !== className) {
    return res.status(403).json({ error: "Access denied to this class" });
  }
  if (user.role === "SUBJECT" && user.assignedSubjectName !== subject) {
    return res.status(403).json({ error: "Access denied to this subject" });
  }

  const client = await pool.connect();
  try {
    if (format === "csv") {
      const csv = await buildAssessmentTemplateCSV(
        client,
        subject,
        className,
        academicYear,
        term
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="template_${className}_${subject}.csv"`
      );
      res.send(csv);
    } else {
      const buf = await buildAssessmentTemplateXLSX(
        client,
        subject,
        className,
        academicYear,
        term
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="template_${className}_${subject}.xlsx"`
      );
      res.send(buf);
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  } finally {
    client.release();
  }
});

// POST /api/assessments/save
// Body: { class: "...", subject: "...", year: "...", term: "...", rows: [...] }
router.post("/save", authenticateToken, async (req, res) => {
  const { class: className, subject, year, term, rows } = req.body;

  if (!className || !subject || !year || !term || !Array.isArray(rows)) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  // RBAC Check
  const user = (req as AuthenticatedRequest).user;
  if (user.role === "CLASS" && user.assignedClassName !== className) {
    return res.status(403).json({ error: "Access denied to this class" });
  }
  if (user.role === "SUBJECT" && user.assignedSubjectName !== subject) {
    return res.status(403).json({ error: "Access denied to this subject" });
  }

  const client = await pool.connect();
  try {
    await saveMarksTransaction(client, subject, year, term, rows);
    await audit("assessment_save_api", {
      subject,
      className,
      year,
      term,
      count: rows.length,
      user: user.username,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  } finally {
    client.release();
  }
});

// POST /api/assessments/upload
router.post(
  "/upload",
  authenticateToken,
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const subject = String(req.query.subject || "");
      const academicYear = String(req.query.academicYear || "");
      const term = String(req.query.term || "");

      if (!subject || !academicYear || !term)
        return res
          .status(400)
          .json({ error: "Missing subject, academicYear or term" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      // RBAC Check
      const user = (req as AuthenticatedRequest).user;
      if (user.role === "SUBJECT" && user.assignedSubjectName !== subject) {
        return res.status(403).json({ error: "Access denied to this subject" });
      }

      const safe = await scanFileForVirus(req.file.path);
      if (!safe)
        return res.status(400).json({ error: "File failed security scan" });

      await audit("assessment_upload_attempt", {
        subject,
        academicYear,
        term,
        filename: req.file.originalname,
        size: req.file.size,
        user: user.username,
      });

      const { rows, errors } = await parseAssessmentSheet(req.file.path);

      await audit("assessment_upload_parsed", {
        subject,
        academicYear,
        term,
        rows: rows.length,
        errorsCount: errors.length,
      });

      if (rows.length === 0)
        return res.status(400).json({ error: "No valid rows", errors });

      const client = await pool.connect();
      try {
        await saveMarksTransaction(client, subject, academicYear, term, rows);
        await audit("assessment_upload_saved_db", {
          subject,
          academicYear,
          term,
          processed: rows.length,
        });
        res.json({ ok: true, processed: rows.length, errors });
      } catch (dbErr) {
        const emsg = (dbErr as Error).message || "Upload failed";
        await audit("assessment_upload_failed", {
          subject,
          academicYear,
          term,
          error: emsg,
        });
        return res.status(500).json({ error: emsg });
      } finally {
        client.release();
      }
    } catch (e) {
      const err = e as Error;
      await audit("assessment_upload_exception", { error: err.message });
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  }
);

export default router;
