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
    const examInputs = screen.getAllByDisplayValue(/\d+/);
    // find an exam input by placeholder role: we set via bg-red-50 column, so pick last numeric input in row
    // simulate typing 120 and expect computed 50% exam cell to reflect clamp to 100
    const input = screen.getByDisplayValue("75");
    fireEvent.change(input, { target: { value: "120" } });
    // Now the SBA exam half should show 50.0 for 50% weighting
    expect(screen.getByText(/50\.0/)).toBeInTheDocument();
  });
});
