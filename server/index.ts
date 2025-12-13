import express, { Request, Response } from "express";
import { put } from "@vercel/blob";
import cors from "cors";
import multer, { FileFilterCallback, MulterError } from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { parseAssessmentSheet } from "./services/assessments";
import {
  saveMarksSupabase,
  getSubjectSheetSupabase,
} from "./services/supabaseAssessments";
import {
  buildAssessmentTemplateXLSX,
  buildAssessmentTemplateCSV,
  buildAssessmentTemplate,
  validateWorkbook,
} from "./services/templates";
import {
  storeSignature,
  listSignatures,
  setSignatureEnabled,
  getCurrentSignature,
} from "./services/signatures";
import { pool } from "./lib/db";
import blobdbRouter from "./routes/blobdb";
import syncRouter from "./routes/sync";
import assessRepoRouter from "./routes/assessrepo";
import { supabaseAdmin } from "./lib/supabase";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/api/blobdb", blobdbRouter);
app.use("/api/sync", syncRouter);
app.use("/api/assessrepo", assessRepoRouter);

app.get("/api/db/health", async (_req: Request, res: Response) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query("SELECT 1 AS ok");
    conn.release();
    res.json({ ok: true, rows });
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ ok: false, error: err.message || "DB error" });
  }
});

app.get("/api/supabase/health", async (_req: Request, res: Response) => {
  try {
    if (!supabaseAdmin)
      return res
        .status(500)
        .json({ ok: false, error: "Supabase not configured" });
    // Try a lightweight query against a known table if present
    const { data, error } = await supabaseAdmin
      .from("subjects")
      .select("subject_id")
      .limit(1);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, sample: data ?? [] });
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ ok: false, error: err.message || "Supabase error" });
  }
});

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

function cleanupUploads(dir: string, maxAgeMs: number): void {
  try {
    const now = Date.now();
    const entries = fs.readdirSync(dir);
    entries.forEach((name) => {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (now - st.mtimeMs > maxAgeMs) fs.unlinkSync(p);
    });
  } catch (_err) {
    void _err;
    return;
  }
}

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

      const safe = await scanFileForVirus(req.file.path);
      if (!safe)
        return res.status(400).json({ error: "File failed security scan" });

      const { rows, errors } = await parseAssessmentSheet(req.file.path);
      if (rows.length === 0)
        return res.status(400).json({ error: "No valid rows", errors });

      try {
        if (!supabaseAdmin)
          return res.status(500).json({ error: "Supabase not configured" });
        await saveMarksSupabase(subject, academicYear, term, rows);
        res.json({ ok: true, processed: rows.length, errors });
      } catch (err) {
        const msg = (err as Error).message || "Upload failed";
        if (msg.toLowerCase().includes("subject not found")) {
          return res.status(400).json({
            error:
              "Selected subject is not configured. Please choose a valid subject.",
          });
        }
        return res.status(500).json({ error: msg });
      }
    } catch (e) {
      const err = e as Error;
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  }
);

app.post("/api/admin/clean-master-db", async (req: Request, res: Response) => {
  try {
    const confirm = String(
      req.query.confirm || req.headers["x-admin-confirm"] || ""
    )
      .toLowerCase()
      .trim();
    if (
      !confirm ||
      (confirm !== "yes" && confirm !== "1" && confirm !== "true")
    ) {
      return res.status(400).json({ error: "Confirmation required" });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query("DELETE FROM assessments");
      await conn.query("DELETE FROM audit_logs");
      await conn.query("DELETE FROM academic_sessions");
      await conn.query("DELETE FROM students");

      const [sCountRows] = await conn.query(
        "SELECT COUNT(*) AS c FROM students"
      );
      const [aCountRows] = await conn.query(
        "SELECT COUNT(*) AS c FROM assessments"
      );
      const [sessCountRows] = await conn.query(
        "SELECT COUNT(*) AS c FROM academic_sessions"
      );
      const sCount = (sCountRows as Array<{ c: number }>)[0]?.c ?? 0;
      const aCount = (aCountRows as Array<{ c: number }>)[0]?.c ?? 0;
      const sessCount = (sessCountRows as Array<{ c: number }>)[0]?.c ?? 0;

      if (sCount !== 0 || aCount !== 0 || sessCount !== 0) {
        throw new Error("Cleanup verification failed: expected zero counts");
      }

      await conn.commit();

      await conn.query("ALTER TABLE assessments AUTO_INCREMENT = 1");
      await conn.query("ALTER TABLE audit_logs AUTO_INCREMENT = 1");
      await conn.query("ALTER TABLE academic_sessions AUTO_INCREMENT = 1");

      const [finalStudents] = await conn.query(
        "SELECT COUNT(*) AS c FROM students"
      );
      const [finalAssessments] = await conn.query(
        "SELECT COUNT(*) AS c FROM assessments"
      );
      const [finalSessions] = await conn.query(
        "SELECT COUNT(*) AS c FROM academic_sessions"
      );
      const [finalAudit] = await conn.query(
        "SELECT COUNT(*) AS c FROM audit_logs"
      );

      res.json({
        ok: true,
        counts: {
          students: (finalStudents as Array<{ c: number }>)[0]?.c ?? 0,
          assessments: (finalAssessments as Array<{ c: number }>)[0]?.c ?? 0,
          academic_sessions: (finalSessions as Array<{ c: number }>)[0]?.c ?? 0,
          audit_logs: (finalAudit as Array<{ c: number }>)[0]?.c ?? 0,
        },
      });
    } catch (err) {
      try {
        await conn.rollback();
      } catch (_e) {
        void _e;
      }
      const msg = (err as Error).message || "Cleanup failed";
      res.status(500).json({ error: msg });
    } finally {
      conn.release();
    }
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ error: err.message || "Unexpected error" });
  }
});

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
      const t0 = Date.now();
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
        res.setHeader("X-Gen-Time", String(Date.now() - t0));
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
        res.setHeader("X-Gen-Time", String(Date.now() - t0));
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

app.get("/api/meta/talent-remarks", async (_req: Request, res: Response) => {
  try {
    const groups = [
      {
        group: "Positive",
        options: [
          "Shows exceptional talent in subject activities",
          "Consistently demonstrates creativity",
          "Strong leadership in group tasks",
          "Excellent problem-solving skills",
        ],
      },
      {
        group: "Improvement",
        options: [
          "Could benefit from additional practice",
          "Needs support to build confidence",
          "Should focus more during class activities",
          "Improve time management in assignments",
        ],
      },
      { group: "Other", options: ["Other"] },
    ];
    res.json({ groups });
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ error: err.message || "Failed to load remarks" });
  }
});

// Signature upload and management
const sigUploadDir = path.join(process.cwd(), "uploads", "signatures");
fs.mkdirSync(sigUploadDir, { recursive: true });

const sigStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, sigUploadDir),
  filename: (_req, file, cb) => {
    const name = path
      .parse(file.originalname)
      .name.replace(/[^a-zA-Z0-9-_]/g, "_");
    cb(null, `${Date.now()}_${name}${path.extname(file.originalname)}`);
  },
});

const sigUpload = multer({
  storage: sigStorage,
  fileFilter: (_req, file, cb) => {
    const ok = [".png", ".jpg", ".jpeg", ".svg"].includes(
      path.extname(file.originalname).toLowerCase()
    );
    if (ok) cb(null, true);
    else cb(new Error("Invalid file type"));
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

app.post(
  "/api/signatures/upload",
  sigUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const token = process.env.UPLOAD_TOKEN;
      if (token && req.headers["x-upload-token"] !== token) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const academicYear = String(req.query.academicYear || "");
      const term = String(req.query.term || "");
      if (!academicYear || !term)
        return res.status(400).json({ error: "Missing academicYear or term" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const meta = await storeSignature(req.file.path, academicYear, term);
      if (meta.width && meta.height) {
        const minWidthPx = 600; // ~2in at 300dpi
        if (meta.width < minWidthPx)
          return res.status(400).json({
            error:
              "Image resolution too low. Recommended 300dpi (~600px width)",
          });
      }
      res.json({ ok: true, id: meta.id, url: meta.url, meta });
    } catch (e) {
      const err = e as Error;
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  }
);

app.get("/api/signatures/list", async (req: Request, res: Response) => {
  try {
    const academicYear = String(req.query.academicYear || "");
    const term = String(req.query.term || "");
    const items = await listSignatures(
      academicYear || undefined,
      term || undefined
    );
    res.json({ items });
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ error: err.message || "Failed to list signatures" });
  }
});

app.get("/api/signatures/current", async (req: Request, res: Response) => {
  try {
    const academicYear = String(req.query.academicYear || "");
    const term = String(req.query.term || "");
    const meta =
      academicYear && term
        ? await getCurrentSignature(academicYear, term)
        : undefined;
    res.json({ current: meta || null });
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ error: err.message || "Failed to get signature" });
  }
});

// Vercel Blob upload proxy
app.post(
  "/api/blob/put",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const token =
        process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
      const accessParam = String(req.query.access || "public");
      const access: "public" = accessParam === "private" ? "public" : "public";
      // NOTE: In this codebase the '@vercel/blob' types only expose 'public'.
      // We normalize any 'private' request to 'public' to satisfy type safety.
      // If private blobs are required, upgrade the library/types and adjust accordingly.
      const p = String(
        req.query.path ||
          req.body?.path ||
          (req.file?.originalname
            ? `uploads/${req.file.originalname}`
            : "uploads/blob.txt")
      );
      if (!token)
        return res.status(400).json({ error: "Missing BLOB_READ_WRITE_TOKEN" });
      if (req.file) {
        const buf = fs.readFileSync(req.file.path);
        const { url } = await put(p, buf, {
          access,
          token,
          contentType: req.file.mimetype,
        });
        fs.unlinkSync(req.file.path);
        return res.json({ ok: true, url });
      }
      const content =
        typeof req.body?.content === "string" ? req.body.content : undefined;
      if (!content)
        return res.status(400).json({ error: "No file or content provided" });
      const { url } = await put(p, content, {
        access,
        token,
        contentType: "text/plain",
      });
      return res.json({ ok: true, url });
    } catch (e) {
      const err = e as Error;
      res.status(500).json({ error: err.message || "Blob upload failed" });
    }
  }
);

app.post("/api/signatures/enable", async (req: Request, res: Response) => {
  try {
    const token = process.env.UPLOAD_TOKEN;
    if (token && req.headers["x-upload-token"] !== token) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const id = String(req.query.id || "");
    const enabled = String(req.query.enabled || "true") === "true";
    if (!id) return res.status(400).json({ error: "Missing id" });
    const meta = await setSignatureEnabled(id, enabled);
    if (!meta) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, meta });
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ error: err.message || "Failed to update" });
  }
});

// Centralized error handling for uploads to avoid generic 500s
app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  void _next;
  if (err instanceof MulterError) {
    const code = err.code;
    const map: Record<string, string> = {
      LIMIT_FILE_SIZE: "File too large. Max 2MB.",
      LIMIT_UNEXPECTED_FILE: "Unexpected file input.",
    };
    return res.status(400).json({ error: map[code] || "Upload error", code });
  }
  if (err instanceof Error) {
    if (err.message.toLowerCase().includes("invalid file type")) {
      return res
        .status(400)
        .json({ error: "Invalid file type. Only PNG/JPEG allowed." });
    }
    return res.status(500).json({ error: err.message || "Server error" });
  }
  return res.status(500).json({ error: "Unknown error" });
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
            /[^a-zA-Z0-9-_.]/g,
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
          let validated = validateWorkbook(buf);
          if (!validated) {
            buf = await buildAssessmentTemplate(
              conn,
              subject,
              className,
              academicYear,
              term
            );
            validated = validateWorkbook(buf);
          }

          if (!buf || buf.length === 0) {
            return res
              .status(500)
              .json({ error: "Failed to generate workbook" });
          }

          const safeName = `${Date.now()}_${subject}_${className}`.replace(
            /[^a-zA-Z0-9-_.]/g,
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
  setInterval(
    () => cleanupUploads(uploadDir, 24 * 60 * 60 * 1000),
    60 * 60 * 1000
  );
});

export default app;
app.get("/api/assessments/sheet", async (req: Request, res: Response) => {
  try {
    const subject = String(req.query.subject || "");
    const className = String(req.query.class || "");
    const academicYear = String(req.query.academicYear || "");
    const term = String(req.query.term || "");
    if (!subject || !className || !academicYear || !term) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    if (!supabaseAdmin)
      return res.status(500).json({ error: "Supabase not configured" });
    const rows = await getSubjectSheetSupabase(
      className,
      subject,
      academicYear,
      term
    );
    res.json({ rows });
  } catch (e) {
    const err = e as Error;
    const msg = err.message || "Failed to load subject sheet";
    const code = msg.toLowerCase().includes("subject not found") ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});
