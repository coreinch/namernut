import type { CandidateSource } from "@/lib/candidates";
import type { FoundEntry, InstagramStatus } from "@/lib/types";
import { FOCUS_RING } from "./constants";

// Domain/Instagram availability (see below) says nothing about whether a
// name already means something real in the world — see lib/brandability.ts.
// score is 0-100: 0 as unrankable as "Google" itself, 100 as wide open as a
// long random string with no real-world usage anywhere. undefined until
// checked on demand via the "Brandability" button below; once scored,
// "Rescore" re-runs the same check (search results change over time, and
// so does the checker's own logic).
export interface BrandabilityDisplay {
  score: number | undefined;
  summary: string | undefined;
  loading: boolean;
  error: string | undefined;
}

// One accent per generation mechanism — shown as a left border on the
// card, real data carried through from FoundEntry.source (see
// CandidateSource) rather than re-derived from `meaning`'s display text.
// Dictionary and AI-invented reuse the app's two brand accents (they're the
// two most common sources); AI synonym and alt-spelling get their own hues
// so all four stay visually distinct at a glance.
const SOURCE_STYLE: Record<CandidateSource, { border: string; label: string }> = {
  dictionary: { border: "border-l-accent-2", label: "Dictionary pairing" },
  aiSynonym: { border: "border-l-teal-500 dark:border-l-teal-400", label: "AI synonym" },
  invented: { border: "border-l-accent", label: "AI-invented name" },
  altSpelling: { border: "border-l-pink-500 dark:border-l-pink-400", label: "Alternate spelling" },
};

export function ResultCard({
  entry,
  favorited,
  brandability,
  onSearch,
  onToggleFavorite,
  onCheckBrandability,
  onRegister,
}: {
  entry: FoundEntry;
  favorited: boolean;
  brandability: BrandabilityDisplay;
  onSearch: () => void;
  onToggleFavorite: () => void;
  onCheckBrandability: () => void;
  onRegister: () => void;
}) {
  const dotIndex = entry.domain.indexOf(".");
  const name = dotIndex >= 0 ? entry.domain.slice(0, dotIndex) : entry.domain;
  const tld = dotIndex >= 0 ? entry.domain.slice(dotIndex) : "";
  const sourceStyle = SOURCE_STYLE[entry.source ?? "dictionary"];

  return (
    <div
      className={`animate-fade-in-up flex flex-col gap-2 rounded-2xl border-l-4 bg-card p-3.5 shadow-[0_1px_3px_rgba(27,21,51,0.05)] dark:shadow-none ${sourceStyle.border}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          {/* The left border color-codes the source (see SOURCE_STYLE), but
              color alone isn't accessible — a screen reader never sees a
              border, and a hover-only `title` isn't reliably exposed by
              assistive tech either. This sr-only span gives the same
              information as real, always-available text. */}
          <span className="sr-only">{sourceStyle.label}: </span>
          <span className="font-display text-base font-semibold" title={sourceStyle.label}>
            {name}
            <span className="font-normal text-muted">{tld}</span>
          </span>
          <InstagramBadge status={entry.instagram} />
        </div>

        {/* flex-wrap here too (not shrink-0-and-rigid) — on a narrow phone
            this group (score badge/Brandability, favorite, search, Register) can
            exceed the card's width on its own even after the name row
            above has already wrapped away from it; wrapping internally,
            right-aligned, keeps every control fully reachable instead of
            clipping or forcing the card to scroll horizontally. */}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <BrandabilityBadge brandability={brandability} onCheck={onCheckBrandability} />
          <button
            onClick={onToggleFavorite}
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={favorited}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base leading-none transition-transform active:scale-90 ${FOCUS_RING} ${
              favorited ? "text-accent" : "text-black/30 hover:text-black/55 dark:text-white/30 dark:hover:text-white/55"
            }`}
          >
            {favorited ? "★" : "☆"}
          </button>
          <button
            onClick={onSearch}
            aria-label="Open a Google search for this name in a new tab"
            title="Google search"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black/30 transition-colors hover:text-black/55 dark:text-white/30 dark:hover:text-white/55 ${FOCUS_RING}`}
          >
            <SearchIcon size={14} />
          </button>
          <button
            onClick={onRegister}
            title="Register this domain on Namecheap"
            className={`flex min-h-9 shrink-0 items-center justify-center rounded-full bg-foreground px-4 text-xs font-semibold text-background transition-all active:scale-95 hover:opacity-90 ${FOCUS_RING}`}
          >
            Register
          </button>
        </div>
      </div>
      {/* Its own full-width line, not squeezed into whatever space is left
          next to the action buttons above — that layout (meaning sharing a
          flex row with Brandability/favorite/search/Register) let the actions
          crowd it down to a sliver of width, or nothing at all, on
          anything but a wide screen. */}
      <p className="text-xs leading-snug text-muted">{entry.meaning}</p>
      {brandability.summary && <p className="text-xs leading-snug text-muted">{brandability.summary}</p>}
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
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted"
      title="This name's domain is available, but the matching Instagram handle isn't"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-black/30 dark:bg-white/30" />
      IG taken
    </span>
  );
}

/** Emerald at 100 down to red at 0, passing through the same lime → amber →
 * orange progression a traffic-light-style meter would use — a semantic
 * scale kept independent of the brand accent colors. */
function scoreColorClass(score: number): { text: string; bg: string } {
  if (score >= 80) return { text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-500/12" };
  if (score >= 60) return { text: "text-lime-700 dark:text-lime-300", bg: "bg-lime-500/12" };
  if (score >= 40) return { text: "text-amber-700 dark:text-amber-300", bg: "bg-amber-500/12" };
  if (score >= 20) return { text: "text-orange-700 dark:text-orange-300", bg: "bg-orange-500/12" };
  return { text: "text-red-700 dark:text-red-300", bg: "bg-red-500/12" };
}

function BrandabilityBadge({ brandability, onCheck }: { brandability: BrandabilityDisplay; onCheck: () => void }) {
  if (brandability.loading) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-black/40 dark:bg-white/40" />
        Checking…
      </span>
    );
  }
  if (brandability.error) {
    return (
      <button
        type="button"
        onClick={onCheck}
        className={`whitespace-nowrap text-xs font-medium text-red-600 underline decoration-red-600/40 underline-offset-2 transition-colors hover:text-red-700 dark:text-red-400 dark:decoration-red-400/40 dark:hover:text-red-300 ${FOCUS_RING}`}
        title={brandability.error}
      >
        Retry
      </button>
    );
  }
  if (brandability.score === undefined) {
    return (
      <button
        type="button"
        onClick={onCheck}
        className={`min-h-9 shrink-0 whitespace-nowrap rounded-full border border-accent-2/40 px-3.5 text-xs font-medium text-accent-2 transition-all active:scale-95 hover:bg-accent-2/10 ${FOCUS_RING}`}
      >
        Brandability
      </button>
    );
  }
  const { text, bg } = scoreColorClass(brandability.score);
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${text} ${bg}`}
        aria-label={`${brandability.score}% brandable`}
      >
        {brandability.score}%
      </span>
      <button
        type="button"
        onClick={onCheck}
        className={`whitespace-nowrap text-xs font-medium text-muted underline decoration-black/25 underline-offset-2 transition-colors hover:text-foreground dark:decoration-white/25 ${FOCUS_RING}`}
      >
        Rescore
      </button>
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
