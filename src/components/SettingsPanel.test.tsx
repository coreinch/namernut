// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";
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
    stats: null,
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
  };
}

describe("SettingsPanel", () => {
  it("every filter is visible with no collapsed section or toggle to expand", () => {
    render(<SettingsPanel {...baseProps()} />);
    expect(screen.getByText("Extensions")).toBeTruthy();
    expect(screen.getByText("Quality gates")).toBeTruthy();
    expect(screen.getByLabelText("Brandability check region")).toBeTruthy();
    expect(screen.queryByText(/Advanced filters/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Advanced/ })).toBeNull();
  });

  it("the Dictionary pairing toggle is always on and disabled", () => {
    render(<SettingsPanel {...baseProps()} />);
    const toggle = screen.getByRole("switch", { name: "Dictionary pairing — always on" }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(true);
  });

  it("AI synonyms toggle is disabled without a keyword, and enabled once one is set", () => {
    const props = baseProps();
    const { rerender } = render(<SettingsPanel {...props} keywordParam="" />);
    expect((screen.getByRole("switch", { name: /AI synonyms/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SettingsPanel {...props} keywordParam="glow" />);
    expect((screen.getByRole("switch", { name: "AI synonyms" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("AI-invented names toggle is never gated on a keyword", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} keywordParam="" />);
    expect((screen.getByRole("switch", { name: "AI-invented names" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Alt-spellings toggle is disabled without a keyword, and enabled once one is set", () => {
    const props = baseProps();
    const { rerender } = render(<SettingsPanel {...props} keywordParam="" />);
    expect((screen.getByRole("switch", { name: /Alt-spellings/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<SettingsPanel {...props} keywordParam="glow" />);
    expect((screen.getByRole("switch", { name: "Alt-spellings" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("toggles the AI synonyms switch via its onChange callback", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} keywordParam="glow" useAiSynonyms={false} />);
    screen.getByRole("switch", { name: "AI synonyms" }).click();
    expect(props.onUseAiSynonymsChange).toHaveBeenCalledWith(true);
  });

  it("toggles the AI-invented names switch via its onChange callback", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} useAiInvented={false} />);
    screen.getByRole("switch", { name: "AI-invented names" }).click();
    expect(props.onUseAiInventedChange).toHaveBeenCalledWith(true);
  });

  it("toggles the Alt-spellings switch via its onChange callback", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} keywordParam="glow" useAltSpellings={false} />);
    screen.getByRole("switch", { name: "Alt-spellings" }).click();
    expect(props.onUseAltSpellingsChange).toHaveBeenCalledWith(true);
  });

  it("clicking a TLD chip calls onToggleTld with that TLD", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    screen.getByRole("button", { name: ".net" }).click();
    expect(props.onToggleTld).toHaveBeenCalledWith("net");
  });

  it("shows a warning when at most one TLD is selected", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} selectedTlds={[]} />);
    expect(screen.getByText("At least one extension must stay selected.")).toBeTruthy();
  });

  it("disables the sole selected TLD chip so it can't be deselected", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    const chip = screen.getByRole("button", { name: /\.com/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
  });

  it("changing the max-length slider calls onMaxLengthChange with a number", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    const slider = screen.getByLabelText("Maximum combined result length") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "12" } });
    expect(props.onMaxLengthChange).toHaveBeenCalledWith(12);
  });

  it("shows the current region as selected and calls onRegionChange on selection", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    const select = screen.getByLabelText("Brandability check region") as HTMLSelectElement;
    expect(select.value).toBe(DEFAULT_REGION);
    fireEvent.change(select, { target: { value: "gb" } });
    expect(props.onRegionChange).toHaveBeenCalledWith("gb");
  });

  it("keeps the region select's id unique when two SettingsPanels are mounted at once", () => {
    // page.tsx genuinely does this: the desktop rail and the mobile
    // SettingsDrawer both mount a SettingsPanel simultaneously, with only
    // CSS display toggling which is visible — a hardcoded id here would
    // collide, and <label htmlFor> would resolve to whichever instance
    // happens to be first in DOM order regardless of which is actually
    // visible/relevant.
    const { container } = render(
      <>
        <SettingsPanel {...baseProps()} />
        <SettingsPanel {...baseProps()} />
      </>
    );
    const selects = container.querySelectorAll("select");
    expect(selects).toHaveLength(2);
    expect(selects[0].id).not.toBe(selects[1].id);
    expect(selects[0].id).not.toBe("");
  });

  it("renders a GateToggle for each quality gate and forwards a merged update via onGatesChange", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    const toggle = screen.getByRole("switch", { name: "Require Instagram handle" });
    toggle.click();
    expect(props.onGatesChange).toHaveBeenCalledTimes(1);
    const updater = props.onGatesChange.mock.calls[0][0];
    expect(updater(NO_GATES)).toEqual({ ...NO_GATES, requireInstagram: true });
  });

  it("renders GateToggles for npm/YouTube/X/GitHub/TikTok and the quality filters, forwarding merged updates via onGatesChange", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} />);
    // GitHub's toggle carries a non-disabled `hint` (see GateToggle.tsx),
    // which GateToggle folds into the accessible name as "label — hint" —
    // matched with a regex here rather than the exact string every other
    // case uses.
    const cases: [string | RegExp, keyof DiscoveryGates][] = [
      ["Require npm package name", "requireNpm"],
      ["Require YouTube handle", "requireYoutube"],
      ["Require X (Twitter) handle", "requireTwitter"],
      [/^Require GitHub username/, "requireGithub"],
      ["Require TikTok handle", "requireTiktok"],
      ["Pronounceable only", "filterPronounceable"],
      ["Skip typo-like names", "filterTypos"],
      ["Skip awkward names", "filterNiceness"],
    ];
    for (const [label, key] of cases) {
      props.onGatesChange.mockClear();
      screen.getByRole("switch", { name: label }).click();
      expect(props.onGatesChange).toHaveBeenCalledTimes(1);
      const updater = props.onGatesChange.mock.calls[0][0];
      expect(updater(NO_GATES)).toEqual({ ...NO_GATES, [key]: true });
    }
  });

  it("shows the formatted combination count when stats are provided", () => {
    const props = baseProps();
    render(<SettingsPanel {...props} stats={{ english: 5000, combinedUnique: 1234567, totalCombinations: 1234567 }} />);
    expect(screen.getByText("1,234,567")).toBeTruthy();
  });
});
