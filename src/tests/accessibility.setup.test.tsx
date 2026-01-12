import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import App from "../App";
import { AuthProvider } from "../context/AuthContext";

describe("Accessibility setup section", () => {
  it("associates signature toggle with its label", () => {
    const { getByRole, getByLabelText } = render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );
    const setupBtn = getByRole("button", { name: /System Setup/i });
    fireEvent.click(setupBtn);
    const checkbox = getByLabelText("Display on reports") as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.type).toBe("checkbox");
  });
});

