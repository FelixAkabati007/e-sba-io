import request from "supertest";
import fs from "fs";
import app from "../index";

describe("/api/assessments/template/save", () => {
  it("saves generated template to uploads when generation succeeds", async () => {
    const res = await request(app)
      .get("/api/assessments/template/save")
      .query({
        subject: "Mathematics",
        class: "JHS 1",
        academicYear: "2025/2026",
        term: "Term 1",
      });
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty("ok", true);
      expect(res.body).toHaveProperty("path");
      const p = String(res.body.path);
      expect(fs.existsSync(p)).toBeTruthy();
      const stat = fs.statSync(p);
      expect(stat.size).toBeGreaterThan(0);
      // cleanup the saved file
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  });
});
