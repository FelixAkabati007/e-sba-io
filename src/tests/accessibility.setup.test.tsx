import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import App from "../App";
import { AuthProvider } from "../context/AuthContext";
import { apiClient } from "../lib/apiClient";

// Mock apiClient
vi.mock("../lib/apiClient", () => ({
  apiClient: {
    request: vi.fn(),
    getStudents: vi.fn(),
    getSubjectSheet: vi.fn(),
    getTalentRemarks: vi.fn(),
  },
}));

describe("Accessibility setup section", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "fake-token");
    vi.clearAllMocks();
  });

  it("associates signature toggle with its label", async () => {
    vi.mocked(apiClient.request).mockImplementation((url: string) => {
      if (url === "/auth/me") {
        return Promise.resolve({
          user: {
            id: 1,
            username: "head",
            fullName: "Head Teacher",
            role: "HEAD",
          },
        });
      }
      return Promise.reject(new Error("Not found"));
    });

    const { getByRole, getByLabelText } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(apiClient.request).toHaveBeenCalledWith("/auth/me", "GET");
    });

    const setupBtn = await waitFor(() =>
      getByRole("button", { name: /System Setup/i })
    );
    fireEvent.click(setupBtn);
    const checkbox = getByLabelText("Display on reports") as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.type).toBe("checkbox");
  });
});
