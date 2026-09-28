// @vitest-environment jsdom
import { useState } from "react";
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
    const { container } = render(
      <SettingsDrawer open onClose={onClose}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    // The backdrop is deliberately unlabeled and aria-hidden (a
    // pointer/touch-only dismiss affordance — see its own comment in
    // SettingsDrawer.tsx), so it can't be queried by role/label the way
    // the real close button below is.
    fireEvent.click(container.querySelector('button[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close (✕) button is clicked", () => {
    const onClose = vi.fn();
    render(
      <SettingsDrawer open onClose={onClose}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    fireEvent.click(screen.getByLabelText("Close search options"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the backdrop out of the tab order and the accessibility tree", () => {
    const { container } = render(
      <SettingsDrawer open onClose={vi.fn()}>
        <p>panel content</p>
      </SettingsDrawer>
    );
    const backdrop = container.querySelector('button[aria-hidden="true"]');
    expect(backdrop?.getAttribute("tabindex")).toBe("-1");
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
    expect(document.activeElement).toBe(screen.getByLabelText("Close search options"));
  });

  it("traps Tab focus: forward from the last focusable element wraps to the first", () => {
    render(
      <SettingsDrawer open onClose={vi.fn()}>
        <button type="button">a control</button>
      </SettingsDrawer>
    );
    const closeButton = screen.getByLabelText("Close search options");
    const control = screen.getByRole("button", { name: "a control" });
    (control as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(control);
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);
  });

  it("traps Tab focus: Shift+Tab from the first focusable element wraps to the last", () => {
    render(
      <SettingsDrawer open onClose={vi.fn()}>
        <button type="button">a control</button>
      </SettingsDrawer>
    );
    const closeButton = screen.getByLabelText("Close search options");
    const control = screen.getByRole("button", { name: "a control" });
    (closeButton as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(control);
  });

  it("returns focus to the trigger that opened it once it closes, instead of dropping it to <body>", () => {
    // A minimal stand-in for SearchBar's real "Customize search options"
    // trigger + page.tsx's open/close state — the drawer only knows to
    // restore focus to whatever had it *before* open flipped true, so this
    // needs a real trigger button and a real close, not just a fixed
    // `open` prop the way the tests above use.
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Customize search options
          </button>
          <SettingsDrawer open={open} onClose={() => setOpen(false)}>
            <p>panel content</p>
          </SettingsDrawer>
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole("button", { name: "Customize search options" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByLabelText("Close search options"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });
});
