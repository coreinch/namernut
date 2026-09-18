import { CONTENT_WIDTH, FOCUS_RING } from "./constants";

export function Footer({
  isRunning,
  primaryLabel,
  statusText,
  onStart,
  onStop,
}: {
  isRunning: boolean;
  primaryLabel: string;
  statusText: string;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <footer className="shrink-0 border-t border-black/15 bg-background/80 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-md dark:border-white/15">
      <div className={`mx-auto flex w-full flex-col gap-2 ${CONTENT_WIDTH}`}>
        {isRunning ? (
          <button
            onClick={onStop}
            className={`min-h-12 w-full rounded-full border border-black/25 text-base font-semibold transition-transform active:scale-[0.98] hover:bg-black/5 dark:border-white/30 dark:hover:bg-white/10 ${FOCUS_RING}`}
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onStart}
            className={`min-h-12 w-full rounded-full bg-foreground text-base font-semibold text-background transition-transform active:scale-[0.98] hover:opacity-90 ${FOCUS_RING}`}
          >
            {primaryLabel}
          </button>
        )}
        <div className="flex items-center justify-center text-xs tabular-nums text-black/65 dark:text-white/65">
          {statusText}
        </div>
      </div>
    </footer>
  );
}
