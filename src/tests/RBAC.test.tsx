import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import App from "../App";
import { AuthProvider } from "../context/AuthContext";
import { apiClient } from "../lib/apiClient";

// Mock apiClient
vi.mock("../lib/apiClient", () => ({
  apiClient: {
    getStudents: vi.fn(),
    getSubjectSheet: vi.fn(),
    request: vi.fn(),
    getTalentRemarks: vi.fn(),
  },
}));

describe("RBAC Progress Bars", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "fake-token");
    vi.clearAllMocks();

    // Mock global fetch for ProgressBar
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/config/academic")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            academicYear: "2025/2026",
            term: "Term 1",
          }),
        });
      }
      if (typeof url === "string" && url.includes("/api/config/school")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            name: "Test School",
            motto: "Test Motto",
            headTeacher: "Test Head",
            address: "Test Address",
            catWeight: 50,
            examWeight: 50,
            logoUrl: null,
            signatureEnabled: true,
            headSignatureUrl: null,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows only assigned subject progress for SUBJECT teacher", async () => {
    (apiClient.getStudents as any).mockResolvedValue([]);
    (apiClient.request as any).mockResolvedValue({
      user: {
        role: "SUBJECT",
        fullName: "Math Teacher",
        username: "mathuser",
        assignedClassName: null,
        assignedSubjectName: "Mathematics",
      },
    });
    (apiClient.getSubjectSheet as any).mockResolvedValue({ rows: [] });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome, Math Teacher")).toBeInTheDocument();
    });

    // Check Assessment Progress Section
    await waitFor(() => {
      expect(screen.getByText(/Assessment Progress/)).toBeInTheDocument();
    });

    // Mathematics should be visible (as a progress bar label)
    // Note: The main tiles also have "Mathematics", but we want to check the progress section specifically.
    // The progress section is rendered as:
    // <span className="font-medium">{SUBJECT_DISPLAY_NAMES[subj]}</span>
    // <span className="font-bold ...">0%</span>

    // We can look for the "0%" next to Mathematics, but that's tricky.
    // However, if we look for ALL occurrences of "Mathematics", we should find it.
    // If we look for "English Language", it should NOT be present in the progress section.

    // Since the main tiles are also filtered (hopefully, from previous tasks), checking for English Language absence is good.
    // But let's check the progress bar specifically.
    // The progress bar container has class "bg-slate-50 p-3 rounded-md border border-slate-100"

    // Let's rely on text content for now.

    // "Mathematics" should be present.
    expect(screen.getAllByText("Mathematics").length).toBeGreaterThan(0);

    // "English Language" should NOT be present in the document at all if tiles are also filtered.
    // If tiles are NOT filtered for SUBJECT teacher (which they should be), then this test might fail if I didn't filter tiles.
    // But the user request specifically mentioned "Assessment Progress bar".

    // Let's verify if "English Language" is present.
    const englishElements = screen.queryAllByText("English Language");
    expect(englishElements.length).toBe(0);
  });

  it("shows all subjects for HEAD teacher", async () => {
    (apiClient.getStudents as any).mockResolvedValue([]);
    (apiClient.request as any).mockResolvedValue({
      user: {
        role: "HEAD",
        fullName: "Head Teacher",
        username: "headuser",
        assignedClassName: null,
        assignedSubjectName: null,
      },
    });

    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome, Head Teacher")).toBeInTheDocument();
    });

    expect(screen.getByText(/Assessment Progress/)).toBeInTheDocument();

    // Should see multiple subjects
    expect(screen.getAllByText("Mathematics").length).toBeGreaterThan(0);
    expect(screen.getAllByText("English Language").length).toBeGreaterThan(0);
  });
});
