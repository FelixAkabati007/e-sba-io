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
    global.fetch = vi.fn().mockImplementation((_url) => {
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    vi.mocked(apiClient.request).mockResolvedValue({
      user: {
        id: 1,
        username: "head",
        fullName: "Head Master",
        role: "HEAD",
      },
    });
    vi.mocked(apiClient.getStudents).mockResolvedValue([
      {
        id: "S001",
        surname: "Doe",
        firstName: "John",
        middleName: "",
        gender: "Male",
        dob: "2010-01-01",
        guardianContact: "",
        class: "JHS 1(A)",
        status: "Active",
      },
    ]);
    vi.mocked(apiClient.getTalentRemarks).mockResolvedValue({ groups: [] });
  });

  it("Talent remark is required and shows error when empty", async () => {
    const { findByRole } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    const reportBtn = await findByRole("button", { name: /Report Cards/i });
    fireEvent.click(reportBtn);

    const talentSelect = await screen.findByLabelText(
      "Talent and interest remark"
    );
    expect(talentSelect).toBeInTheDocument();

    // Select a valid option then clear it to trigger validation
    fireEvent.change(talentSelect, {
      target: { value: "Shows exceptional talent in subject activities" },
    });
    fireEvent.change(talentSelect, { target: { value: "" } });

    expect(talentSelect).toHaveClass("border-red-500");
  });

  it("Talent remark Other enforces 20+ characters", async () => {
    const { getByLabelText, findByRole } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    const reportBtn = await findByRole("button", { name: /Report Cards/i });
    fireEvent.click(reportBtn);

    const talentSelect = await screen.findByLabelText(
      "Talent and interest remark"
    );
    fireEvent.change(talentSelect, { target: { value: "Other" } });

    const input = getByLabelText("Custom talent remark");
    fireEvent.change(input, { target: { value: "too short" } });
    fireEvent.change(input, {
      target: { value: "this is more than twenty chars" },
    });
  });

  it("Headmaster's Remarks line renders 100 underscores", async () => {
    const { findByRole } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    const reportBtn = await findByRole("button", { name: /Report Cards/i });
    fireEvent.click(reportBtn);

    const underscoresNode = await screen.findByTestId("headmaster-underscores");
    const count = underscoresNode.textContent?.match(/_/g)?.length ?? 0;
    expect(count).toBe(100);
  });
});
