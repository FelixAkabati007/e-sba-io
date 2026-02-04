import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index";

describe("Auth configuration and CSRF", () => {
  let prevNodeEnv: string | undefined;
  let prevJwt: string | undefined;

  beforeAll(() => {
    prevNodeEnv = process.env.NODE_ENV;
    prevJwt = process.env.JWT_SECRET;
  });

  afterAll(() => {
    if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
    if (prevJwt !== undefined) process.env.JWT_SECRET = prevJwt;
  });

  it("sets CSRF cookie with defaults", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_SAMESITE;
    delete process.env.CSRF_SECURE;
    const res = await request(app).get("/api/auth/csrf");
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"]?.[0] || "";
    expect(setCookie.toLowerCase()).toContain("csrf-token=");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
  });

  it("rejects login when JWT_SECRET is not set in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "super-secret-key-change-this";
    process.env.CSRF_SECURE = "false"; // Allow cookie over HTTP in tests
    const agent = request.agent(app);
    const csrf = await agent.get("/api/auth/csrf");
    const token = csrf.body?.token || "";
    const res = await agent
      .post("/api/auth/login")
      .set("x-csrf-token", token)
      .send({ username: "u", password: "p" });
    expect(res.status).toBe(503);
  });
});
