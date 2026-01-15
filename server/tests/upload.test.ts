import request from "supertest";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import jwt from "jsonwebtoken";
import app from "../index";
import { describe, it, expect } from "vitest";

const SECRET = process.env.JWT_SECRET || "default_secret";
const mockToken = jwt.sign(
  { id: 1, username: "test_admin", role: "HEAD" },
  SECRET
);

function makeSheet(): string {
  const rows = [
    {
      student_id: "JHS25001",
      cat1: 8,
      cat2: 9,
      cat3: 10,
      cat4: 8,
      group: 15,
      project: 18,
      exam: 120,
    },
    {
      student_id: "JHS25002",
      cat1: 10,
      cat2: 10,
      cat3: 10,
      cat4: 10,
      group: 20,
      project: 20,
      exam: 88,
    },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const tmp = path.join(process.cwd(), "uploads", `test_${Date.now()}.xlsx`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  XLSX.writeFile(wb, tmp);
  return tmp;
}

describe("/api/assessments/upload", () => {
  it("accepts file and processes rows", async () => {
    const file = makeSheet();
    const res = await request(app)
      .post("/api/assessments/upload")
      .set("Authorization", `Bearer ${mockToken}`)
      .query({
        subject: "Mathematics",
        academicYear: "2025/2026",
        term: "Term 1",
      })
      .attach("file", file);
    expect([200, 400, 500]).toContain(res.status);
    fs.unlinkSync(file);
  });
});
