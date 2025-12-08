import express, { Request, Response } from "express";
import cors from "cors";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import rateLimit from "express-rate-limit";
import {
  parseAssessmentSheet,
  saveMarksTransaction,
} from "./services/assessments";
import {
  buildAssessmentTemplateXLSX,
  buildAssessmentTemplateCSV,
  buildAssessmentTemplate,
  validateWorkbook,
  validateWorkbookXLSX,
} from "./services/templates";
import { pool } from "./lib/db";

const app = express();
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

const uploadDir = path.join(process.cwd(), "uploads", "assessmentSheets");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (
    _req: Request,
    _file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void
  ) => cb(null, uploadDir),
  filename: (
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, filename: string) => void
  ) => {
    const name = path
      .parse(file.originalname)
      .name.replace(/[^a-zA-Z0-9-_]/g, "_");
    cb(null, `${Date.now()}_${name}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
  ) => {
    const ok = [".xlsx", ".xls"].includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(ok ? null : new Error("Invalid file type"), ok);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.post(
  "/api/assessments/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const token = process.env.UPLOAD_TOKEN;
      if (token && req.headers["x-upload-token"] !== token) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const subject = String(req.query.subject || "");
      const academicYear = String(req.query.academicYear || "");
      const term = String(req.query.term || "");
      if (!subject || !academicYear || !term)
        return res
          .status(400)
          .json({ error: "Missing subject, academicYear or term" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const { rows, errors } = await parseAssessmentSheet(req.file.path);
      if (rows.length === 0)
        return res.status(400).json({ error: "No valid rows", errors });

      const conn = await pool.getConnection();
      try {
        await saveMarksTransaction(conn, subject, academicYear, term, rows);
        res.json({ ok: true, processed: rows.length, errors });
      } finally {
        conn.release();
      }
    } catch (e) {
      const err = e as Error;
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  }
);

app.get("/api/assessments/template", async (req: Request, res: Response) => {
  try {
    const token = process.env.DOWNLOAD_TOKEN;
    if (token && req.headers["x-download-token"] !== token) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const subject = String(req.query.subject || "");
    const className = String(req.query.class || "");
    const academicYear = String(req.query.academicYear || "");
    const term = String(req.query.term || "");
    if (!subject || !className || !academicYear || !term)
      return res.status(400).json({ error: "Missing required parameters" });
    const format = String(req.query.format || "xlsx").toLowerCase();
    const conn = await pool.getConnection();
    try {
      if (format === "csv") {
        const csv = await buildAssessmentTemplateCSV(
          conn,
          subject,
          className,
          academicYear,
          term
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${subject}_${className}_template.csv"`
        );
        res.send(csv);
      } else {
        let buf = await buildAssessmentTemplateXLSX(
          conn,
          subject,
          className,
          academicYear,
          term
        );
        const valid = validateWorkbook(buf);
        if (!valid) {
          buf = await buildAssessmentTemplate(
            conn,
            subject,
            className,
            academicYear,
            term
          );
          res.setHeader("X-Fallback", "sheetjs");
        }
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${subject}_${className}_template.xlsx"`
        );
        const md5 = crypto.createHash("md5").update(buf).digest("hex");
        res.setHeader("X-Checksum-MD5", md5);
        res.setHeader("X-Workbook-Validated", valid ? "true" : "false");
        const len = Buffer.byteLength(buf);
        res.setHeader("Content-Length", String(len));
        if (len > 10 * 1024 * 1024) {
          res.writeHead(200);
          const chunkSize = 1024 * 1024;
          for (let i = 0; i < len; i += chunkSize) {
            res.write(buf.subarray(i, Math.min(i + chunkSize, len)));
          }
          res.end();
        } else {
          res.send(buf);
        }
      }
    } finally {
      conn.release();
    }
  } catch (e) {
    const err = e as Error;
    res
      .status(500)
      .json({ error: err.message || "Failed to generate template" });
  }
});

// Save generated template to uploads directory for manual inspection/opening
app.get(
  "/api/assessments/template/save",
  async (req: Request, res: Response) => {
    try {
      const token = process.env.DOWNLOAD_TOKEN;
      if (token && req.headers["x-download-token"] !== token) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const subject = String(req.query.subject || "");
      const className = String(req.query.class || "");
      const academicYear = String(req.query.academicYear || "");
      const term = String(req.query.term || "");
      if (!subject || !className || !academicYear || !term)
        return res.status(400).json({ error: "Missing required parameters" });
      const format = String(req.query.format || "xlsx").toLowerCase();
      const conn = await pool.getConnection();
      try {
        let buf: Buffer;
        if (format === "csv") {
          const csv = await buildAssessmentTemplateCSV(
            conn,
            subject,
            className,
            academicYear,
            term
          );
          const safeName = `${Date.now()}_${subject}_${className}`.replace(
            /[^a-zA-Z0-9-_\.]/g,
            "_"
          );
          const outPath = path.join(uploadDir, `${safeName}.csv`);
          fs.writeFileSync(outPath, csv, { encoding: "utf8" });
          return res.json({ ok: true, path: outPath });
        } else {
          buf = await buildAssessmentTemplateXLSX(
            conn,
            subject,
            className,
            academicYear,
            term
          );
          // Try to validate OOXML (ExcelJS + SheetJS)
          let validated = false;
          try {
            validated = await validateWorkbookXLSX(buf);
          } catch (e) {
            // fallback to SheetJS generated workbook if validation fails
            try {
              buf = await buildAssessmentTemplate(
                conn,
                subject,
                className,
                academicYear,
                term
              );
              validated = validateWorkbook(buf);
            } catch (inner) {
              // ignore here, will return error
            }
          }

          if (!buf || buf.length === 0) {
            return res
              .status(500)
              .json({ error: "Failed to generate workbook" });
          }

          const safeName = `${Date.now()}_${subject}_${className}`.replace(
            /[^a-zA-Z0-9-_\.]/g,
            "_"
          );
          const outPath = path.join(uploadDir, `${safeName}.xlsx`);
          fs.writeFileSync(outPath, buf);
          return res.json({ ok: true, path: outPath, validated });
        }
      } finally {
        conn.release();
      }
    } catch (e) {
      const err = e as Error;
      res.status(500).json({ error: err.message || "Failed to save template" });
    }
  }
);

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});

export default app;
