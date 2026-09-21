import type { RunStatus } from "@/lib/types";
import { CONTENT_WIDTH, FOCUS_RING } from "./constants";
import { StatusBadge } from "./StatusBadge";

export type ResultsTab = "current" | "favorites" | "archive";

const TABS: { id: ResultsTab; label: string }[] = [
  { id: "current", label: "Current" },
  { id: "favorites", label: "Favorites" },
  { id: "archive", label: "Archive" },
];

/**
 * The wordmark + the one tab control that replaces the app's old four
 * stacked results sections (current run / top ranked / favorites / previous
 * results) with a single switch — no comparable competitor organizes this
 * particular kind of history, so this is Namerag's own answer to it: one
 * result list at a time, picked here, rather than everything visible (and
 * scrolled past) at once.
 */
export function Header({
  status,
  activeTab,
  onTabChange,
  counts,
}: {
  status: RunStatus;
  activeTab: ResultsTab;
  onTabChange: (tab: ResultsTab) => void;
  counts: Record<ResultsTab, number>;
}) {
  return (
    <header className="shrink-0 border-b border-black/10 bg-background/85 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 backdrop-blur-md dark:border-white/10">
      {/* flex-wrap (with a matching gap-y) rather than a fixed single row —
          on a narrow phone width, "namerag" + the status badge + all three
          tab buttons (with counts) don't fit on one line; wrapping the tab
          group onto its own line keeps every control fully visible instead
          of clipping or forcing horizontal page scroll. */}
      <div className={`mx-auto flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 ${CONTENT_WIDTH}`}>
        <div className="flex items-center gap-2.5">
          <span className="font-display text-lg font-bold tracking-tight">namerag</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex shrink-0 gap-0.5 rounded-full bg-card p-1 shadow-[0_1px_3px_rgba(27,21,51,0.08)] dark:shadow-none">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-pressed={activeTab === tab.id}
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
