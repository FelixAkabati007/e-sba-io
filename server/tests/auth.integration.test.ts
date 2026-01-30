import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../index"; // Import the Express app

describe("Auth Integration Tests", () => {
  beforeAll(async () => {
    // Start server on a random port for testing if needed, but supertest takes the app
    // We assume the DB is available as per environment (Neon)
  });

  // Pool cleanup omitted to prevent Vitest hang on singleton pool
  // afterAll(async () => { await pool.end(); });

  it("GET /api/auth/csrf should return a token", async () => {
    const res = await request(app).get("/api/auth/csrf");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
    expect(typeof res.body.token).toBe("string");
    expect(res.header["set-cookie"]).toBeDefined();
  });

  it("GET /api/auth/csrf should set Secure cookie in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const res = await request(app).get("/api/auth/csrf");
    process.env.NODE_ENV = prev;
    expect(res.status).toBe(200);
    const setCookie = String(res.header["set-cookie"] || "");
    expect(setCookie.toLowerCase()).toContain("secure");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
  });

  it("GET /api/auth/me without token should return 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401); // Unauthorized
  });

  // Note: We avoid testing /login explicitly to respect "do not interfere with login system"
  // but we can verify /me if we had a token.
  // Since we don't want to rely on seeding or known users that might change,
  // we'll stick to verifying the public endpoints and failure modes.

  it("POST /api/auth/login with mismatched CSRF should return 403", async () => {
    const csrfRes = await request(app).get("/api/auth/csrf");
    const cookies = csrfRes.header["set-cookie"];
    const mismatchedToken = "not-the-token";
    const res = await request(app)
      .post("/api/auth/login")
      .set("Cookie", cookies)
      .set("x-csrf-token", mismatchedToken)
      .send({ username: "any", password: "any-password" });
    expect(res.status).toBe(403);
  });

  it("POST /api/auth/login with malformed cookie header should not crash", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Cookie", "csrf-token=%E0%A4%A") // bad percent-encoding
      .set("x-csrf-token", "token")
      .send({ username: "u", password: "p" });
    expect([400, 403]).toContain(res.status); // should be a handled error, not 500
  });
});
