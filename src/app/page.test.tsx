// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Home from "./page";

const STORAGE_KEY = "namernut:state:v1";
const LEGACY_KEY = "namerag:state:v1";
const OLDER_LEGACY_KEY = "domain-finder:state:v1";

// /api/stats fires on every mount (debounced by 250ms — see page.tsx), and
// jsdom doesn't implement fetch at all — stub it so that debounced call
// resolves quietly instead of throwing once its timer fires. Cleanup below
// unmounts before the 250ms debounce ever elapses in practice, but this
// keeps these tests independent of that timing.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ json: () => Promise.resolve({ total: 0, matching: 0 }) })
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function openArchiveTab() {
  fireEvent.click(screen.getByRole("tab", { name: /^archive/i }));
}

describe("Home — localStorage hydration", () => {
  it("dedupes persisted entries that share a domain, keeping the one that already has a brandabilityScore", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        foundHistory: [
          { id: "a", domain: "sunnydog.com", meaning: "unscored duplicate", checkedCount: 1, runId: "old-run" },
          {
            id: "b",
            domain: "sunnydog.com",
            meaning: "scored duplicate",
            checkedCount: 1,
            runId: "old-run",
            brandabilityScore: 80,
          },
        ],
      })
    );

    render(<Home />);
    openArchiveTab();

    expect(screen.getByText("scored duplicate")).toBeTruthy();
    expect(screen.queryByText("unscored duplicate")).toBeNull();
  });

  it("keeps unrelated domains as separate entries", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        foundHistory: [
          { id: "a", domain: "foxglow.com", meaning: "first", checkedCount: 1, runId: "old-run" },
          { id: "b", domain: "wrenpath.com", meaning: "second", checkedCount: 1, runId: "old-run" },
        ],
      })
    );

    render(<Home />);
    openArchiveTab();

    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getByText("second")).toBeTruthy();
  });

  it("migrates legacy rankabilityScore/collisionSummary fields onto brandabilityScore/brandabilitySummary", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        foundHistory: [
          {
            id: "a",
            domain: "oldnamer.com",
            meaning: "pre-rename entry",
            checkedCount: 1,
            runId: "old-run",
            rankabilityScore: 42,
            collisionSummary: "a distinctive, unused name",
          },
        ],
      })
    );

    render(<Home />);
    openArchiveTab();

    // brandabilitySummary is only rendered at all once brandabilityScore is
    // also set (see ResultCard) — seeing the summary text proves both
    // legacy fields were migrated onto their current names.
    expect(screen.getByText("a distinctive, unused name")).toBeTruthy();
  });

  it("falls back to the newest legacy storage key when the current key is empty, then removes it", () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        foundHistory: [{ id: "a", domain: "legacyfind.com", meaning: "from namerag", checkedCount: 1, runId: "old-run" }],
      })
    );

    render(<Home />);
    openArchiveTab();

    expect(screen.getByText("from namerag")).toBeTruthy();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("falls back to the older legacy key only when both the current and newer legacy keys are empty", () => {
    localStorage.setItem(
      OLDER_LEGACY_KEY,
      JSON.stringify({
        foundHistory: [
          { id: "a", domain: "veryoldfind.com", meaning: "from domain-finder", checkedCount: 1, runId: "old-run" },
        ],
      })
    );

    render(<Home />);
    openArchiveTab();

    expect(screen.getByText("from domain-finder")).toBeTruthy();
    expect(localStorage.getItem(OLDER_LEGACY_KEY)).toBeNull();
  });

  it("ignores an unparsable persisted value instead of crashing", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => render(<Home />)).not.toThrow();
    openArchiveTab();
    expect(screen.getByText(/past searches will collect here/i)).toBeTruthy();
  });
});
