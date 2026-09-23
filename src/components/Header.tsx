import { useRef } from "react";
import { CONTENT_WIDTH, FOCUS_RING } from "./constants";

export type ResultsTab = "current" | "favorites" | "archive";

const TABS: { id: ResultsTab; label: string }[] = [
  { id: "current", label: "Current" },
  { id: "favorites", label: "Favorites" },
  { id: "archive", label: "Archive" },
];

/** Matches page.tsx's tabpanel ids (see the `role="tabpanel"` sections
 * there) — kept here so the tab buttons' aria-controls always points at
 * the right element without page.tsx needing to import TABS itself. */
export function tabPanelId(tab: ResultsTab) {
  return `results-panel-${tab}`;
}
export function tabButtonId(tab: ResultsTab) {
  return `results-tab-${tab}`;
}

/**
 * The wordmark + the one tab control that replaces the app's old four
 * stacked results sections (current run / top ranked / favorites / previous
 * results) with a single switch — no comparable competitor organizes this
 * particular kind of history, so this is Namernut's own answer to it: one
 * result list at a time, picked here, rather than everything visible (and
 * scrolled past) at once.
 */
export function Header({
  activeTab,
  onTabChange,
  counts,
}: {
  activeTab: ResultsTab;
  onTabChange: (tab: ResultsTab) => void;
  counts: Record<ResultsTab, number>;
}) {
  // Roving tabindex + arrow-key navigation — the WAI-ARIA tabs pattern:
  // only the selected tab is a Tab stop (tabIndex 0), the other two are
  // skipped by Tab/Shift+Tab entirely and reached instead with the arrow
  // keys, same as a native <select> or radio group. Without this, plain
  // aria-pressed buttons (the previous markup) are keyboard-reachable but
  // never announced as a tab group, and Left/Right do nothing.
  const tabRefs = useRef<Record<ResultsTab, HTMLButtonElement | null>>({
    current: null,
    favorites: null,
    archive: null,
  });

  const moveFocus = (fromIndex: number, delta: number) => {
    const nextIndex = (fromIndex + delta + TABS.length) % TABS.length;
    const nextTab = TABS[nextIndex].id;
    onTabChange(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  return (
    <header className="shrink-0 border-b border-black/10 bg-background/85 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 backdrop-blur-md dark:border-white/10">
      {/* flex-wrap (with a matching gap-y) rather than a fixed single row —
          on a narrow phone width, "namernut" + the status badge + all three
          tab buttons (with counts) don't fit on one line; wrapping the tab
          group onto its own line keeps every control fully visible instead
          of clipping or forcing horizontal page scroll. */}
      <div className={`mx-auto flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 ${CONTENT_WIDTH}`}>
        <div className="flex items-center gap-2.5">
          <span className="font-display text-lg font-bold tracking-tight">namernut</span>
        </div>
        <div
          role="tablist"
          aria-label="Results"
          className="flex shrink-0 gap-0.5 rounded-full bg-card p-1 shadow-[0_1px_3px_rgba(27,21,51,0.08)] dark:shadow-none"
        >
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={tabButtonId(tab.id)}
              aria-controls={tabPanelId(tab.id)}
              aria-selected={activeTab === tab.id}
              // The visible count sits right against the label with only a
              // margin (no text-node space) between them — fine visually,
              // but concatenates into one run for assistive tech ("Archive379").
              // aria-label overrides that with a properly separated phrase.
              aria-label={counts[tab.id] > 0 ? `${tab.label}, ${counts[tab.id]} results` : tab.label}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  moveFocus(index, 1);
                } else if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  moveFocus(index, -1);
                }
              }}
              className={`min-h-8 rounded-full px-2.5 text-xs font-medium tabular-nums transition-colors sm:px-3 ${FOCUS_RING} ${
                activeTab === tab.id
                  ? "bg-foreground text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {counts[tab.id] > 0 && <span className="ml-1 opacity-70">{counts[tab.id]}</span>}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
