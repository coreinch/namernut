import { useEffect, useRef, useState } from "react";
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

/** How often the throttled sr-only summary below updates while expanded and
 * a search is actively running — matches Footer's own announcer interval
 * (see its comment) for the same reason: at CONCURRENCY workers each
 * checking a new candidate every CHECK_DELAY_MS+ (see discovery.ts), a raw
 * per-entry `role="log"` live region would queue up far more announcements
 * than a screen reader user could ever keep up with. */
const ANNOUNCE_INTERVAL_MS = 4000;

// Rendered only once there's actually something to show — an empty log box
// with a placeholder illustration was pure filler on every load before the
// first search — so this returns null itself rather than the caller
// needing its own `log.length > 0 &&` guard. Collapsed by default behind a
// toggle: this is a play-by-play of the run's internals (useful, but
// secondary to the actual results), so it shouldn't compete with them for
// space on every screen the way it used to once any log existed at all.
export function LiveLogSection({
  log,
  logBoxRef,
  isRunning,
}: {
  log: LogEntry[];
  logBoxRef: RefObject<HTMLDivElement | null>;
  /** Only used to gate the throttled announcer below — once a run ends
   * there's nothing left to keep periodically summarizing. */
  isRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Summarizes the log's current tail into one sentence, updated at most
  // once per ANNOUNCE_INTERVAL_MS rather than once per entry — the visible
  // list above updates live on every entry regardless (sighted users scan
  // it at their own pace), but this is the only thing screen reader users
  // hear, so it needs the same "periodic summary, not a firehose" treatment
  // Footer's statusText announcer already uses.
  // Starts undefined, not log[log.length - 1] — the effect below is what
  // gates this on isRunning && expanded; seeding it with a real entry here
  // would render the sr-only span (and announce something) even before a
  // search has ever run or the log has ever been opened.
  const [announcedEntry, setAnnouncedEntry] = useState<LogEntry | undefined>(undefined);
  const latestEntry = useRef(log[log.length - 1]);
  useEffect(() => {
    latestEntry.current = log[log.length - 1];
  });
  useEffect(() => {
    if (!isRunning || !expanded) return;
    setAnnouncedEntry(latestEntry.current);
    const id = setInterval(() => setAnnouncedEntry(latestEntry.current), ANNOUNCE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isRunning, expanded]);

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
        aria-label="Search activity"
      >
        {/* Not a live region itself (no role="log"/aria-live here) — see
            ANNOUNCE_INTERVAL_MS above for why a screen reader instead gets
            the throttled summary below rather than one announcement per
            entry. */}
        <ul className="space-y-0.5">
          {log.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 animate-fade-in-up">
              <LogDot status={entry.status} />
              <span className="truncate">{entry.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{LOG_STATUS_LABEL[entry.status]}</span>
            </li>
          ))}
        </ul>
        {announcedEntry && (
          <span className="sr-only" aria-live="polite">
            {announcedEntry.name} {LOG_STATUS_LABEL[announcedEntry.status]}
          </span>
        )}
      </div>
    </section>
  );
}
