import { describe, it, expect, beforeEach } from "vitest";
import {
  saveAssessment,
  getAssessmentsBySubject,
  getAssessment,
  updateAssessment,
  deleteAssessment,
  exportAssessments,
  importAssessments,
  clearAllAssessments,
} from "../lib/assessmentsLocal";

describe("Local assessments persistence", () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await clearAllAssessments();
  });

  it("saves and retrieves assessment records", async () => {
    const rec = {
      subject: "Mathematics",
      assessmentType: "CAT1",
      results: [
        {
          student_id: "S001",
          cat1: 8,
          cat2: 9,
          cat3: 7,
          cat4: 10,
          group: 18,
          project: 19,
          exam: 88,
        },
      ],
      timestamp: Date.now(),
    };
    const { id } = await saveAssessment(rec);
    const items = await getAssessmentsBySubject("Mathematics");
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((x) => x.id === id)).toBe(true);
    const one = await getAssessment(id);
    expect(one?.subject).toBe("Mathematics");
    expect(one?.assessmentType).toBe("CAT1");
    expect(one?.results[0].exam).toBe(88);
  });

  it("updates assessment records", async () => {
    const rec = {
      subject: "Science",
      assessmentType: "CAT2",
      results: [
        {
          student_id: "S010",
          cat1: 7,
          cat2: 6,
          cat3: 5,
          cat4: 8,
          group: 15,
          project: 17,
          exam: 90,
        },
      ],
      timestamp: Date.now(),
    };
    const { id } = await saveAssessment(rec);
    await updateAssessment(id, {
      results: [
        {
          student_id: "S010",
          cat1: 7,
          cat2: 6,
          cat3: 5,
          cat4: 8,
          group: 15,
          project: 17,
          exam: 92,
        },
      ],
    });
    const got = await getAssessment(id);
    expect(got?.results[0].exam).toBe(92);
  });

  it("deletes assessment records", async () => {
    const rec = {
      subject: "English",
      assessmentType: "CAT3",
      results: [
        {
          student_id: "S020",
          cat1: 5,
          cat2: 6,
          cat3: 7,
          cat4: 8,
          group: 10,
          project: 12,
          exam: 70,
        },
      ],
      timestamp: Date.now(),
    };
    const { id } = await saveAssessment(rec);
    const before = await getAssessment(id);
    expect(before).not.toBeNull();
    await deleteAssessment(id);
    const after = await getAssessment(id);
    expect(after).toBeNull();
  });

  it("exports and imports assessments", async () => {
    await clearAllAssessments();
    const rec1 = {
      subject: "Mathematics",
      assessmentType: "CAT1",
      results: [
        {
          student_id: "S001",
          cat1: 8,
          cat2: 9,
          cat3: 7,
          cat4: 10,
          group: 18,
          project: 19,
          exam: 88,
        },
      ],
      timestamp: Date.now(),
    };
    const rec2 = {
      subject: "Mathematics",
      assessmentType: "CAT2",
      results: [
        {
          student_id: "S002",
          cat1: 9,
          cat2: 8,
          cat3: 7,
          cat4: 6,
          group: 18,
          project: 19,
          exam: 80,
        },
      ],
      timestamp: Date.now() + 1000,
    };
    await saveAssessment(rec1);
    await saveAssessment(rec2);
    const exported = await exportAssessments("Mathematics");
    const records = exported.items
      .map((it) => it.record)
      .filter((r): r is NonNullable<typeof r> => !!r);
    await clearAllAssessments();
    const res = await importAssessments(records);
    expect(res.saved).toBe(records.length);
    const items = await getAssessmentsBySubject("Mathematics");
    expect(items.length).toBe(2);
  });

  it("encrypts and decrypts assessment records with passphrase", async () => {
    const rec = {
      subject: "Security",
      assessmentType: "CAT1",
      results: [
        {
          student_id: "S777",
          cat1: 8,
          cat2: 8,
          cat3: 8,
          cat4: 8,
          group: 18,
          project: 19,
          exam: 99,
        },
      ],
      timestamp: Date.now(),
    };
    const pass = "strong-passphrase";
    const { id } = await saveAssessment(rec, {
      encrypt: true,
      passphrase: pass,
    });
    const got = await getAssessment(id, pass);
    expect(got?.results[0].exam).toBe(99);
  });
});
