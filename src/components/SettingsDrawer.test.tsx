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
});
