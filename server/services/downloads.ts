import fs from "fs";
import path from "path";
import crypto from "crypto";
import EventEmitter from "events";
import type { Pool as PgPool, PoolClient } from "pg";
import { buildAssessmentTemplateXLSX, validateWorkbookXLSX } from "./templates";

const uploadDir = path.join(process.cwd(), "uploads", "assessmentSheets");
const cacheDir = path.join(uploadDir, "cache");
fs.mkdirSync(cacheDir, { recursive: true });

type JobStatus = "pending" | "running" | "failed" | "done";

interface Job {
  id: string;
  status: JobStatus;
  progress: number; // 0-100
  path?: string;
  error?: string;
  params: {
    subject: string;
    className: string;
    academicYear: string;
    term: string;
  };
  createdAt: number;
  updatedAt: number;
}

const jobs: Map<string, Job> = new Map();
const emitter = new EventEmitter();

function jobKey(params: {
  subject: string;
  className: string;
  academicYear: string;
  term: string;
}) {
  const h = crypto.createHash("md5");
  h.update(
    `${params.subject}|${params.className}|${params.academicYear}|${params.term}`
  );
  return h.digest("hex");
}

export async function startAssessmentJob(
  pool: PgPool,
  params: {
    subject: string;
    className: string;
    academicYear: string;
    term: string;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const job: Job = {
    id,
    status: "pending",
    progress: 0,
    params,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);

  // Kick off async worker
  (async () => {
    try {
      job.status = "running";
      job.progress = 5;
      job.updatedAt = Date.now();
      emitter.emit("update", id);

      const key = jobKey(params);
      const cachedPath = path.join(cacheDir, `${key}.xlsx`);
      if (fs.existsSync(cachedPath)) {
        job.path = cachedPath;
        job.progress = 100;
        job.status = "done";
        job.updatedAt = Date.now();
        emitter.emit("update", id);
        return;
      }

      job.progress = 20;
      job.updatedAt = Date.now();
      emitter.emit("update", id);

      // Build workbook (this may be the heaviest step)
      const conn: PoolClient = await pool.connect();
      try {
        job.progress = 40;
        job.updatedAt = Date.now();
        emitter.emit("update", id);

        const buf = await buildAssessmentTemplateXLSX(
          conn,
          params.subject,
          params.className,
          params.academicYear,
          params.term
        );

        job.progress = 70;
        job.updatedAt = Date.now();
        emitter.emit("update", id);

        // Validate
        await validateWorkbookXLSX(buf);

        job.progress = 85;
        job.updatedAt = Date.now();
        emitter.emit("update", id);

        // Write to cache
        fs.writeFileSync(cachedPath, buf);
        job.path = cachedPath;
        job.progress = 100;
        job.status = "done";
        job.updatedAt = Date.now();
        emitter.emit("update", id);
      } finally {
        conn.release();
      }
    } catch (e) {
      const err = e as Error;
      job.status = "failed";
      job.error = err.message;
      job.updatedAt = Date.now();
      job.progress = job.progress || 0;
      emitter.emit("update", id);
    }
  })();

  return id;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function onJobUpdate(cb: (id: string) => void) {
  emitter.on("update", cb);
}

export function getCachedPathForParams(params: {
  subject: string;
  className: string;
  academicYear: string;
  term: string;
}) {
  const key = jobKey(params);
  const cachedPath = path.join(cacheDir, `${key}.xlsx`);
  return fs.existsSync(cachedPath) ? cachedPath : undefined;
}

export function clearJobsOlderThan(ms: number) {
  const threshold = Date.now() - ms;
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < threshold) jobs.delete(id);
  }
}
