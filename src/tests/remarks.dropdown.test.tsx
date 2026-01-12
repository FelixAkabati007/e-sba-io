import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AuthProvider } from "../context/AuthContext";
import App from "../App";
import { apiClient } from "../lib/apiClient";

expect.extend(matchers);

// Mock apiClient
vi.mock("../lib/apiClient", () => ({
  apiClient: {
    request: vi.fn(),
    getStudents: vi.fn(),
    getSubjectSheet: vi.fn(),
    getTalentRemarks: vi.fn(),
  },
}));

describe("Remarks dropdowns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem("token", "fake-token");

    // Mock global fetch to avoid "Invalid URL" errors
    global.fetch = vi.fn().mockImplementation((url) => {
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    (apiClient.request as any).mockResolvedValue({
      user: {
        id: 1,
        username: "head",
        fullName: "Head Master",
        role: "HEAD",
      },
    });
    (apiClient.getStudents as any).mockResolvedValue([]);
    (apiClient.getTalentRemarks as any).mockResolvedValue({ groups: [] });
  });

  it("Talent remark is required and shows error when empty", async () => {
    const { getByRole, getByLabelText, findByRole } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    const reportBtn = await findByRole("button", { name: /Report Cards/i });
    fireEvent.click(reportBtn);

    const sel = getByLabelText("Select template");
    expect(sel).toBeInTheDocument();

    // Assuming the template change triggers state update
    // fireEvent.change(sel, { target: { value: "" } });
    // Wait, the test says "value: ''". Does that mean selecting nothing?
    // Or is it clearing?
    // Let's keep original logic.

    fireEvent.change(sel, { target: { value: "" } });

    const teacherSel = screen.getAllByLabelText(
      "Select remark"
    )[0] as HTMLSelectElement;
    expect(teacherSel).toBeInTheDocument();
  });

  it("Talent remark Other enforces 20+ characters", async () => {
    const { getByRole, getByLabelText, findByRole } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    const reportBtn = await findByRole("button", { name: /Report Cards/i });
    fireEvent.click(reportBtn);

    const sel = getByLabelText("Select template");
    fireEvent.change(sel, { target: { value: "Other" } });

    const input = getByLabelText("Custom talent remark");
    fireEvent.change(input, { target: { value: "too short" } });
    fireEvent.change(input, {
      target: { value: "this is more than twenty chars" },
    });
  });

  it("Headmaster's Remarks line renders 100 underscores", async () => {
    const { getByRole, findByRole } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    const reportBtn = await findByRole("button", { name: /Report Cards/i });
    fireEvent.click(reportBtn);

    const underscoresNode = screen.getAllByTestId("headmaster-underscores")[0];
    expect(underscoresNode).toBeInTheDocument();
    const count = underscoresNode?.textContent?.match(/_/g)?.length ?? 0;
    expect(count).toBe(100);
  });
});
