import express, { Request, Response } from "express";
import { put } from "@vercel/blob";
import cors from "cors";
import multer, { FileFilterCallback, MulterError } from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import rateLimit from "express-rate-limit";
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
import authRouter from "./routes/auth";
import reportingRouter from "./routes/reporting";
import configRouter from "./routes/config";
import assessmentsRouter from "./routes/assessments";
import studentsRouter from "./routes/students";
import progressRouter from "./routes/progress";
import attendanceRouter from "./routes/attendance";
import { seedAuth } from "./services/auth";
import { initAttendanceDB } from "./services/attendance";

const isVercel = !!process.env.VERCEL;

let initPromise: Promise<void> | null = null;
async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await seedAuth();
      await initAttendanceDB();
    })().catch((err) => {
      console.error("Initialisation failed", err);
      initPromise = null;
    });
  }
  await initPromise;
}

const app = express();
app.use(cors({ origin: true, credentials: true }));

// Version Header Middleware for Client-Server Skew Detection
app.use((_req, res, next) => {
  res.setHeader("X-App-Version", process.env.npm_package_version || "1.0.0");
  next();
});

app.use(express.json({ limit: "5mb" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

if (isVercel) {
  app.use(async (_req, _res, next) => {
    await ensureInitialized();
    next();
  });
}

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/api/auth", authRouter);
app.use("/api/reporting", reportingRouter);
app.use("/api/config", configRouter);
app.use("/api/assessments", assessmentsRouter);
app.use("/api/students", studentsRouter);
app.use("/api/blobdb", blobdbRouter);
app.use("/api/progress", progressRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/sync", syncRouter);
// app.use("/api/assessrepo", assessRepoRouter); // Deprecated in favor of direct SQL

// Serve built client app (dist) for production deployments
app.use(express.static(path.join(process.cwd(), "dist")));

// Catch-all route removed (was shadowing API routes). See bottom of file for correct fallback.

// Global error handler to ensure JSON errors (including Multer/file upload issues)
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    void _next;
    const e = err as Error;
    console.error("[Global Error Handler]", e); // Added logging
    const msg = e?.message || "Server error";
    const isUploadErr =
      e?.name === "MulterError" || msg.toLowerCase().includes("invalid file");
    const status = isUploadErr ? 400 : 500;
    try {
      res.status(status).json({ error: msg });
    } catch {
      res.status(500).json({ error: "Server error" });
    }
  },
);

app.get("/api/db/health", async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    const { rows } = await client.query("SELECT 1 AS ok");
    client.release();
    res.json({ ok: true, rows });
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ ok: false, error: err.message || "DB error" });
  }
});

const uploadDir = path.join(process.cwd(), "uploads", "assessmentSheets");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (
    _req: Request,
    _file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void,
  ) => cb(null, uploadDir),
  filename: (
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, filename: string) => void,
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
    cb: FileFilterCallback,
  ) => {
    const ok = [".xlsx", ".xls"].includes(
      path.extname(file.originalname).toLowerCase(),
    );
    if (ok) cb(null, true);
    else cb(new Error("Invalid file type"));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Cleanup Uploads
function cleanupUploads(dir: string, maxAgeMs: number): void {
  try {
    if (!fs.existsSync(dir)) return;
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
// app.post("/api/assessments/upload", ...) removed

app.post("/api/admin/clean-master-db", async (req: Request, res: Response) => {
  try {
    const confirm = String(
      req.query.confirm || req.headers["x-admin-confirm"] || "",
    )
      .toLowerCase()
      .trim();
    if (
      !confirm ||
      (confirm !== "yes" && confirm !== "1" && confirm !== "true")
    ) {
      return res.status(400).json({ error: "Confirmation required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query("DELETE FROM assessments");
      await client.query("DELETE FROM audit_logs");
      await client.query("DELETE FROM academic_sessions");
      await client.query("DELETE FROM students");

      const { rows: sCountRows } = await client.query(
        "SELECT COUNT(*) AS c FROM students",
      );
      const { rows: aCountRows } = await client.query(
        "SELECT COUNT(*) AS c FROM assessments",
      );
      const { rows: sessCountRows } = await client.query(
        "SELECT COUNT(*) AS c FROM academic_sessions",
      );
      const sCount = parseInt(sCountRows[0]?.c || "0", 10);
      const aCount = parseInt(aCountRows[0]?.c || "0", 10);
      const sessCount = parseInt(sessCountRows[0]?.c || "0", 10);

      if (sCount !== 0 || aCount !== 0 || sessCount !== 0) {
        throw new Error("Cleanup verification failed: expected zero counts");
      }

      await client.query("COMMIT");

      // Postgres sequences reset
      await client.query(
        "ALTER SEQUENCE assessments_assessment_id_seq RESTART WITH 1",
      );
      await client.query("ALTER SEQUENCE audit_logs_log_id_seq RESTART WITH 1");
      await client.query(
        "ALTER SEQUENCE academic_sessions_session_id_seq RESTART WITH 1",
      );

      const { rows: finalStudents } = await client.query(
        "SELECT COUNT(*) AS c FROM students",
      );
      const { rows: finalAssessments } = await client.query(
        "SELECT COUNT(*) AS c FROM assessments",
      );
      const { rows: finalSessions } = await client.query(
        "SELECT COUNT(*) AS c FROM academic_sessions",
      );
      const { rows: finalAudit } = await client.query(
        "SELECT COUNT(*) AS c FROM audit_logs",
      );

      res.json({
        ok: true,
        counts: {
          students: parseInt(finalStudents[0]?.c || "0", 10),
          assessments: parseInt(finalAssessments[0]?.c || "0", 10),
          academic_sessions: parseInt(finalSessions[0]?.c || "0", 10),
          audit_logs: parseInt(finalAudit[0]?.c || "0", 10),
        },
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_e) {
        void _e;
      }
      const msg = (err as Error).message || "Cleanup failed";
      res.status(500).json({ error: msg });
    } finally {
      client.release();
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
    const client = await pool.connect();
    try {
      const t0 = Date.now();
      if (format === "csv") {
        const csv = await buildAssessmentTemplateCSV(
          client,
          subject,
          className,
          academicYear,
          term,
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${subject}_${className}_template.csv"`,
        );
        res.setHeader("X-Gen-Time", String(Date.now() - t0));
        res.send(csv);
      } else {
        let buf = await buildAssessmentTemplateXLSX(
          client,
          subject,
          className,
          academicYear,
          term,
        );
        const valid = validateWorkbook(buf);
        if (!valid) {
          buf = await buildAssessmentTemplate(
            client,
            subject,
            className,
            academicYear,
            term,
          );
          res.setHeader("X-Fallback", "sheetjs");
        }
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${subject}_${className}_template.xlsx"`,
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
      client.release();
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
      path.extname(file.originalname).toLowerCase(),
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
  },
);

app.get("/api/signatures/list", async (req: Request, res: Response) => {
  try {
    const academicYear = String(req.query.academicYear || "");
    const term = String(req.query.term || "");
    const items = await listSignatures(
      academicYear || undefined,
      term || undefined,
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
            : "uploads/blob.txt"),
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
  },
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
  console.error("[Global Error Handler]", err);

  if (err instanceof MulterError) {
    const code = err.code;
    const map: Record<string, string> = {
      LIMIT_FILE_SIZE: "File too large. Max 2MB.",
      LIMIT_UNEXPECTED_FILE: "Unexpected file input.",
    };
    return res.status(400).json({ error: map[code] || "Upload error", code });
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("invalid file type")) {
      return res
        .status(400)
        .json({ error: "Invalid file type. Only PNG/JPEG allowed." });
    }

    // Handle Postgres errors specifically if needed
    // e.g. 23505 = unique_violation
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return res.status(409).json({ error: "Duplicate entry already exists." });
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
      const client = await pool.connect();
      try {
        let buf: Buffer;
        if (format === "csv") {
          const csv = await buildAssessmentTemplateCSV(
            client,
            subject,
            className,
            academicYear,
            term,
          );
          const safeName = `${Date.now()}_${subject}_${className}`.replace(
            /[^a-zA-Z0-9-_.]/g,
            "_",
          );
          const outPath = path.join(uploadDir, `${safeName}.csv`);
          fs.writeFileSync(outPath, csv, { encoding: "utf8" });
          return res.json({ ok: true, path: outPath });
        } else {
          buf = await buildAssessmentTemplateXLSX(
            client,
            subject,
            className,
            academicYear,
            term,
          );
          let validated = validateWorkbook(buf);
          if (!validated) {
            buf = await buildAssessmentTemplate(
              client,
              subject,
              className,
              academicYear,
              term,
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
            "_",
          );
          const outPath = path.join(uploadDir, `${safeName}.xlsx`);
          fs.writeFileSync(outPath, buf);
          return res.json({ ok: true, path: outPath, validated });
        }
      } finally {
        client.release();
      }
    } catch (e) {
      const err = e as Error;
      res.status(500).json({ error: err.message || "Failed to save template" });
    }
  },
);

app.get("/api/assessments/sheet", async (req: Request, res: Response) => {
  try {
    const subject = String(req.query.subject || "");
    const className = String(req.query.class || "");
    const academicYear = String(req.query.academicYear || "");
    const term = String(req.query.term || "");
    if (!subject || !className || !academicYear || !term) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const client = await pool.connect();
    try {
      const { rows: subRows } = await client.query(
        "SELECT subject_id, subject_name FROM subjects WHERE subject_name=$1 LIMIT 1",
        [subject],
      );
      const sArr = subRows as Array<{
        subject_id: number;
        subject_name: string;
      }>;
      if (!sArr.length) {
        return res.status(400).json({
          error:
            "Selected subject is not configured. Please choose a valid subject.",
        });
      }
      const subject_id = sArr[0].subject_id;
      const { rows: sessRows } = await client.query(
        "SELECT session_id FROM academic_sessions WHERE academic_year=$1 AND term=$2 LIMIT 1",
        [academicYear, term],
      );
      let session_id = sessRows[0]?.session_id;
      if (!session_id) {
        const { rows: ins } = await client.query(
          "INSERT INTO academic_sessions (academic_year, term, is_active) VALUES ($1, $2, FALSE) RETURNING session_id",
          [academicYear, term],
        );
        session_id = ins[0].session_id;
      }
      const { rows } = await client.query(
        `SELECT s.student_id,
                s.surname,
                s.first_name,
                c.class_name,
                $1 AS subject_name,
                COALESCE(a.cat1_score, 0) AS cat1_score,
                COALESCE(a.cat2_score, 0) AS cat2_score,
                COALESCE(a.cat3_score, 0) AS cat3_score,
                COALESCE(a.cat4_score, 0) AS cat4_score,
                COALESCE(a.group_work_score, 0) AS group_work_score,
                COALESCE(a.project_work_score, 0) AS project_work_score,
                COALESCE(a.exam_score, 0) AS exam_score,
                (COALESCE(a.cat1_score,0)+COALESCE(a.cat2_score,0)+COALESCE(a.group_work_score,0)+COALESCE(a.project_work_score,0)) AS raw_sba_total
         FROM students s
         JOIN classes c ON s.current_class_id = c.class_id
         LEFT JOIN assessments a
           ON a.student_id = s.student_id
          AND a.subject_id = $2
          AND a.session_id = $3
         WHERE c.class_name = $4
         ORDER BY s.surname, s.first_name`,
        [subject, subject_id, session_id, className],
      );
      res.json({ rows });
    } finally {
      client.release();
    }
  } catch (e) {
    const err = e as Error;
    const msg = err.message || "Failed to load subject sheet";
    const lower = msg.toLowerCase();
    if (
      lower.includes("access denied") ||
      lower.includes("using password") ||
      lower.includes("authentication")
    ) {
      return res.json({ rows: [] });
    }
    const code = lower.includes("subject not found") ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

const port = Number(process.env.PORT || 3001);
// Fallback to index.html for client-side routing
app.get(/.*/, (_req: Request, res: Response) => {
  try {
    res.sendFile(path.join(process.cwd(), "dist", "index.html"));
  } catch {
    res.status(404).send("Not Found");
  }
});
if (!isVercel && process.env.NODE_ENV !== "test") {
  app.listen(port, async () => {
    const conn =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.NEON_DATABASE_URL;
    if (conn) {
      const host = conn.includes("@")
        ? conn.split("@")[1].split("/")[0]
        : "configured";
      console.log("Database configured:", host);
    } else {
      console.warn("No database connection string found.");
    }
    console.log(`[server] listening on http://localhost:${port}`);
    await ensureInitialized();
    setInterval(
      () => cleanupUploads(uploadDir, 24 * 60 * 60 * 1000),
      60 * 60 * 1000,
    );
  });
}

export default app;
