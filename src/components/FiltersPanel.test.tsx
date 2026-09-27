// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FiltersPanel } from "./FiltersPanel";
import type { DiscoveryGates } from "@/lib/discovery";
import { DEFAULT_REGION, TLDS, type Tld } from "@/lib/searchConfig";

afterEach(cleanup);

const NO_GATES: DiscoveryGates = {
  requireInstagram: false,
  requireGithub: false,
  requireTiktok: false,
  requireNpm: false,
  requireYoutube: false,
  requireTwitter: false,
  filterPronounceable: false,
  filterTypos: false,
  filterNiceness: false,
};

function baseProps() {
  const enabledTlds = Object.fromEntries(TLDS.map((t) => [t, t === "com"])) as Record<Tld, boolean>;
  return {
    showAdvanced: false,
    onToggleShowAdvanced: vi.fn(),
    stats: null,
    keywordInput: "",
    onKeywordInputChange: vi.fn(),
    keywordParam: "",
    useAiSynonyms: false,
    onUseAiSynonymsChange: vi.fn(),
    useAiInvented: false,
    onUseAiInventedChange: vi.fn(),
    useAltSpellings: false,
    onUseAltSpellingsChange: vi.fn(),
    maxLength: 8,
    onMaxLengthChange: vi.fn(),
    selectedTlds: ["com"] as Tld[],
    visibleTlds: TLDS.slice(0, 6),
    enabledTlds,
    onToggleTld: vi.fn(),
    effectiveShowMoreTlds: false,
    onToggleShowMoreTlds: vi.fn(),
    gates: NO_GATES,
    onGatesChange: vi.fn(),
    region: DEFAULT_REGION,
    onRegionChange: vi.fn(),
    isRunning: false,
    primaryLabel: "Generate",
    onStart: vi.fn(),
    onStop: vi.fn(),
    exampleKeywords: ["glow", "coffee"],
    onTryExample: vi.fn(),
  };
}

describe("FiltersPanel", () => {
  it("shows the primary label and calls onStart when not running", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} />);
    const btn = screen.getByRole("button", { name: "Generate" });
    btn.click();
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(props.onStop).not.toHaveBeenCalled();
  });

  it("swaps to Stop and calls onStop while running", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} isRunning />);
    const btn = screen.getByRole("button", { name: "Stop" });
    btn.click();
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it("hides the example-keyword chips while a search is running", () => {
    const props = baseProps();
    const { rerender } = render(<FiltersPanel {...props} />);
    expect(screen.getByRole("button", { name: "glow" })).toBeTruthy();
    rerender(<FiltersPanel {...props} isRunning />);
    expect(screen.queryByRole("button", { name: "glow" })).toBeNull();
  });

  it("calls onKeywordInputChange as the keyword field is typed", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} />);
    const input = screen.getByLabelText("Keyword to include (optional)") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "glow" } });
    expect(props.onKeywordInputChange).toHaveBeenCalledWith("glow");
  });

  it("AI synonyms chip is disabled without a keyword, and enabled once one is set", () => {
    const props = baseProps();
    const { rerender } = render(<FiltersPanel {...props} keywordParam="" />);
    expect((screen.getByRole("button", { name: /AI synonyms/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<FiltersPanel {...props} keywordParam="glow" />);
    expect((screen.getByRole("button", { name: "AI synonyms" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("AI-invented chip is never gated on a keyword", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} keywordParam="" />);
    expect((screen.getByRole("button", { name: "AI-invented" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("toggles the AI synonyms chip's active state via its onChange callback", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} keywordParam="glow" useAiSynonyms={false} />);
    screen.getByRole("button", { name: "AI synonyms" }).click();
    expect(props.onUseAiSynonymsChange).toHaveBeenCalledWith(true);
  });

  it("the Dictionary chip is always-on and inert (rendered as a span, not a clickable button)", () => {
    render(<FiltersPanel {...baseProps()} />);
    expect(screen.queryByRole("button", { name: /Dictionary/ })).toBeNull();
    expect(screen.getByText("Dictionary")).toBeTruthy();
  });

  it("hides the advanced filters section until showAdvanced is true, keeping it in the DOM for aria-controls", () => {
    const props = baseProps();
    const { rerender } = render(<FiltersPanel {...props} showAdvanced={false} />);
    const section = document.getElementById("advanced-filters-panel");
    expect(section).not.toBeNull();
    expect((section as HTMLElement).hidden).toBe(true);
    rerender(<FiltersPanel {...props} showAdvanced />);
    expect((section as HTMLElement).hidden).toBe(false);
    expect(screen.getByText("Extensions")).toBeTruthy();
  });

  it("toggling 'Advanced filters' calls onToggleShowAdvanced and reflects aria-expanded", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} showAdvanced={false} />);
    const toggle = screen.getByRole("button", { name: /Advanced filters/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(props.onToggleShowAdvanced).toHaveBeenCalledTimes(1);
  });

  it("shows the count of active quality gates next to 'Advanced filters'", () => {
    const props = baseProps();
    render(
      <FiltersPanel
        {...props}
        gates={{ ...NO_GATES, requireInstagram: true, filterTypos: true }}
      />
    );
    expect(screen.getByRole("button", { name: /Advanced filters \(2 active\)/ })).toBeTruthy();
  });

  it("clicking a TLD chip calls onToggleTld with that TLD", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} showAdvanced />);
    screen.getByRole("button", { name: ".net" }).click();
    expect(props.onToggleTld).toHaveBeenCalledWith("net");
  });

  it("shows a warning when at most one TLD is selected", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} showAdvanced selectedTlds={[]} />);
    expect(screen.getByText("At least one extension must stay selected.")).toBeTruthy();
  });

  it("disables the sole selected TLD chip so it can't be deselected", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} showAdvanced />);
    const chip = screen.getByRole("button", { name: /\.com/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
  });

  it("changing the max-length slider calls onMaxLengthChange with a number", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} showAdvanced />);
    const slider = screen.getByLabelText("Maximum combined result length") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "12" } });
    expect(props.onMaxLengthChange).toHaveBeenCalledWith(12);
  });

  it("shows the current region as selected and calls onRegionChange on selection", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} showAdvanced />);
    const select = screen.getByLabelText("Brandability check region") as HTMLSelectElement;
    expect(select.value).toBe(DEFAULT_REGION);
    fireEvent.change(select, { target: { value: "gb" } });
    expect(props.onRegionChange).toHaveBeenCalledWith("gb");
  });

  it("renders a GateToggle for each quality gate and forwards a merged update via onGatesChange", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} showAdvanced />);
    const toggle = screen.getByRole("switch", { name: "Require Instagram handle" });
    toggle.click();
    expect(props.onGatesChange).toHaveBeenCalledTimes(1);
    const updater = props.onGatesChange.mock.calls[0][0];
    expect(updater(NO_GATES)).toEqual({ ...NO_GATES, requireInstagram: true });
  });

  it("renders GateToggles for npm/YouTube/X and forwards merged updates via onGatesChange", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} showAdvanced />);
    const cases: [string, keyof DiscoveryGates][] = [
      ["Require npm package name", "requireNpm"],
      ["Require YouTube handle", "requireYoutube"],
      ["Require X (Twitter) handle", "requireTwitter"],
    ];
    for (const [label, key] of cases) {
      props.onGatesChange.mockClear();
      screen.getByRole("switch", { name: label }).click();
      expect(props.onGatesChange).toHaveBeenCalledTimes(1);
      const updater = props.onGatesChange.mock.calls[0][0];
      expect(updater(NO_GATES)).toEqual({ ...NO_GATES, [key]: true });
    }
  });

  it("clicking an example-keyword chip calls onTryExample with that word", () => {
    const props = baseProps();
    render(<FiltersPanel {...props} />);
    screen.getByRole("button", { name: "coffee" }).click();
    expect(props.onTryExample).toHaveBeenCalledTimes(1);
    expect(props.onTryExample).toHaveBeenCalledWith("coffee");
  });
});
