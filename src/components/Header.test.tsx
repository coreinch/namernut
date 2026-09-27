// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Header, type ResultsTab } from "./Header";

afterEach(cleanup);

// Header is fully controlled (activeTab/onTabChange are props, not its own
// state) — this wrapper reproduces how page.tsx actually drives it, so the
// arrow-key navigation tests below exercise the same round trip a real user
// interaction goes through (Header calls onTabChange, the new activeTab
// prop flows back in, tabIndex/aria-selected update accordingly).
function ControlledHeader({ initialTab = "current" as ResultsTab, showTabs = true }) {
  const [activeTab, setActiveTab] = useState<ResultsTab>(initialTab);
  return (
    <Header
      activeTab={activeTab}
      onTabChange={setActiveTab}
      counts={{ current: 2, favorites: 0, archive: 5 }}
      showTabs={showTabs}
    />
  );
}

describe("Header", () => {
  it("marks only the active tab as a Tab stop, the rest skipped via tabIndex -1", () => {
    render(<ControlledHeader initialTab="current" />);
    expect(screen.getByRole("tab", { name: /^current/i }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: /^favorites/i }).tabIndex).toBe(-1);
    expect(screen.getByRole("tab", { name: /^archive/i }).tabIndex).toBe(-1);
  });

  it("reflects aria-selected on the active tab only", () => {
    render(<ControlledHeader initialTab="favorites" />);
    expect(screen.getByRole("tab", { name: /^current/i }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: /^favorites/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("separates the label from its count for assistive tech via aria-label", () => {
    render(<ControlledHeader initialTab="current" />);
    // counts.current is 2 above — the visible text concatenates ("Current2")
    // but aria-label must read as a properly separated phrase.
    expect(screen.getByRole("tab", { name: "Current, 2 results" })).toBeTruthy();
    // counts.favorites is 0 — no count suffix at all when there's nothing to report.
    expect(screen.getByRole("tab", { name: "Favorites" })).toBeTruthy();
  });

  it("clicking a tab calls onTabChange with that tab's id", () => {
    render(<ControlledHeader initialTab="current" />);
    fireEvent.click(screen.getByRole("tab", { name: /^archive/i }));
    expect(screen.getByRole("tab", { name: /^archive/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("ArrowRight moves selection and focus to the next tab, wrapping from the last to the first", () => {
    render(<ControlledHeader initialTab="archive" />);
    const archiveTab = screen.getByRole("tab", { name: /^archive/i });
    fireEvent.keyDown(archiveTab, { key: "ArrowRight" });
    const currentTab = screen.getByRole("tab", { name: /^current/i });
    expect(currentTab.getAttribute("aria-selected")).toBe("true");
    expect(currentTab).toBe(document.activeElement);
  });

  it("ArrowLeft moves selection and focus to the previous tab, wrapping from the first to the last", () => {
    render(<ControlledHeader initialTab="current" />);
    const currentTab = screen.getByRole("tab", { name: /^current/i });
    fireEvent.keyDown(currentTab, { key: "ArrowLeft" });
    const archiveTab = screen.getByRole("tab", { name: /^archive/i });
    expect(archiveTab.getAttribute("aria-selected")).toBe("true");
    expect(archiveTab).toBe(document.activeElement);
  });

  it("ArrowRight from the middle tab moves to the last tab without wrapping", () => {
    render(<ControlledHeader initialTab="favorites" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /^favorites/i }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /^archive/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("a key other than the arrows leaves selection and focus untouched", () => {
    render(<ControlledHeader initialTab="current" />);
    const currentTab = screen.getByRole("tab", { name: /^current/i });
    fireEvent.keyDown(currentTab, { key: "Enter" });
    expect(currentTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /^favorites/i }).getAttribute("aria-selected")).toBe("false");
  });

  it("renders only the wordmark, no tab bar at all, when showTabs is false", () => {
    render(<ControlledHeader showTabs={false} />);
    expect(screen.getByText("namernut")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("renders the tab bar when showTabs is true", () => {
    render(<ControlledHeader showTabs />);
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});
