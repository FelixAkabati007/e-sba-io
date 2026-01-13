import { describe, it, expect } from "vitest";
import { buildImportedStudents, Student } from "../lib/masterdbImport";

describe("MasterDB import validation", () => {
  const selectedClass = "JHS 1(A)";
  const academicYear = "2025/2026";

  it("rejects rows missing required names", () => {
    const existing: Student[] = [];
    const preview = [
      { id: "A1", surname: "DOE", firstname: "" },
      { id: "A2", surname: "", firstname: "John" },
    ];
    const { newStudents, addedCount, skippedCount } = buildImportedStudents(
      preview,
      existing,
      selectedClass,
      academicYear
    );
    expect(newStudents.length).toBe(0);
    expect(addedCount).toBe(0);
    expect(skippedCount).toBe(2);
  });

  it("skips duplicates by ID", () => {
    const existing: Student[] = [
      {
        id: "S1",
        surname: "DOE",
        firstName: "JOHN",
        middleName: "",
        gender: "Male",
        class: selectedClass,
        status: "Active",
        dob: "2000-01-01",
        guardianContact: "000",
      },
    ];
    const preview = [
      { id: "S1", surname: "SMITH", firstname: "ALICE" },
      { id: "S1", surname: "BROWN", firstname: "BOB" },
    ];
    const { newStudents, addedCount, skippedCount } = buildImportedStudents(
      preview,
      existing,
      selectedClass,
      academicYear
    );
    expect(newStudents.length).toBe(0);
    expect(addedCount).toBe(0);
    expect(skippedCount).toBe(2);
  });

  it("auto-generates IDs and imports valid rows", () => {
    const existing: Student[] = [];
    const preview = [
      { surname: "Smith", firstname: "Alice", gender: "Female" },
      { surname: "Brown", firstname: "Bob", gender: "Male" },
    ];
    const { newStudents, addedCount, skippedCount } = buildImportedStudents(
      preview,
      existing,
      selectedClass,
      academicYear
    );
    expect(addedCount).toBe(2);
    expect(skippedCount).toBe(0);
    expect(newStudents[0].id).toMatch(/^JHS25\d{3}$/);
    expect(newStudents[1].id).toMatch(/^JHS25\d{3}$/);
  });

  it("ensures dateOfBirth is populated matching dob", () => {
    const existing: Student[] = [];
    const preview = [
      { surname: "Smith", firstname: "Alice", dob: "2005-05-05" },
    ];
    const { newStudents } = buildImportedStudents(
      preview,
      existing,
      selectedClass,
      academicYear
    );
    expect(newStudents[0].dob).toBe("2005-05-05");
    expect(newStudents[0].dateOfBirth).toBe("2005-05-05");
  });

  it("handles large datasets within reasonable time", () => {
    const existing: Student[] = [];
    const rows = 5000;
    const preview = Array.from({ length: rows }).map((_, i) => ({
      surname: `User${i}`,
      firstname: `Test${i}`,
      gender: i % 2 === 0 ? "Male" : "Female",
    }));
    const t0 = performance.now();
    const { newStudents, addedCount, skippedCount } = buildImportedStudents(
      preview,
      existing,
      selectedClass,
      academicYear
    );
    const t1 = performance.now();
    expect(addedCount).toBe(rows);
    expect(skippedCount).toBe(0);
    expect(newStudents.length).toBe(rows);
    expect(t1 - t0).toBeLessThan(5000);
  });
});
