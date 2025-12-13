import { describe, it, expect, beforeEach } from "vitest";
import { kvSet, kvGet, kvRemove, kvEnsureStandard } from "../lib/storage";
import { saveMarksSession, loadMarksSession } from "../lib/dataPersistence";

describe("KV storage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  it("sets and gets namespaced local values", () => {
    kvSet("local", "API_AUTH_TOKEN", "token123");
    const v = kvGet<string>("local", "API_AUTH_TOKEN");
    expect(v).toBe("token123");
  });
  it("sets and gets namespaced session values", () => {
    kvSet("session", "marks:JHS 1:Math:2025/2026:Term 1", { rows: [], savedAt: Date.now() });
    const v = kvGet<Record<string, unknown>>("session", "marks:JHS 1:Math:2025/2026:Term 1");
    expect(v).toBeTruthy();
  });
  it("removes values", () => {
    kvSet("local", "API_AUTH_TOKEN", "x");
    kvRemove("local", "API_AUTH_TOKEN");
    const v = kvGet<string>("local", "API_AUTH_TOKEN");
    expect(v).toBeNull();
  });
  it("ensures standard keys", () => {
    kvSet("local", "API_AUTH_TOKEN", "x");
    const res = kvEnsureStandard();
    expect(res.ok).toBe(true);
  });
});

describe("Marks session via centralized storage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  it("saves and loads marks consistently", () => {
    const q = { subject: "Math", class: "JHS 1", academicYear: "2025/2026", term: "Term 1" };
    saveMarksSession(q, []);
    const loaded = loadMarksSession(q);
    expect(loaded).not.toBeNull();
    expect(Array.isArray(loaded?.rows)).toBe(true);
  });
});
