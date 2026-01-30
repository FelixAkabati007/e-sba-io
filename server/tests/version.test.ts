import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../index";

describe("Application Versioning", () => {
  it("GET /api/db/health should return X-App-Version header", async () => {
    const res = await request(app).get("/api/db/health");
    expect(res.status).toBe(200);
    expect(res.header["x-app-version"]).toBeDefined();
    // Default is 1.0.0 or from package.json
    expect(res.header["x-app-version"]).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });
});
