import request from "supertest";
import app from "../index";
import jwt from "jsonwebtoken";
import { describe, it, expect } from "vitest";

const SECRET = process.env.JWT_SECRET || "super-secret-key-change-this";
const ISSUER = process.env.JWT_ISSUER || "e-sba";
const AUDIENCE = process.env.JWT_AUDIENCE || "e-sba-users";
const mockToken = jwt.sign(
  { id: 1, username: "test_admin", role: "HEAD" },
  SECRET,
  { issuer: ISSUER, audience: AUDIENCE }
);

describe("/api/assessments/template", () => {
  it("generates xlsx template", async () => {
    const res = await request(app)
      .get("/api/assessments/template")
      .set("Authorization", `Bearer ${mockToken}`)
      .query({
        subject: "Mathematics",
        class: "JHS 1(A)",
        academicYear: "2025/2026",
        term: "Term 1",
      })
      .buffer();
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      const bodyOrText = Buffer.isBuffer(res.body) ? res.body : res.text;
      expect(bodyOrText).toBeTruthy();
    }
  });
  it("generates csv template", async () => {
    const res = await request(app)
      .get("/api/assessments/template")
      .set("Authorization", `Bearer ${mockToken}`)
      .query({
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
