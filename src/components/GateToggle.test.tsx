// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GateToggle } from "./GateToggle";

afterEach(cleanup);

describe("GateToggle", () => {
  it("exposes itself as a switch with aria-checked reflecting the checked prop", () => {
    render(<GateToggle label="Require Instagram handle" checked={true} onChange={() => {}} />);
    const el = screen.getByRole("switch", { name: "Require Instagram handle" });
    expect(el.getAttribute("aria-checked")).toBe("true");
  });

  it("moves the thumb via translate-x, not just color, so state doesn't rely on color perception alone", () => {
    const { rerender, container } = render(
      <GateToggle label="Pronounceable only" checked={false} onChange={() => {}} />
    );
    const thumb = () => container.querySelector("button > span");
    expect(thumb()?.className).toContain("translate-x-0");
    rerender(<GateToggle label="Pronounceable only" checked={true} onChange={() => {}} />);
    expect(thumb()?.className).toContain("translate-x-5");
  });

  it("calls onChange with the inverse of the current checked value when clicked", () => {
    const onChange = vi.fn();
    render(<GateToggle label="Skip typo-like names" checked={false} onChange={onChange} />);
    screen.getByRole("switch").click();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("aria-label is just the plain label", () => {
    render(<GateToggle label="Require GitHub username" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: "Require GitHub username" })).toBeTruthy();
  });

  it("when disabled, is inert and exposes the reason via aria-label", () => {
    const onChange = vi.fn();
    render(
      <GateToggle
        label="Dictionary pairing"
        checked={true}
        onChange={onChange}
        disabled
        disabledReason="always on"
      />
    );
    const el = screen.getByRole("switch", { name: "Dictionary pairing — always on" }) as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    el.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("not disabled by default, even with no disabled prop passed", () => {
    render(<GateToggle label="AI-invented names" checked={false} onChange={() => {}} />);
    const el = screen.getByRole("switch", { name: "AI-invented names" }) as HTMLButtonElement;
    expect(el.disabled).toBe(false);
  });
});
