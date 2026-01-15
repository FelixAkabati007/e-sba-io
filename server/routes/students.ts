import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import {
  getAllStudents,
  upsertStudent,
  deleteStudent,
} from "../services/students";
import type { Student } from "../services/students";
import {
  authenticateToken,
  requireRole,
  AuthRequest,
} from "../middleware/auth";

const router = express.Router();

// --- Chunked Upload Configuration ---
const CHUNK_UPLOAD_DIR = path.join(process.cwd(), "uploads", "temp_chunks");
if (!fs.existsSync(CHUNK_UPLOAD_DIR)) {
  fs.mkdirSync(CHUNK_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadId = req.body.uploadId;
    if (!uploadId) return cb(new Error("Missing uploadId"), "");
    const dir = path.join(CHUNK_UPLOAD_DIR, uploadId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const index = req.body.chunkIndex;
    cb(null, `chunk_${index}`);
  },
});

const upload = multer({ storage });

router.get(
  "/",
  authenticateToken,
  async (req: express.Request, res: express.Response) => {
    try {
      const user = (req as AuthRequest).user!;
      let filterClass: string | undefined;

      if (user.role === "CLASS") {
        filterClass = user.assignedClassName || undefined;
        if (!filterClass) {
          // Should not happen if seeded correctly, but safety check
          return res
            .status(403)
            .json({ error: "No class assigned to teacher" });
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
  }
);

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

// --- Chunked Upload Endpoints ---

// 1. Initialize Upload
router.post(
  "/upload/init",
  authenticateToken,
  requireRole(["HEAD"]),
  async (req, res) => {
    try {
      const uploadId =
        Date.now().toString() + "_" + Math.random().toString(36).substring(7);
      const dir = path.join(CHUNK_UPLOAD_DIR, uploadId);
      fs.mkdirSync(dir, { recursive: true });
      res.json({ uploadId });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

// 2. Upload Chunk
router.post(
  "/upload/chunk",
  authenticateToken,
  requireRole(["HEAD"]),
  upload.single("chunk"),
  async (req, res) => {
    try {
      // Multer handles saving to disk
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

// 3. Complete Upload
router.post(
  "/upload/complete",
  authenticateToken,
  requireRole(["HEAD"]),
  async (req, res) => {
    const start = Date.now();
    let fileSize = 0;
    let parseMs = 0;
    let transformMs = 0;
    let dbMs = 0;
    try {
      const { uploadId, fileName } = req.body;
      if (!uploadId) return res.status(400).json({ error: "Missing uploadId" });

      const dir = path.join(CHUNK_UPLOAD_DIR, uploadId);
      if (!fs.existsSync(dir))
        return res.status(404).json({ error: "Upload session not found" });

      const files = fs.readdirSync(dir).sort((a, b) => {
        const idxA = parseInt(a.split("_")[1]);
        const idxB = parseInt(b.split("_")[1]);
        return idxA - idxB;
      });

      const finalPath = path.join(
        CHUNK_UPLOAD_DIR,
        `${uploadId}_${fileName || "upload.xlsx"}`
      );
      const writeStream = fs.createWriteStream(finalPath);

      for (const file of files) {
        const chunkPath = path.join(dir, file);
        const data = fs.readFileSync(chunkPath);
        writeStream.write(data);
        fs.unlinkSync(chunkPath); // Clean up chunk
      }
      writeStream.end();

      // Wait for stream to finish
      await new Promise<void>((resolve, reject) => {
        writeStream.on("finish", () => resolve());
        writeStream.on("error", (err) => reject(err));
      });

      fs.rmdirSync(dir);

      const stat = fs.statSync(finalPath);
      fileSize = stat.size;

      const mod = await import("xlsx");
      const XLSX = (mod as unknown as { default?: unknown }).default || mod;
      const parseStart = Date.now();
      const fileBuffer = fs.readFileSync(finalPath);
      const workbook = (XLSX as typeof import("xlsx")).read(fileBuffer, {
        type: "buffer",
      });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = (XLSX as typeof import("xlsx")).utils.sheet_to_json(
        worksheet,
        { defval: "" }
      );
      parseMs = Date.now() - parseStart;

      const transformStart = Date.now();
      const processed: Student[] = [];
      for (const row of jsonData as Array<Record<string, unknown>>) {
        const map: Record<string, unknown> = {};
        Object.keys(row).forEach((k) => {
          map[k.toLowerCase().trim()] = (row as Record<string, unknown>)[k];
        });
        const surname = String(map["surname"] ?? "").toUpperCase();
        const firstName = String(
          map["first name"] ?? map["firstname"] ?? ""
        ).trim();
        const genderRaw = String(map["gender"] ?? "").toLowerCase();
        const gender = (
          genderRaw.includes("f") ? "Female" : "Male"
        ) as Student["gender"];
        const klass = String(map["class"] ?? "").trim();
        const id =
          String(map["id"] ?? "").trim() ||
          crypto.randomUUID().replace(/-/g, "");
        if (!surname || !firstName || !klass) continue;
        const student: Student = {
          id,
          surname,
          firstName,
          middleName: "",
          gender,
          dateOfBirth: "2000-01-01",
          dob: "2000-01-01",
          guardianContact: "",
          class: klass,
          status: "Active",
        };
        processed.push(student);
      }
      transformMs = Date.now() - transformStart;

      const dbStart = Date.now();
      const BATCH_SIZE = 50;
      for (let i = 0; i < processed.length; i += BATCH_SIZE) {
        const batch = processed.slice(i, i + BATCH_SIZE);
        for (const s of batch) {
          await upsertStudent(s);
        }
      }
      dbMs = Date.now() - dbStart;

      fs.unlinkSync(finalPath);

      const totalMs = Date.now() - start;
      const payload = {
        ok: true,
        count: processed.length,
        metrics: {
          fileSize,
          parseMs,
          transformMs,
          dbMs,
          totalMs,
        },
      };
      console.log("students_upload_complete", payload);
      res.json(payload);
    } catch (e) {
      console.error("Upload complete error:", e);
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

export default router;
