import { describe, it, expect } from "vitest";
import { ClientSync, type StudentDoc, type Change } from "../lib/sync";
import { metrics } from "../lib/metrics";

describe("ClientSync payload validation", () => {
  const base = "/api";

  it("requeues on invalid push results and increments metric", async () => {
    metrics.reset();
    const adapter = {
      async post(_url: string, body: unknown) {
        const changes = (body as { changes: Change[] }).changes;
        const badResults = changes.map(() => ({}));
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: badResults, checkpoint: Date.now() }),
        };
      },
      async get() {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      },
    };
    const sync = new ClientSync({ baseUrl: base, adapter });
    const doc: StudentDoc = {
      id: "CS-VALIDATION-1",
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
    expect(snap.counters["sync_invalid_payload"] || 0).toBe(1);
  });
});
