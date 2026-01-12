import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { toBeInTheDocument } from "@testing-library/jest-dom/matchers";
expect.extend({ toBeInTheDocument });
import App from "../App";
import { AuthProvider } from "../context/AuthContext";

describe("Grading Overview", () => {
  it("renders Grading Overview with legend", () => {
    const { getByRole, getByText } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );
    const reportBtn = getByRole("button", { name: /Report Cards/i });
    fireEvent.click(reportBtn);
    const title = getByText("Grading Overview");
    expect(title).toBeInTheDocument();
    const legend = getByText("Grading Scale");
    expect(legend).toBeInTheDocument();
  });
});
