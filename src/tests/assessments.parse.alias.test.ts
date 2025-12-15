import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import fs from "fs";
import os from "os";
import path from "path";
import { parseAssessmentSheet } from "../../server/services/assessments";

function writeWorkbook(headers: string[], rows: Array<Array<unknown>>): string {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e-sba-"));
  const filePath = path.join(dir, `sheet_${Date.now()}.xlsx`);
  XLSX.writeFile(wb, filePath);
  return filePath;
}

describe("parseAssessmentSheet alias headers", () => {
  it("maps alias headers to required fields", async () => {
    const headers = [
      "StudentID",
      "Cat1 Score",
      "Cat2 Score",
      "Cat3 Score",
      "Cat4 Score",
      "Group Work",
      "Project Work",
      "Exam Score",
    ];
    const rows = [["S001", 9, 10, 8, 7, 18, 20, 88]];
    const filePath = writeWorkbook(headers, rows);
    const { rows: parsed, errors } = await parseAssessmentSheet(filePath);
    expect(errors.length).toBe(0);
    expect(parsed.length).toBe(1);
    expect(parsed[0].student_id).toBe("S001");
    expect(parsed[0].cat1).toBe(9);
    expect(parsed[0].group).toBe(18);
    expect(parsed[0].exam).toBe(88);
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });

  it("reports missing required columns", async () => {
    const headers = [
      "StudentID",
      "Cat1 Score",
      "Cat2 Score",
      "Cat3 Score",
      "Cat4 Score",
      "Group Work",
      "Project Work",
    ];
    const rows = [["S002", 5, 6, 7, 8, 10, 12]];
    const filePath = writeWorkbook(headers, rows);
    const { rows: parsed, errors } = await parseAssessmentSheet(filePath);
    expect(parsed.length).toBe(1);
    expect(errors.some((e) => e.toLowerCase().includes("missing columns"))).toBe(
      true
    );
    expect(errors.join(" ").toLowerCase()).toContain("exam");
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });

  it("clamps and reports non-numeric values", async () => {
    const headers = [
      "StudentID",
      "Cat1 Score",
      "Cat2 Score",
      "Cat3 Score",
      "Cat4 Score",
      "Group Work",
      "Project Work",
      "Exam Score",
    ];
    const rows = [["S003", "abc", 10, 8, 7, 18, 20, 88]];
    const filePath = writeWorkbook(headers, rows);
    const { rows: parsed, errors } = await parseAssessmentSheet(filePath);
    expect(parsed.length).toBe(1);
    expect(parsed[0].cat1).toBe(0);
    expect(errors.some((e) => e.toLowerCase().includes("cat1 is not a number"))).toBe(
      true
    );
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  });
});

