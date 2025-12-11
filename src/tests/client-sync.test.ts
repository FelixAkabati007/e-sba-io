import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../server/index";
import { ClientSync, type StudentDoc, type Change } from "../lib/sync";

const makeAdapter = (): {
  get: (
    url: string,
    headers?: Record<string, string>
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  post: (
    url: string,
    body: unknown,
    headers?: Record<string, string>
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
} => ({
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
});

describe("ClientSync conflicts", () => {
  const base = "/api";
  const db = "/api/blobdb";

  it("drops conflicting change by default (server-wins)", async () => {
    const token =
      process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
    const hdr = token ? { "x-blob-token": token } : {};
    const id = "CS-CONFLICT-1";
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

    const sync = new ClientSync({
      baseUrl: base,
      token,
      adapter: makeAdapter(),
      throttleMs: 200,
      batchSize: 10,
    });
    const doc: StudentDoc = {
      id,
      surname: "Client",
      firstName: "Edit",
      gender: "Other",
      dob: "2000-01-01",
      class: "JHS 1",
      status: "Active",
      version: 1,
    };
    sync.queueUpsert(doc);
    await sync.flush();
    expect(sync.getPendingCount()).toBe(0);
  });

  it("resolves conflict with client-wins strategy when provided", async () => {
    const token =
      process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_BLOB_RW_TOKEN;
    const hdr = token ? { "x-blob-token": token } : {};
    const id = "CS-CONFLICT-2";
    await request(app)
      .post(`${db}/students`)
      .set(hdr)
      .send({
        id,
        surname: "Server",
        firstName: "Two",
        gender: "Other",
        dob: "2000-01-01",
        class: "JHS 1",
        status: "Active",
        version: 2,
      })
      .expect(200);

    const adapter = makeAdapter();
    const resolver = (
      local: Change,
      remote: { latestVersion: number; latestDoc?: StudentDoc }
    ): Change | null => {
      const nextVersion = (remote.latestVersion || 0) + 1;
      const doc: StudentDoc = {
        ...(local.doc as StudentDoc),
        version: nextVersion,
      };
      return { ...local, doc, version: nextVersion, timestamp: Date.now() };
    };
    const sync = new ClientSync({
      baseUrl: base,
      token,
      adapter,
      throttleMs: 200,
      batchSize: 10,
      resolveConflict: resolver,
    });
    const doc: StudentDoc = {
      id,
      surname: "Client",
      firstName: "Override",
      gender: "Other",
      dob: "2000-01-01",
      class: "JHS 1",
      status: "Active",
      version: 1,
    };
    sync.queueUpsert(doc);
    await sync.flush();
    await sync.flush();
    const r = await request(app).get(`${db}/students/${id}`).expect(200);
    expect(r.body.version).toBe(3);
    expect(r.body.firstName).toBe("Override");
  });
});
