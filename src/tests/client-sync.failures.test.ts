import { describe, it, expect } from "vitest";
import { ClientSync, type StudentDoc, type Change } from "../lib/sync";
import { metrics } from "../lib/metrics";

const makeFailAdapter = (status: number) => ({
  async get() {
    return { ok: false, status, json: async () => ({}) };
  },
  async post() {
    return { ok: false, status, json: async () => ({}) };
  },
});

describe("ClientSync failure handling", () => {
  const base = "/api";

  it("handles auth failure (403) and records metrics", async () => {
    metrics.reset();
    const adapter = makeFailAdapter(403);
    const sync = new ClientSync({ baseUrl: base, adapter });
    const doc: StudentDoc = {
      id: "CS-FAIL-403",
      surname: "A",
      firstName: "B",
      gender: "Other",
      dob: "2000-01-01",
      class: "JHS 1",
      status: "Active",
      version: 1,
    };
    sync.queueUpsert(doc);
    const st = await sync.flush();
    expect(st.pending).toBeGreaterThan(0);
    const snap = metrics.snapshot();
    expect(snap.counters["sync_auth_failed"] || 0).toBe(1);
  });

  it("handles rate limit (429) and records metrics", async () => {
    metrics.reset();
    const adapter = makeFailAdapter(429);
    const sync = new ClientSync({ baseUrl: base, adapter });
    const doc: StudentDoc = {
      id: "CS-FAIL-429",
      surname: "A",
      firstName: "B",
      gender: "Other",
      dob: "2000-01-01",
      class: "JHS 1",
      status: "Active",
      version: 1,
    };
    sync.queueUpsert(doc);
    const st = await sync.flush();
    expect(st.pending).toBeGreaterThan(0);
    const snap = metrics.snapshot();
    expect(snap.counters["sync_rate_limited"] || 0).toBe(1);
  });

  it("resolves conflicts via resolver and updates metrics", async () => {
    metrics.reset();
    const adapter = {
      async post(_url: string, body: unknown) {
        const changes = (body as { changes: Change[] }).changes;
        const results = changes.map((c) => ({
          id: c.id,
          status: "conflict",
          latestVersion: 2,
        }));
        return {
          ok: true,
          status: 200,
          json: async () => ({ results, checkpoint: Date.now() }),
        };
      },
      async get() {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      },
    };
    const resolver = (
      local: Change,
      remote: { latestVersion: number }
    ): Change => {
      const nextVersion = remote.latestVersion + 1;
      return {
        ...local,
        version: nextVersion,
        doc: { ...(local.doc as StudentDoc), version: nextVersion },
        timestamp: Date.now(),
      };
    };
    const sync = new ClientSync({
      baseUrl: base,
      adapter,
      resolveConflict: resolver,
    });
    const doc: StudentDoc = {
      id: "CS-RESOLVE-1",
      surname: "A",
      firstName: "B",
      gender: "Other",
      dob: "2000-01-01",
      class: "JHS 1",
      status: "Active",
      version: 1,
    };
    sync.queueUpsert(doc);
    const st = await sync.flush();
    expect(st.pending).toBeGreaterThan(0);
    const snap = metrics.snapshot();
    expect(snap.counters["sync_conflict_resolved"] || 0).toBeGreaterThan(0);
  });
});
