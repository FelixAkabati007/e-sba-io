import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../App";

describe("App", () => {
  it("renders header and navigates to Subject view", () => {
    render(<App />);
    expect(screen.getByText(/E-SBA \[JHS]/)).toBeInTheDocument();
    expect(screen.getByText(/Core Subjects/)).toBeInTheDocument();
    const tile = screen.getByText("Mathematics");
    fireEvent.click(tile);
    expect(screen.getByText(/Assessment Sheet/)).toBeInTheDocument();
  });

  it("clamps marks values to valid ranges", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Mathematics"));
    const inputs = screen.getAllByRole("spinbutton");
    const examInput = inputs[inputs.length - 1];
    fireEvent.change(examInput, { target: { value: "120" } });
    expect((examInput as HTMLInputElement).value).toBe("100");
  });
});
