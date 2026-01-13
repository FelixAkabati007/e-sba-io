import express from "express";
import multer from "multer";
import { imageSize } from "image-size";
import {
  getSchoolConfig,
  updateSchoolConfig,
  getAcademicConfig,
  updateAcademicConfig,
} from "../services/config";
import { authenticateToken, requireRole } from "../middleware/auth";

const router = express.Router();
const upload = multer({
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/svg+xml"].includes(
      file.mimetype
    );
    if (!ok) return cb(new Error("Invalid file type"));
    cb(null, true);
  },
});

router.get("/school", async (req, res) => {
  try {
    const config = await getSchoolConfig();
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post(
  "/school",
  authenticateToken,
  requireRole(["HEAD"]),
  async (req, res) => {
    try {
      await updateSchoolConfig(req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

router.post(
  "/logo",
  authenticateToken,
  requireRole(["HEAD"]),
  upload.single("logo"),
  async (req, res) => {
    try {
      const f = req.file;
      if (!f) return res.status(400).json({ error: "File required" });
      const buf = f.buffer;
      let width: number | undefined;
      let height: number | undefined;
      try {
        const dim = imageSize(buf);
        width = dim.width;
        height = dim.height;
      } catch {
        width = undefined;
        height = undefined;
      }
      await updateSchoolConfig({
        logoUrl: (req.body?.inline === "1"
          ? `data:${f.mimetype};base64,${buf.toString("base64")}`
          : null) as string | null,
      });
      const client = await (await import("../lib/db")).pool.connect();
      try {
        await client.query(
          `UPDATE school_settings
           SET logo_image=$1, logo_filename=$2, logo_format=$3, logo_width=$4, logo_height=$5, updated_at=NOW()`,
          [buf, f.originalname, f.mimetype, width ?? null, height ?? null]
        );
      } finally {
        client.release();
      }
      res.json({
        ok: true,
        filename: f.originalname,
        format: f.mimetype,
        width: width ?? null,
        height: height ?? null,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

router.get("/academic", async (req, res) => {
  try {
    const config = await getAcademicConfig();
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post(
  "/academic",
  authenticateToken,
  requireRole(["HEAD"]),
  async (req, res) => {
    try {
      const { academicYear, term } = req.body;
      if (!academicYear || !term)
        return res.status(400).json({ error: "Missing fields" });
      await updateAcademicConfig(academicYear, term);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }
);

export default router;
