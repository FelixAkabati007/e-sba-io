import express from "express";
import {
  getSchoolConfig,
  updateSchoolConfig,
  getAcademicConfig,
  updateAcademicConfig,
} from "../services/config";
import { authenticateToken, requireRole } from "../middleware/auth";

const router = express.Router();

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
