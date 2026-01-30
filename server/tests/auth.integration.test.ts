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

  it("GET /api/auth/me without token should return 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401); // Unauthorized
  });

  // Note: We avoid testing /login explicitly to respect "do not interfere with login system"
  // but we can verify /me if we had a token.
  // Since we don't want to rely on seeding or known users that might change,
  // we'll stick to verifying the public endpoints and failure modes.
});
