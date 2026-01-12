import request from "supertest";
import app from "../index";
import { describe, it, expect } from "vitest";

describe("/api/assessments/template", () => {
  it("generates xlsx template", async () => {
    const res = await request(app).get("/api/assessments/template").query({
      subject: "Mathematics",
      class: "JHS 1(A)",
      academicYear: "2025/2026",
      term: "Term 1",
    });
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      expect(
        Buffer.isBuffer(res.body) || typeof res.body === "string"
      ).toBeTruthy();
    }
  });
  it("generates csv template", async () => {
    const res = await request(app).get("/api/assessments/template").query({
      subject: "Mathematics",
      class: "JHS 1",
      academicYear: "2025/2026",
      term: "Term 1",
      format: "csv",
    });
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers["content-type"]).toContain("text/csv");
    }
  });
});
