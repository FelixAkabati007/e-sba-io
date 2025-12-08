import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import type { PoolConnection } from "mysql2/promise";
import type { Worksheet } from "exceljs";

export async function buildAssessmentTemplate(
  conn: PoolConnection,
  subjectName: string,
  className: string,
  academicYear: string,
  term: string
): Promise<Buffer> {
  const [subRows] = await conn.query(
    "SELECT subject_id FROM subjects WHERE subject_name=? LIMIT 1",
    [subjectName]
  );
  const subs = subRows as Array<{ subject_id: number }>;
  if (subs.length === 0) throw new Error("Subject not found");

  const [stuRows] = await conn.query(
    `SELECT s.student_id, s.surname, s.first_name
     FROM students s
     JOIN classes c ON s.current_class_id = c.class_id
     WHERE c.class_name = ?
     ORDER BY s.surname, s.first_name`,
    [className]
  );
  const students = stuRows as Array<{
    student_id: string;
    surname: string;
    first_name: string;
  }>;

  const meta = [
    { Key: "Subject", Value: subjectName },
    { Key: "Class", Value: className },
    { Key: "AcademicYear", Value: academicYear },
    { Key: "Term", Value: term },
    { Key: "GeneratedAt", Value: new Date().toISOString() },
  ];
  const wsMeta = XLSX.utils.json_to_sheet(meta, { header: ["Key", "Value"] });
  wsMeta["!ref"] = wsMeta["!ref"] || "A1:B6";

  const header = [
    "student_id",
    "surname",
    "first_name",
    "cat1",
    "cat2",
    "cat3",
    "cat4",
    "group",
    "project",
    "exam",
  ];
  const rows = students.map((s) => ({
    student_id: s.student_id,
    surname: s.surname,
    first_name: s.first_name,
    cat1: "",
    cat2: "",
    cat3: "",
    cat4: "",
    group: "",
    project: "",
    exam: "",
  }));
  const wsData = XLSX.utils.json_to_sheet(rows, { header });
  (
    wsData as unknown as {
      [key: string]: unknown;
      "!cols": Array<{ wch: number }>;
    }
  )["!cols"] = [
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 6 },
    { wch: 6 },
    { wch: 6 },
    { wch: 6 },
    { wch: 6 },
    { wch: 8 },
    { wch: 6 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsMeta, "_meta");
  XLSX.utils.book_append_sheet(
    wb,
    wsData,
    subjectName.replace(/[^A-Za-z0-9_-]/g, "_")
  );
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf;
}

function csvEscape(v: string): string {
  if (v.includes('"') || v.includes(",") || v.includes("\n")) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

export async function buildAssessmentTemplateCSV(
  conn: PoolConnection,
  subjectName: string,
  className: string,
  academicYear: string,
  term: string
): Promise<string> {
  const [stuRows] = await conn.query(
    `SELECT s.student_id, s.surname, s.first_name
     FROM students s
     JOIN classes c ON s.current_class_id = c.class_id
     WHERE c.class_name = ?
     ORDER BY s.surname, s.first_name`,
    [className]
  );
  const students = stuRows as Array<{
    student_id: string;
    surname: string;
    first_name: string;
  }>;
  const lines: string[] = [];
  const meta = [
    ["Subject", subjectName],
    ["Class", className],
    ["AcademicYear", academicYear],
    ["Term", term],
    ["GeneratedAt", new Date().toISOString()],
  ];
  meta.forEach(([k, v]) => lines.push(`${csvEscape(k)},${csvEscape(v)}`));
  lines.push("");
  lines.push(
    [
      "student_id",
      "surname",
      "first_name",
      "cat1",
      "cat2",
      "cat3",
      "cat4",
      "group",
      "project",
      "exam",
    ].join(",")
  );
  students.forEach((s) => {
    lines.push(
      [
        csvEscape(s.student_id),
        csvEscape(s.surname),
        csvEscape(s.first_name),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(",")
    );
  });
  return lines.join("\n");
}

export function validateWorkbook(buf: Buffer): boolean {
  try {
    if (buf.length < 4) return false;
    const sig0 =
      buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    if (!sig0) return false;
    const wb = XLSX.read(buf, { type: "buffer" });
    return Array.isArray(wb.SheetNames) && wb.SheetNames.length > 0;
  } catch {
    return false;
  }
}

export async function buildAssessmentTemplateXLSX(
  conn: PoolConnection,
  subjectName: string,
  className: string,
  academicYear: string,
  term: string
): Promise<Buffer> {
  const [stuRows] = await conn.query(
    `SELECT s.student_id, s.surname, s.first_name
     FROM students s
     JOIN classes c ON s.current_class_id = c.class_id
     WHERE c.class_name = ?
     ORDER BY s.surname, s.first_name`,
    [className]
  );
  const students = stuRows as Array<{
    student_id: string;
    surname: string;
    first_name: string;
  }>;

  const wb = new ExcelJS.Workbook();
  wb.creator = process.env.SCHOOL_NAME || "E-SBA";
  wb.created = new Date();

  const ws = wb.addWorksheet(subjectName.replace(/[^A-Za-z0-9_-]/g, "_"), {
    properties: { defaultRowHeight: 18 },
    views: [{ state: "frozen", xSplit: 0, ySplit: 4 }],
  });

  // Validate a single cell address like A1 or AA10
  function isCell(addr: string): boolean {
    return /^[A-Z]+\d+$/.test(addr);
  }

  // Validate a range address like A1:J10
  function isRange(r: string): boolean {
    return /^[A-Z]+\d+:[A-Z]+\d+$/.test(r);
  }

  function ensureRange(range: string): string {
    if (isRange(range)) return range;
    // support receiving two cell refs joined by ':' accidentally including spaces
    const parts = range
      .split(":")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 2 && isCell(parts[0]) && isCell(parts[1])) {
      return `${parts[0]}:${parts[1]}`;
    }
    throw new Error(`invalid merge range: ${range}`);
  }

  // Accept either (sheet, "A1:J1") or (sheet, "A1", "J1")
  function safeMerge(sheet: Worksheet, a: string, b?: string): void {
    let range: string;
    if (b === undefined) {
      range = a;
    } else {
      // a and b should be single cell addresses
      if (!isCell(a) || !isCell(b))
        throw new Error(`invalid merge endpoints: ${a}, ${b}`);
      range = `${a}:${b}`;
    }
    sheet.mergeCells(ensureRange(range));
  }

  ws.columns = [
    { header: "student_id", key: "student_id", width: 14 },
    { header: "surname", key: "surname", width: 18 },
    { header: "first_name", key: "first_name", width: 16 },
    { header: "cat1", key: "cat1", width: 8 },
    { header: "cat2", key: "cat2", width: 8 },
    { header: "cat3", key: "cat3", width: 8 },
    { header: "cat4", key: "cat4", width: 8 },
    { header: "group", key: "group", width: 8 },
    { header: "project", key: "project", width: 9 },
    { header: "exam", key: "exam", width: 8 },
  ];

  safeMerge(ws, "A1:J1");
  const title = ws.getCell("A1");
  title.value = `${
    process.env.SCHOOL_NAME || "E-SBA [JHS]"
  } — ${subjectName} Assessment Sheet`;
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.font = { bold: true, size: 14 };

  safeMerge(ws, "A2:J2");
  const sub = ws.getCell("A2");
  sub.value = `Class: ${className}  •  Academic Year: ${academicYear}  •  Term: ${term}`;
  sub.alignment = { horizontal: "center", vertical: "middle" };
  sub.font = { size: 11, color: { argb: "FF1F4ED8" } };

  safeMerge(ws, "A3:J3");
  const meta = ws.getCell("A3");
  meta.value = `Template Generated: ${new Date().toISOString()}`;
  meta.alignment = { horizontal: "center", vertical: "middle" };
  meta.font = { size: 9, color: { argb: "FF64748B" } };

  const headerRow = ws.addRow(ws.columns.map((c) => c.header));
  headerRow.height = 20;
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: colNumber <= 3 ? "FF334155" : "FF2563EB" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });

  students.forEach((s) => {
    const row = ws.addRow({
      student_id: s.student_id,
      surname: s.surname,
      first_name: s.first_name,
      cat1: null,
      cat2: null,
      cat3: null,
      cat4: null,
      group: null,
      project: null,
      exam: null,
    });
    row.eachCell((cell, colNumber) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      if (colNumber >= 4) {
        cell.alignment = { horizontal: "center" };
        cell.numFmt = "0";
      }
    });
  });

  ws.getColumn("cat1").outlineLevel = 1;
  ws.getColumn("cat2").outlineLevel = 1;
  ws.getColumn("cat3").outlineLevel = 1;
  ws.getColumn("cat4").outlineLevel = 1;
  ws.getColumn("group").outlineLevel = 1;
  ws.getColumn("project").outlineLevel = 1;
  ws.getColumn("exam").outlineLevel = 1;

  const buf = await wb.xlsx.writeBuffer();
  // Verify OOXML loads with ExcelJS to catch malformed merges / XML
  try {
    await validateWorkbookXLSX(Buffer.from(buf));
  } catch (err) {
    // Propagate a clearer error for callers
    throw new Error(
      `generated workbook failed OOXML validation: ${(err as Error).message}`
    );
  }

  return Buffer.from(buf);
}

/**
 * Validate an XLSX buffer by attempting to load it with ExcelJS and SheetJS.
 * This helps catch malformed OOXML (including bad merge ranges) that Excel 2016 is strict about.
 */
export async function validateWorkbookXLSX(buf: Buffer): Promise<boolean> {
  try {
    if (buf.length < 4) return false;
    const sig0 =
      buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    if (!sig0) return false;
    // Quick parse with SheetJS
    const wb = XLSX.read(buf, { type: "buffer" });
    if (!Array.isArray(wb.SheetNames) || wb.SheetNames.length === 0)
      return false;
    // Also ensure ExcelJS can parse the OOXML parts
    const xwb = new ExcelJS.Workbook();
    await xwb.xlsx.load(buf);
    if (!Array.isArray(xwb.worksheets) || xwb.worksheets.length === 0)
      return false;
    return true;
  } catch (e) {
    throw new Error(`OOXML validation failed: ${(e as Error).message}`);
  }
}
