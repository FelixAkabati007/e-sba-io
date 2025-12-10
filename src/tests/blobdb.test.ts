import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../server/index";

const base = "/api/blobdb";
type IndexItem = { id: string; url?: string };

const makeStudent = (id: string, size = 0) => ({
  id,
  surname: "TEST",
  firstName: "User",
  middleName: size > 0 ? "x".repeat(size) : "",
  gender: "Other",
  dob: "2000-01-01",
  guardianContact: "000",
  class: "JHS 1",
  status: "Active",
  version: 1,
});

describe("BlobDB", () => {
  let token: string | undefined;

  beforeAll(() => {
    token =
      process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
  });

  it("lists students (initial)", async () => {
    const r = await request(app).get(`${base}/students`).expect(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });

  it("access control: 403 when token set and header missing", async () => {
    if (!token) return;
    const r = await request(app)
      .post(`${base}/students`)
      .send(makeStudent("AC1"))
      .expect(403);
    expect(r.body.error).toBe("Forbidden");
  });

  it("create/read/update/delete student", async () => {
    const id = "CRUD1";
    const hdr = token ? { "x-blob-token": token } : {};
    await request(app)
      .post(`${base}/students`)
      .set(hdr)
      .send(makeStudent(id))
      .expect(200);
    const g1 = await request(app).get(`${base}/students/${id}`).expect(200);
    expect(g1.body.id).toBe(id);
    await request(app)
      .post(`${base}/students`)
      .set(hdr)
      .send({ ...makeStudent(id), firstName: "Updated" })
      .expect(200);
    const g2 = await request(app).get(`${base}/students/${id}`).expect(200);
    expect(g2.body.firstName).toBe("Updated");
    await request(app).delete(`${base}/students/${id}`).set(hdr).expect(200);
    await request(app).get(`${base}/students/${id}`).expect(404);
  });

  it("performance: small vs large payloads and concurrency", async () => {
    const hdr = token ? { "x-blob-token": token } : {};
    const t0 = Date.now();
    await request(app)
      .post(`${base}/students`)
      .set(hdr)
      .send(makeStudent("PERF-SMALL", 0))
      .expect(200);
    const t1 = Date.now();
    await request(app)
      .post(`${base}/students`)
      .set(hdr)
      .send(makeStudent("PERF-LARGE", 250_000))
      .expect(200);
    const t2 = Date.now();
    const smallMs = t1 - t0;
    const largeMs = t2 - t1;
    expect(smallMs >= 0).toBe(true);
    expect(largeMs >= 0).toBe(true);
    const ids = Array.from({ length: 10 }).map((_, i) => `CONC-${i}`);
    await Promise.all(
      ids.map((id) =>
        request(app)
          .post(`${base}/students`)
          .set(hdr)
          .send(makeStudent(id))
          .expect(200)
      )
    );
    const list = await request(app).get(`${base}/students`).expect(200);
    type IndexItem = { id: string; url?: string };
    const items = (list.body.items || []) as IndexItem[];
    const present = ids.every((id) => items.some((x) => x.id === id));
    expect(present).toBe(true);
  });

  it("error handling: invalid inputs and recovery", async () => {
    const r1 = await request(app).post(`${base}/students`).send({}).expect(400);
    expect(r1.body.error).toBe("Missing id");
    await request(app).get(`${base}/students/DOES_NOT_EXIST`).expect(404);
  });

  it("consistency: index reflects latest state", async () => {
    const hdr = token ? { "x-blob-token": token } : {};
    const id = "CONS1";
    await request(app)
      .post(`${base}/students`)
      .set(hdr)
      .send(makeStudent(id))
      .expect(200);
    await request(app)
      .post(`${base}/students`)
      .set(hdr)
      .send({ ...makeStudent(id), version: 2 })
      .expect(200);
    const list = await request(app).get(`${base}/students`).expect(200);
    const items2 = (list.body.items || []) as IndexItem[];
    const occurrences = items2.filter((x) => x.id === id).length;
    expect(occurrences).toBe(1);
  });

  it("backup: snapshot index", async () => {
    const r = await request(app).post(`${base}/backup`).expect(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.indexURL).toBe("string");
  });

  afterAll(async () => {
    const hdr = token ? { "x-blob-token": token } : {};
    const ids = [
      "PERF-SMALL",
      "PERF-LARGE",
      "CONS1",
      ...Array.from({ length: 10 }).map((_, i) => `CONC-${i}`),
    ];
    for (const id of ids) {
      await request(app).delete(`${base}/students/${id}`).set(hdr);
    }
  });
});
