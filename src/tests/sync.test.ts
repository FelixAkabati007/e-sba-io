import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../server/index";

describe("Sync", () => {
  const base = "/api/sync";
  const db = "/api/blobdb";
  let token: string | undefined;

  it("checkpoint returns initial value", async () => {
    const r = await request(app).get(`${base}/checkpoint`).expect(200);
    expect(typeof r.body.checkpoint).toBe("number");
  });

  it("push upsert and pull changes", async () => {
    token =
      process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
    const hdr = token ? { "x-blob-token": token } : {};
    const now = Date.now();
    const change = {
      id: "SYNC-1",
      type: "upsert",
      doc: {
        id: "SYNC-1",
        surname: "SYNC",
        firstName: "One",
        gender: "Other",
        dob: "2000-01-01",
        class: "JHS 1",
        status: "Active",
        version: 1,
      },
      version: 1,
      clientId: "test",
      timestamp: now,
    };
    const r1 = await request(app)
      .post(`${base}/push`)
      .set(hdr)
      .send({ changes: [change] })
      .expect(200);
    expect(Array.isArray(r1.body.results)).toBe(true);
    const r2 = await request(app)
      .get(`${base}/pull`)
      .query({ since: now - 1 })
      .expect(200);
    expect(Array.isArray(r2.body.items)).toBe(true);
    const list = await request(app).get(`${db}/students`).expect(200);
    const present = (list.body.items || []).some(
      (x: { id: string }) => x.id === "SYNC-1"
    );
    expect(present).toBe(true);
  });

  it("detects conflict on lower version and reports latest", async () => {
    token =
      process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
    const hdr = token ? { "x-blob-token": token } : {};
    const id = "SYNC-CONFLICT-1";
    await request(app)
      .post(`${db}/students`)
      .set(hdr)
      .send({
        id,
        surname: "Server",
        firstName: "Wins",
        gender: "Other",
        dob: "2000-01-01",
        class: "JHS 1",
        status: "Active",
        version: 2,
      })
      .expect(200);
    const now = Date.now();
    const change = {
      id,
      type: "upsert",
      doc: {
        id,
        surname: "Client",
        firstName: "Edit",
        gender: "Other",
        dob: "2000-01-01",
        class: "JHS 1",
        status: "Active",
        version: 1,
      },
      version: 1,
      clientId: "test",
      timestamp: now,
    };
    const r = await request(app)
      .post(`${base}/push`)
      .set(hdr)
      .send({ changes: [change] })
      .expect(200);
    const results = r.body.results || [];
    expect(results[0]?.status).toBe("conflict");
    expect(results[0]?.latestVersion).toBe(2);
  });
});
