import express from "express";
import { getCheckpoint, listChanges, applyChanges } from "../services/sync";
import { authenticateToken } from "../middleware/auth";

const router = express.Router();

router.get("/checkpoint", authenticateToken, async (_req, res) => {
  try {
    const checkpoint = await getCheckpoint();
    res.json({ checkpoint });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get("/pull", authenticateToken, async (req, res) => {
  try {
    const since = Number(req.query.since || 0);
    const limit = Number(req.query.limit || 1000);
    const items = await listChanges(since, limit);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post("/push", authenticateToken, async (req, res) => {
  try {
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
    const result = await applyChanges(changes);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
