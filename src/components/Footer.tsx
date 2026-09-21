import { CONTENT_WIDTH, FOCUS_RING } from "./constants";

// Rendered only while a search is running — the primary "start" action now
// lives in the search pill at the top of the page (see FiltersPanel), but a
// live run still gets a Stop control docked here, reachable without
// scrolling back up no matter how far down a long result list or log the
// page has scrolled.
export function Footer({
  isRunning,
  statusText,
  onStop,
}: {
  isRunning: boolean;
  statusText: string;
  onStop: () => void;
}) {
  if (!isRunning) return null;
  return (
    <footer className="shrink-0 border-t border-black/10 bg-background/85 px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] backdrop-blur-md dark:border-white/10">
      <div className={`mx-auto flex w-full items-center justify-between gap-3 ${CONTENT_WIDTH}`}>
        <span className="min-w-0 truncate text-xs tabular-nums text-muted">{statusText}</span>
        <button
          onClick={onStop}
          className={`min-h-9 shrink-0 rounded-full bg-black/70 px-4 text-xs font-semibold text-white transition-transform active:scale-95 hover:bg-black/80 dark:bg-white/20 dark:hover:bg-white/30 ${FOCUS_RING}`}
        >
          Stop
        </button>
      </div>
    </footer>
  );
}
