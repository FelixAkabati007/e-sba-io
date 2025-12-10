import express, { Request, Response } from "express";
import {
  listStudents,
  upsertStudent,
  getStudent,
  deleteStudent,
  snapshotAll,
} from "../services/blobdb";

const router = express.Router();

router.get("/students", async (_req: Request, res: Response) => {
  const items = await listStudents();
  res.json({ items });
});

router.get("/students/:id", async (req: Request, res: Response) => {
  const s = await getStudent(String(req.params.id));
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});

router.post("/students", async (req: Request, res: Response) => {
  const token =
    process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
  const hdr = String(req.headers["x-blob-token"] || "");
  if (token && hdr !== token)
    return res.status(403).json({ error: "Forbidden" });
  const body = req.body as Record<string, unknown>;
  const id = String(body.id || "").trim();
  if (!id) return res.status(400).json({ error: "Missing id" });
  const doc = {
    id,
    surname: String(body.surname || ""),
    firstName: String(body.firstName || ""),
    middleName: String(body.middleName || ""),
    gender: String(body.gender || ""),
    dob: String(body.dob || ""),
    guardianContact: String(body.guardianContact || ""),
    class: String(body.class || ""),
    status: String(body.status || "Active"),
    version: Number(body.version || 1),
  };
  const resu = await upsertStudent(doc);
  res.json(resu);
});

router.delete("/students/:id", async (req: Request, res: Response) => {
  const token =
    process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
  const hdr = String(req.headers["x-blob-token"] || "");
  if (token && hdr !== token)
    return res.status(403).json({ error: "Forbidden" });
  await deleteStudent(String(req.params.id));
  res.json({ ok: true });
});

router.post("/backup", async (_req: Request, res: Response) => {
  const snap = await snapshotAll();
  res.json(snap);
});

export default router;
