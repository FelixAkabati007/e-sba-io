import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../server/index";

describe.skip("Sync pull ordering and dedup", () => {
  const base = "/api/sync";
  const db = "/api/blobdb";

  it("deduplicates by id and prefers latest change", async () => {
    const token =
      process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
    const hdr = token ? { "x-blob-token": token } : {};
    const id = "SYNC-ORDER-1";
    const t1 = Date.now();
    const change1 = {
      id,
      type: "upsert",
      doc: {
        id,
        surname: "Order",
        firstName: "One",
        gender: "Other",
        dob: "2000-01-01",
        class: "JHS 1(A)",
        status: "Active",
        version: 1,
      },
      version: 1,
      clientId: "test",
      timestamp: t1,
    };
    const t2 = t1 + 10;
    const change2 = {
      id,
      type: "upsert",
      doc: {
        id,
        surname: "Order",
        firstName: "Two",
        gender: "Other",
        dob: "2000-01-01",
        class: "JHS 1(A)",
        status: "Active",
        version: 2,
      },
      version: 2,
      clientId: "test",
      timestamp: t2,
    };
    await request(app)
      .post(`${base}/push`)
      .set(hdr)
      .send({ changes: [change1, change2] })
      .expect(200);
    const r = await request(app)
      .get(`${base}/pull`)
      .query({ since: t1 - 1, limit: 100 })
      .expect(200);
    const items = r.body.items || [];
    const occurrences = items.filter(
      (x: { id?: string }) => x.id === id
    ).length;
    expect(occurrences).toBe(1);
    if (token) {
      const g = await request(app).get(`${db}/students/${id}`).expect(200);
      expect(g.body.version).toBe(2);
    }
  });
});
