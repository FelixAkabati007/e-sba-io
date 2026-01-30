import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../index";

describe("DB Health Endpoint", () => {
  it("responds with health status", async () => {
    const res = await request(app).get("/api/db/health");
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty("ok", true);
    } else {
      expect(res.body).toHaveProperty("ok", false);
    }
  });
});
