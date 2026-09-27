import { useState } from "react";
import type { RefObject } from "react";
import type { LogEntry } from "@/lib/types";
import { FOCUS_RING } from "./constants";
import { LogDot, LOG_STATUS_LABEL } from "./LogDot";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Rendered only once there's actually something to show — an empty log box
// with a placeholder illustration was pure filler on every load before the
// first search — so this returns null itself rather than the caller
// needing its own `log.length > 0 &&` guard. Collapsed by default behind a
// toggle: this is a play-by-play of the run's internals (useful, but
// secondary to the actual results), so it shouldn't compete with them for
// space on every screen the way it used to once any log existed at all.
export function LiveLogSection({ log, logBoxRef }: { log: LogEntry[]; logBoxRef: RefObject<HTMLDivElement | null> }) {
  const [expanded, setExpanded] = useState(false);
  if (log.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="activity-log-panel"
        className={`inline-flex items-center gap-1.5 self-start rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted transition-colors hover:text-foreground ${FOCUS_RING}`}
      >
        {expanded ? "Hide" : "Show"} activity log ({log.length})
        <ChevronIcon open={expanded} />
      </button>
      <div
        id="activity-log-panel"
        hidden={!expanded}
        ref={logBoxRef}
        className="thin-scrollbar max-h-[35vh] overflow-y-auto rounded-2xl bg-card p-3 text-sm shadow-[0_1px_3px_rgba(27,21,51,0.05)] dark:shadow-none"
        role="log"
        aria-label="Search activity"
      >
        <ul className="space-y-0.5">
          {log.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 animate-fade-in-up">
              <LogDot status={entry.status} />
              <span className="truncate">{entry.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{LOG_STATUS_LABEL[entry.status]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
