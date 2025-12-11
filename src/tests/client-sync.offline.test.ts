import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../../server/index";
import { ClientSync, type StudentDoc } from "../lib/sync";

describe("ClientSync offline handling", () => {
  const base = "/api";
  const db = "/api/blobdb";
  interface GlobalWithNavigator {
    navigator?: unknown;
  }
  let originalNavigator: unknown;

  beforeAll(() => {
    const g = global as unknown as GlobalWithNavigator;
    originalNavigator = g.navigator;
    g.navigator = { onLine: false } as unknown;
  });

  afterAll(() => {
    const g = global as unknown as GlobalWithNavigator;
    g.navigator = originalNavigator;
  });

  it("queues while offline and flushes when back online", async () => {
    const token =
      process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
    const id = "CS-OFFLINE-1";
    const adapter = {
      async get(url: string, headers?: Record<string, string>) {
        const r = await request(app)
          .get(url)
          .set(headers || {});
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => r.body,
        };
      },
      async post(url: string, body: unknown, headers?: Record<string, string>) {
        const r = await request(app)
          .post(url)
          .set(headers || {})
          .send(body as object);
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => r.body,
        };
      },
    };
    const sync = new ClientSync({
      baseUrl: base,
      token,
      adapter,
      throttleMs: 200,
      batchSize: 10,
    });
    const doc: StudentDoc = {
      id,
      surname: "Offline",
      firstName: "User",
      gender: "Other",
      dob: "2000-01-01",
      class: "JHS 1",
      status: "Active",
      version: 1,
    };
    sync.queueUpsert(doc);
    const st1 = await sync.flush();
    expect(st1.pending).toBeGreaterThan(0);
    const g = global as unknown as GlobalWithNavigator;
    g.navigator = { onLine: true } as unknown;
    const _st2 = await sync.flush();
    const st3 = await sync.flush();
    expect(st3.pending).toBe(0);
    const r = await request(app).get(`${db}/students/${id}`).expect(200);
    expect(r.body.id).toBe(id);
  });
});
