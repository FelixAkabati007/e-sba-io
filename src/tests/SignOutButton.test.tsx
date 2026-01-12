import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  fireEvent,
  screen,
  cleanup,
  within,
} from "@testing-library/react";
import SignOutButton from "../components/SignOutButton";

afterEach(() => {
  cleanup();
});

describe("SignOutButton", () => {
  it("renders correctly with icon and text", () => {
    render(<SignOutButton onLogout={() => {}} />);

    // Check for button existence
    // Initially only one button
    const button = screen.getByRole("button", { name: /sign out/i });
    expect(button).toBeInTheDocument();

    // Check for text (it has class hidden sm:inline, but is in DOM)
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
  });

  it("opens confirmation dialog on click", () => {
    render(<SignOutButton onLogout={() => {}} />);

    const button = screen.getByRole("button", { name: /sign out/i });
    fireEvent.click(button);

    // Check for modal content
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Are you sure you want to end your current session?"
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" })
    ).toBeInTheDocument();
  });

  it("calls onLogout when confirmed", () => {
    const onLogoutMock = vi.fn();
    render(<SignOutButton onLogout={onLogoutMock} />);

    // Open modal
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    // Find the confirm button in the modal
    const dialog = screen.getByRole("dialog");
    const confirmButton = within(dialog).getByRole("button", {
      name: "Sign Out",
    });

    fireEvent.click(confirmButton);

    expect(onLogoutMock).toHaveBeenCalledTimes(1);
  });

  it("does not call onLogout when cancelled", () => {
    const onLogoutMock = vi.fn();
    render(<SignOutButton onLogout={onLogoutMock} />);

    // Open modal
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    // Click cancel
    const dialog = screen.getByRole("dialog");
    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(onLogoutMock).not.toHaveBeenCalled();
    // Modal should be closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
