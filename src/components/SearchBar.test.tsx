// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchBar } from "./SearchBar";

afterEach(cleanup);

function baseProps() {
  return {
    keywordInput: "",
    keywordParam: "",
    onKeywordInputChange: vi.fn(),
    isRunning: false,
    primaryLabel: "Generate",
    onStart: vi.fn(),
    onStop: vi.fn(),
    exampleKeywords: ["glow", "coffee"],
    onTryExample: vi.fn(),
  };
}

describe("SearchBar", () => {
  it("hero mode shows the value-prop copy; compact mode doesn't", () => {
    const props = baseProps();
    const { rerender } = render(<SearchBar mode="hero" {...props} />);
    expect(screen.getByText(/Never fall for a name/)).toBeTruthy();
    expect(screen.getByText(/What’s your keyword\?/)).toBeTruthy();
    rerender(<SearchBar mode="compact" {...props} />);
    expect(screen.queryByText(/Never fall for a name/)).toBeNull();
    expect(screen.queryByText(/What’s your keyword\?/)).toBeNull();
  });

  it("shows the primary label and calls onStart when not running", () => {
    const props = baseProps();
    render(<SearchBar mode="hero" {...props} />);
    const btn = screen.getByRole("button", { name: "Generate" });
    btn.click();
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(props.onStop).not.toHaveBeenCalled();
  });

  it("swaps to Stop and calls onStop while running", () => {
    const props = baseProps();
    render(<SearchBar mode="hero" {...props} isRunning />);
    const btn = screen.getByRole("button", { name: "Stop" });
    btn.click();
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it("calls onKeywordInputChange as the keyword field is typed", () => {
    const props = baseProps();
    render(<SearchBar mode="hero" {...props} />);
    const input = screen.getByLabelText("Keyword to include (optional)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "glow" } });
    expect(props.onKeywordInputChange).toHaveBeenCalledWith("glow");
  });

  it("hero mode shows example chips only while not running", () => {
    const props = baseProps();
    const { rerender } = render(<SearchBar mode="hero" {...props} />);
    expect(screen.getByRole("button", { name: "glow" })).toBeTruthy();
    rerender(<SearchBar mode="hero" {...props} isRunning />);
    expect(screen.queryByRole("button", { name: "glow" })).toBeNull();
  });

  it("compact mode never shows example chips, even while idle", () => {
    render(<SearchBar mode="compact" {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "glow" })).toBeNull();
  });

  it("clicking an example-keyword chip calls onTryExample with that word", () => {
    const props = baseProps();
    render(<SearchBar mode="hero" {...props} />);
    screen.getByRole("button", { name: "coffee" }).click();
    expect(props.onTryExample).toHaveBeenCalledTimes(1);
    expect(props.onTryExample).toHaveBeenCalledWith("coffee");
  });

  it("hero mode never renders a Customize trigger, even when onOpenSettings is passed", () => {
    const onOpenSettings = vi.fn();
    render(<SearchBar mode="hero" {...baseProps()} onOpenSettings={onOpenSettings} />);
    expect(screen.queryByRole("button", { name: "Customize search options" })).toBeNull();
  });

  it("compact mode's Customize button calls onOpenSettings", () => {
    const onOpenSettings = vi.fn();
    render(<SearchBar mode="compact" {...baseProps()} onOpenSettings={onOpenSettings} />);
    screen.getByRole("button", { name: "Customize search options" }).click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("compact mode renders no Customize button when onOpenSettings is omitted", () => {
    render(<SearchBar mode="compact" {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "Customize search options" })).toBeNull();
  });

  it("Customize button's aria-expanded tracks settingsOpen", () => {
    const { rerender } = render(
      <SearchBar mode="compact" {...baseProps()} onOpenSettings={vi.fn()} settingsOpen={false} />
    );
    const button = screen.getByRole("button", { name: "Customize search options" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    rerender(<SearchBar mode="compact" {...baseProps()} onOpenSettings={vi.fn()} settingsOpen />);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("Customize button defaults aria-expanded to false when settingsOpen is omitted", () => {
    render(<SearchBar mode="compact" {...baseProps()} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Customize search options" }).getAttribute("aria-expanded")).toBe(
      "false"
    );
  });

  describe("the empty-after-sanitizing keyword warning", () => {
    it("shows a warning, in both modes, when the typed keyword sanitizes to nothing", () => {
      // "日本語" -> "" via sanitizeKeyword (only a-z/0-9 survive) — the same
      // case as an emoji-only or pure-punctuation keyword.
      const props = { ...baseProps(), keywordInput: "日本語", keywordParam: "" };
      const { rerender } = render(<SearchBar mode="hero" {...props} />);
      expect(screen.getByRole("status").textContent).toContain("Searching without a keyword");
      rerender(<SearchBar mode="compact" {...props} />);
      expect(screen.getByRole("status").textContent).toContain("Searching without a keyword");
    });

    it("shows nothing when keywordInput is empty (nothing typed at all)", () => {
      render(<SearchBar mode="hero" {...baseProps()} keywordInput="" keywordParam="" />);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("shows nothing when keywordInput is only whitespace", () => {
      render(<SearchBar mode="hero" {...baseProps()} keywordInput="   " keywordParam="" />);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("shows nothing when the keyword sanitized to something real", () => {
      render(<SearchBar mode="hero" {...baseProps()} keywordInput="glow" keywordParam="glow" />);
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
