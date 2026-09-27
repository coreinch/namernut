// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsDrawer } from "./SettingsDrawer";

afterEach(cleanup);

describe("SettingsDrawer", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <SettingsDrawer open={false} onClose={vi.fn()}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders its children as a labeled dialog when open", () => {
    render(
      <SettingsDrawer open onClose={vi.fn()}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    expect(screen.getByRole("dialog", { name: "Search options" })).toBeTruthy();
    expect(screen.getByText("panel content")).toBeTruthy();
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <SettingsDrawer open onClose={onClose}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    fireEvent.click(screen.getAllByLabelText("Close search options")[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close (✕) button is clicked", () => {
    const onClose = vi.fn();
    render(
      <SettingsDrawer open onClose={onClose}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    fireEvent.click(screen.getAllByLabelText("Close search options")[1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <SettingsDrawer open onClose={onClose}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the close button on open", () => {
    render(
      <SettingsDrawer open onClose={vi.fn()}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    expect(document.activeElement).toBe(screen.getAllByLabelText("Close search options")[1]);
  });

  it("traps Tab focus: forward from the last focusable element wraps to the first", () => {
    render(
      <SettingsDrawer open onClose={vi.fn()}>
        <button type="button">a control</button>
      </SettingsDrawer>
    );
    const [backdrop, closeButton] = screen.getAllByLabelText("Close search options");
    const control = screen.getByRole("button", { name: "a control" });
    (control as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(control);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(backdrop);
    // Sanity check that closeButton (the actual last focusable element
    // before this test's extra control) isn't what wrapping landed on.
    expect(document.activeElement).not.toBe(closeButton);
  });

  it("traps Tab focus: Shift+Tab from the first focusable element wraps to the last", () => {
    render(
      <SettingsDrawer open onClose={vi.fn()}>
        <button type="button">a control</button>
      </SettingsDrawer>
    );
    const [backdrop] = screen.getAllByLabelText("Close search options");
    const control = screen.getByRole("button", { name: "a control" });
    (backdrop as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(backdrop);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(control);
  });
});
