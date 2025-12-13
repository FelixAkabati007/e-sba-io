import express, { Request, Response } from "express";
import multer from "multer";
import path from "path";
import {
  storeXLSX,
  applyChanges,
  list,
  getJSON,
  backupIndex,
  onChange,
} from "../services/assessmentRepo";

const router = express.Router();

const uploadDir = path.join(
  process.cwd(),
  "uploads",
  "assessmentRepo",
  "incoming"
);
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
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
  limits: { fileSize: 20 * 1024 * 1024 },
});

function requireRole(
  req: Request,
  res: Response,
  role: "view" | "edit" | "admin"
): boolean {
  const r = String(req.headers["x-role"] || "view");
  const rank = { view: 1, edit: 2, admin: 3 } as const;
  if (rank[r as keyof typeof rank] < rank[role]) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.get("/index", async (req: Request, res: Response) => {
  if (!requireRole(req, res, "view")) return;
  const subject = String(req.query.subject || "");
  const type = String(req.query.assessmentType || "");
  const dateFrom = String(req.query.dateFrom || "");
  const dateTo = String(req.query.dateTo || "");
  const items = list({
    subject: subject || undefined,
    assessmentType: type || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  res.json({ items });
});

router.get("/doc/:id", async (req: Request, res: Response) => {
  if (!requireRole(req, res, "view")) return;
  const id = String(req.params.id || "");
  const doc = getJSON(id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json(doc);
});

router.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!requireRole(req, res, "edit")) return;
    try {
      const subject = String(req.body.subject || "");
      const assessmentType = String(req.body.assessmentType || "Assessment");
      const dateISO = String(req.body.dateISO || "");
      if (!req.file) return res.status(400).json({ error: "No file" });
      const fs = await import("fs");
      const buf = Buffer.from(fs.readFileSync(req.file.path));
      const meta = await storeXLSX(
        subject,
        assessmentType,
        buf,
        dateISO || undefined
      );
      res.json({ ok: true, meta });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || "Upload failed" });
    }
  }
);

router.get("/pull", async (req: Request, res: Response) => {
  if (!requireRole(req, res, "view")) return;
  const since = Number(req.query.since || 0);
  const items = list();
  const filtered = items.filter((m) => m.updatedAt > since);
  res.json({ items: filtered });
});

router.post("/push", async (req: Request, res: Response) => {
  if (!requireRole(req, res, "edit")) return;
  const body = req.body as Record<string, unknown>;
  const changes = (body.changes || []) as Array<Record<string, unknown>>;
  const mapped = changes.map((c) => ({
    id: String(c.id || ""),
    type: String(c.type || "upsert") as "upsert" | "delete",
    version: Number(c.version || 1),
    clientId: String(c.clientId || "client"),
    timestamp: Number(c.timestamp || Date.now()),
    doc: c.doc as Record<string, unknown> | undefined,
  }));
  const results = await applyChanges(mapped);
  res.json(results);
});

router.post("/backup", async (req: Request, res: Response) => {
  if (!requireRole(req, res, "admin")) return;
  const out = await backupIndex();
  res.json(out);
});

router.get("/events", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (c: unknown) => {
    try {
      res.write(`data: ${JSON.stringify(c)}\n\n`);
    } catch {
      /* ignore */
    }
  };
  const handler = (c: unknown) => send(c);
  onChange(handler);
  send({ hello: "assessrepo" });
  // connection close will be handled by Node automatically
});

export default router;
