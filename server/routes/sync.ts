import express, { Request, Response } from "express";
import { applyChanges, listChanges, getCheckpoint } from "../services/sync";

const router = express.Router();

router.get("/checkpoint", async (_req: Request, res: Response) => {
  const cp = await getCheckpoint();
  res.json({ checkpoint: cp });
});

router.get("/pull", async (req: Request, res: Response) => {
  const since = Number(req.query.since || 0);
  const limit = Number(req.query.limit || 1000);
  const items = await listChanges(since, limit);
  res.json({ items });
});

router.post("/push", async (req: Request, res: Response) => {
  const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
  const hdr = String(req.headers["x-blob-token"] || "");
  if (token && hdr !== token) return res.status(403).json({ error: "Forbidden" });
  const body = req.body as Record<string, unknown>;
  const changes = (body.changes || []) as Array<Record<string, unknown>>;
  const mapped = changes.map((c) => ({
    id: String(c.id || ""),
    type: String(c.type || "upsert") as "upsert" | "delete",
    doc: c.doc as Record<string, unknown> | undefined,
    version: Number(c.version || 1),
    clientId: String(c.clientId || "client"),
    timestamp: Number(c.timestamp || Date.now()),
  }));
  const resu = await applyChanges(mapped);
  res.json(resu);
});

export default router;
