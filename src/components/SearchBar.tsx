import { HOOK, MECHANISM } from "@/lib/copy";
import { FOCUS_RING } from "./constants";

function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The one control every visitor actually needs: a keyword + Generate/Stop.
 * Two visual modes driven entirely by `mode`, same underlying input/button —
 * `"hero"` is the full-screen first-visit treatment (value-prop copy, large
 * type, example chips), `"compact"` is what every later stage uses once
 * there's a header/tabs/results above and below it (small, no copy, plus a
 * "Customize" trigger for SettingsDrawer since the settings panel doesn't
 * live inline in either mode — see page.tsx). `onOpenSettings` is
 * only read in compact mode: hero mode intentionally offers no way to reach
 * those settings at all, so a first-time visitor's only decision is the
 * keyword itself (see the redesign's progressive-disclosure reasoning).
 */
export function SearchBar({
  mode,
  keywordInput,
  onKeywordInputChange,
  isRunning,
  primaryLabel,
  onStart,
  onStop,
  exampleKeywords,
  onTryExample,
  onOpenSettings,
  settingsOpen,
}: {
  mode: "hero" | "compact";
  keywordInput: string;
  onKeywordInputChange: (value: string) => void;
  isRunning: boolean;
  primaryLabel: string;
  onStart: () => void;
  onStop: () => void;
  exampleKeywords: string[];
  onTryExample: (keyword: string) => void;
  onOpenSettings?: () => void;
  /** Whether SettingsDrawer (opened by onOpenSettings) is currently open —
   * surfaced as aria-expanded on the trigger below so a screen-reader user
   * gets the same open/closed signal a sighted user reads from the drawer's
   * own visibility, rather than a static button with no state at all. */
  settingsOpen?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {mode === "hero" && (
        <>
          <h1 className="text-center font-display text-xl font-semibold leading-tight sm:text-2xl">
            {HOOK}
          </h1>
          <p className="text-center text-sm text-muted">{MECHANISM}</p>
          <p className="mt-2 text-center text-xs font-medium uppercase tracking-wide text-muted">
            What&rsquo;s your keyword?
          </p>
        </>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isRunning) onStart();
        }}
        className="flex items-center gap-2 rounded-full bg-card p-2 shadow-[0_4px_20px_rgba(27,21,51,0.12)] dark:shadow-none"
      >
        <input
          type="text"
          inputMode="text"
          aria-label="Keyword to include (optional)"
          value={keywordInput}
          onChange={(e) => onKeywordInputChange(e.target.value)}
          placeholder="e.g. glow, coffee"
          maxLength={15}
          className={`min-h-12 min-w-0 flex-1 rounded-full bg-transparent px-4 text-base outline-none placeholder:text-black/40 dark:placeholder:text-white/40 ${
            mode === "hero" ? "sm:min-h-14 sm:text-lg" : ""
          } ${FOCUS_RING}`}
        />
        {/* Hidden at lg: the desktop settings rail (see page.tsx) is always
            visible there, so there's nothing for this trigger to open. */}
        {mode === "compact" && onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Customize search options"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen ?? false}
            title="Search options"
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/5 hover:text-black/70 lg:hidden dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70 ${FOCUS_RING}`}
          >
            <SlidersIcon />
          </button>
        )}
        {/* Submit (not a plain click handler) while idle, so pressing Enter
            in the keyword field above also starts a search — the same
            submit-on-Enter behavior every other text-input search box has.
            While running this reverts to a plain button: Enter shouldn't
            stop an in-progress search. */}
        <button
          // Only ever one of these mounted at a time (page.tsx renders
          // either the hero or compact SearchBar, never both — see its own
          // isFirstVisit branch), so a fixed id is safe. Used by page.tsx
          // to refocus this button when the Footer's own Stop control
          // unmounts out from under a keyboard/screen-reader user's focus
          // (see the isRunning effect there) — this button is the one
          // still-visible, always-present equivalent action once that
          // happens.
          id="primary-search-action"
          type={isRunning ? "button" : "submit"}
          onClick={isRunning ? onStop : undefined}
          className={`min-h-12 shrink-0 whitespace-nowrap rounded-full px-6 text-base font-semibold text-white transition-all active:scale-95 ${
            mode === "hero" ? "sm:min-h-14 sm:px-8 sm:text-lg" : ""
          } ${
            isRunning ? "bg-black/70 hover:bg-black/80 dark:bg-white/25 dark:hover:bg-white/35" : "bg-accent hover:opacity-90"
          } ${FOCUS_RING}`}
        >
          {isRunning ? "Stop" : primaryLabel}
        </button>
      </form>

      {/* Example chips are a hero-only, zero-typing on-ramp for a first-time
          visitor — see EXAMPLE_KEYWORDS in page.tsx. Once past the first
          visit, "compact" mode drops them: at that point retyping/switching
          keyword is a much smaller ask than it was on a blank first screen. */}
      {mode === "hero" && !isRunning && (
        <div className="-mt-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs text-muted">
          <span>Try:</span>
          {exampleKeywords.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => onTryExample(word)}
              className={`rounded-full px-2 py-1 underline decoration-black/25 underline-offset-4 transition-colors hover:text-foreground dark:decoration-white/25 ${FOCUS_RING}`}
            >
              {word}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
