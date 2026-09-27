import { useEffect, useRef, useState } from "react";
import { FOCUS_RING, PAGE_WIDTH } from "./constants";

// Rendered only while a search is running — the primary "start" action now
// lives in the search pill at the top of the page (see SearchBar), but a
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
  // statusText changes on nearly every candidate checked — announcing it
  // live at that rate would drown a screen-reader user in chatter. This
  // mirrors it into a separate region that only updates a few times a
  // minute, so AT users get a periodic summary instead of a firehose.
  const [announcedStatus, setAnnouncedStatus] = useState(statusText);
  const latestStatusText = useRef(statusText);
  useEffect(() => {
    latestStatusText.current = statusText;
  });
  useEffect(() => {
    if (!isRunning) return;
    setAnnouncedStatus(latestStatusText.current);
    const id = setInterval(() => setAnnouncedStatus(latestStatusText.current), 4000);
    return () => clearInterval(id);
  }, [isRunning]);

  if (!isRunning) return null;
  return (
    <footer className="shrink-0 border-t border-black/10 bg-background/85 px-4 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] backdrop-blur-md dark:border-white/10">
      {/* isRunning implies a search has started, i.e. never the first-visit
          hero stage — PAGE_WIDTH (not CONTENT_WIDTH) always matches that
          wider rail+content layout, same reasoning as Header's. */}
      <div className={`mx-auto flex w-full items-center justify-between gap-3 ${PAGE_WIDTH}`}>
        <span aria-hidden="true" className="min-w-0 truncate text-xs tabular-nums text-muted">
          {statusText}
        </span>
        <span className="sr-only" aria-live="polite">
          {announcedStatus}
        </span>
        <button
          type="button"
          onClick={onStop}
          className={`min-h-9 shrink-0 rounded-full bg-black/70 px-4 text-xs font-semibold text-white transition-transform active:scale-95 hover:bg-black/80 dark:bg-white/20 dark:hover:bg-white/30 ${FOCUS_RING}`}
        >
          Stop
        </button>
      </div>
    </footer>
  );
}
