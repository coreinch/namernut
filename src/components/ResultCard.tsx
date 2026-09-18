import type { FoundEntry, InstagramStatus } from "@/lib/types";
import { FOCUS_RING } from "./constants";

// Domain/Instagram availability (see below) says nothing about whether a
// name already means something real in the world — see lib/collision.ts.
// score is 0-100: 0 as unrankable as "Google" itself, 100 as wide open as a
// long random string with no real-world usage anywhere. undefined until
// checked on demand via the "Rank" button below; once scored,
// "Rescore" re-runs the same check (search results change over time, and
// so does the checker's own logic).
export interface CollisionDisplay {
  score: number | undefined;
  summary: string | undefined;
  loading: boolean;
  error: string | undefined;
}

export function ResultCard({
  entry,
  favorited,
  collision,
  onSearch,
  onToggleFavorite,
  onCheckCollision,
  onRegister,
}: {
  entry: FoundEntry;
  favorited: boolean;
  collision: CollisionDisplay;
  onSearch: () => void;
  onToggleFavorite: () => void;
  onCheckCollision: () => void;
  onRegister: () => void;
}) {
  return (
    <div className="animate-fade-in-up flex flex-col gap-2 rounded-xl border border-black/15 p-3 transition-colors hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-sm font-semibold text-emerald-700 md:text-base dark:text-emerald-400">
            {entry.domain}
          </span>
          <InstagramBadge status={entry.instagram} />
        </div>
        <div className="-mr-2 flex shrink-0 items-center">
          <button
            onClick={onSearch}
            aria-label="Open a Google search for this name in a new tab"
            title="Google search"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-black/35 transition-colors hover:text-black/55 dark:text-white/35 dark:hover:text-white/55 ${FOCUS_RING}`}
          >
            <SearchIcon size={14} />
          </button>
          <button
            onClick={onToggleFavorite}
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={favorited}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base leading-none transition-transform active:scale-90 ${FOCUS_RING} ${
              favorited ? "text-emerald-500" : "text-black/35 hover:text-black/55 dark:text-white/35 dark:hover:text-white/55"
            }`}
          >
            {favorited ? "★" : "☆"}
          </button>
        </div>
      </div>
      <span className="text-xs text-black/55 md:text-sm dark:text-white/55">{entry.meaning}</span>
      <CollisionBadge collision={collision} onCheck={onCheckCollision} />
      <button
        onClick={onRegister}
        className={`flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-600 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-emerald-500 md:text-sm dark:bg-emerald-500 dark:text-black dark:hover:bg-emerald-400 ${FOCUS_RING}`}
      >
        Register on Namecheap
      </button>
    </div>
  );
}

// "unknown" (Instagram's response was inconclusive, e.g. rate-limited) or
// no field at all (an entry persisted before this existed) both render
// nothing — there's nothing useful to tell the user in either case, and the
// "Instagram" button below still works either way.
// Every result in this list already passed the "domain + Instagram both
// available" gate in runDiscovery (see discovery.ts) — so "available" is
// the expected, unremarkable case for a card that exists at all, and
// saying so on every single card is noise, not information. "taken" only
// happens via the rare fallback where Instagram checking got disabled
// mid-search (see INSTAGRAM_BLOCKED_STREAK_THRESHOLD) and a domain-only
// match started counting — that's the one outcome actually worth flagging,
// so it's the only one rendered here. "unknown" (inconclusive check) is
// unremarkable in the same way "available" is and also renders nothing.
function InstagramBadge({ status }: { status: InstagramStatus | undefined }) {
  if (status !== "taken") return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-black/40 dark:text-white/40"
      title="This name's domain is available, but the matching Instagram handle isn't"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-black/30 dark:bg-white/30" />
      IG taken
    </span>
  );
}

/** Emerald at 100 down to red at 0, passing through the same lime → amber →
 * orange progression a traffic-light-style meter would use. */
function scoreColorClass(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-lime-600 dark:text-lime-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  if (score >= 20) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function CollisionBadge({ collision, onCheck }: { collision: CollisionDisplay; onCheck: () => void }) {
  if (collision.loading) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-black/45 dark:text-white/45">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-black/40 dark:bg-white/40" />
        Checking…
      </span>
    );
  }
  if (collision.error) {
    return (
      <button
        type="button"
        onClick={onCheck}
        className={`self-start text-xs font-medium text-red-600 underline decoration-red-600/40 underline-offset-2 transition-colors hover:text-red-700 dark:text-red-400 dark:decoration-red-400/40 dark:hover:text-red-300 ${FOCUS_RING}`}
        title={collision.error}
      >
        Check failed — retry
      </button>
    );
  }
  if (collision.score === undefined) {
    return (
      <button
        type="button"
        onClick={onCheck}
        className={`flex min-h-11 w-full items-center justify-center rounded-lg border border-emerald-600/30 text-xs font-medium text-emerald-700 transition-all active:scale-95 hover:bg-emerald-500/10 md:text-sm dark:text-emerald-300 ${FOCUS_RING}`}
      >
        Rank
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-semibold tabular-nums md:text-sm ${scoreColorClass(collision.score)}`}>
          {collision.score}% rankable
        </span>
        <button
          type="button"
          onClick={onCheck}
          className={`text-xs font-medium text-black/45 underline decoration-black/25 underline-offset-2 transition-colors hover:text-black/65 md:text-sm dark:text-white/45 dark:decoration-white/25 dark:hover:text-white/65 ${FOCUS_RING}`}
        >
          Rescore
        </button>
      </div>
      {collision.summary && (
        <span className="text-xs leading-snug text-black/55 md:text-sm dark:text-white/55">{collision.summary}</span>
      )}
    </div>
  );
}

function SearchIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
