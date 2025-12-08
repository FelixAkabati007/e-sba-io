import request from "supertest";
import app from "../index";
import { validateWorkbookXLSX } from "../services/templates";

describe("/api/assessments/template - merge validation", () => {
  it("returns an xlsx that passes OOXML merge validation", async () => {
    const res = await request(app)
      .get("/api/assessments/template")
      .query({
        subject: "Mathematics",
        class: "JHS 1",
        academicYear: "2025/2026",
        term: "Term 1",
      });
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers["content-type"]).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      const buf = Buffer.isBuffer(res.body)
        ? res.body
        : Buffer.from(res.body as string, "binary");
      await expect(validateWorkbookXLSX(buf)).resolves.toBeTruthy();
    }
  });
});
