import type { RefObject } from "react";
import type { LogEntry } from "@/lib/types";
import { LogDot, LOG_STATUS_LABEL } from "./LogDot";

// Rendered only once there's actually something to show — an empty log box
// with a placeholder illustration was pure filler on every load before the
// first search — so this returns null itself rather than the caller
// needing its own `log.length > 0 &&` guard.
export function LiveLogSection({ log, logBoxRef }: { log: LogEntry[]; logBoxRef: RefObject<HTMLDivElement | null> }) {
  if (log.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-black/65 dark:text-white/65">Live log</h2>
      <div
        ref={logBoxRef}
        className="thin-scrollbar max-h-[45vh] overflow-y-auto rounded-xl border border-black/15 p-3 font-mono text-sm dark:border-white/15"
        aria-live="polite"
      >
        <ul className="space-y-0.5">
          {log.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 animate-fade-in-up">
              <LogDot status={entry.status} />
              <span className="truncate text-black/90 dark:text-white/90">{entry.name}</span>
              <span className="ml-auto shrink-0 text-xs text-black/45 dark:text-white/45">
                {LOG_STATUS_LABEL[entry.status]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
