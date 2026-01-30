import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildAssessmentTemplate,
  buildAssessmentTemplateCSV,
  buildAssessmentTemplateXLSX,
} from "../services/templates";
import type { PoolClient } from "pg";

class MockClient {
  // Minimal mock to satisfy type usage
  query(text: string) {
    if (text.includes("FROM subjects")) {
      return Promise.resolve({ rows: [{ subject_id: 1 }] });
    }
    if (text.includes("FROM students")) {
      return Promise.resolve({
        rows: [
          { student_id: "S001", surname: "Doe", first_name: "Jane" },
          { student_id: "S002", surname: "Smith", first_name: "John" },
        ],
      });
    }
    return Promise.resolve({ rows: [] });
  }
}

describe("assessment template headers", () => {
  const client = new MockClient() as unknown as PoolClient;
  const subject = "Mathematics";
  const className = "JHS 1(A)";
  const year = "2025/2026";
  const term = "Term 1";

  it("SheetJS template includes cat3 and cat4", async () => {
    const buf = await buildAssessmentTemplate(
      client,
      subject,
      className,
      year,
      term,
    );
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[1]];
    const json = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
    const headers = json.length ? Object.keys(json[0]) : [];
    expect(headers).toContain("cat3");
    expect(headers).toContain("cat4");
  });

  it("CSV template includes cat3 and cat4 in header", async () => {
    const csv = await buildAssessmentTemplateCSV(
      client,
      subject,
      className,
      year,
      term,
    );
    const firstLine = csv.split("\n").find((l) => l.startsWith("student_id"));
    expect(firstLine).toBeTruthy();
    expect(firstLine?.split(",")).toContain("cat3");
    expect(firstLine?.split(",")).toContain("cat4");
  });

  it("ExcelJS template includes cat3 and cat4", async () => {
    const buf = await buildAssessmentTemplateXLSX(
      client,
      subject,
      className,
      year,
      term,
    );
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
    const headers = (json[3] as string[]) || [];
    expect(headers).toContain("cat3");
    expect(headers).toContain("cat4");
  });
});
