import type { FoundEntry } from "@/lib/types";
import { ResultCard } from "./ResultCard";

/**
 * The vertical list of ResultCards — shared by all three tabs (Current /
 * Favorites / Archive), which previously each duplicated the same mapping/
 * brandability-prop-wiring block. A single-column list, not a grid — the
 * guided, one-thing-at-a-time layout stays narrow at every width rather
 * than spreading into columns on a wide screen. `pendingCount` (only ever
 * passed by the Current tab, while a search is actively running) adds that
 * many dashed placeholder rows after the real cards.
 */
export function ResultsGrid({
  entries,
  favoriteDomains,
  checkingBrandabilityNames,
  brandabilityErrors,
  onSearch,
  onToggleFavorite,
  onCheckBrandability,
  onRegister,
  pendingCount = 0,
}: {
  entries: FoundEntry[];
  favoriteDomains: Set<string>;
  checkingBrandabilityNames: Set<string>;
  brandabilityErrors: Record<string, string>;
  onSearch: (entry: FoundEntry) => void;
  onToggleFavorite: (entry: FoundEntry) => void;
  onCheckBrandability: (name: string, parts: [string, string] | undefined) => void;
  onRegister: (entry: FoundEntry) => void;
  pendingCount?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => {
        const name = entry.domain.split(".")[0];
        return (
          <ResultCard
            key={entry.id}
            entry={entry}
            favorited={favoriteDomains.has(entry.domain)}
            brandability={{
              score: entry.brandabilityScore,
              summary: entry.brandabilitySummary,
              loading: checkingBrandabilityNames.has(name),
              error: brandabilityErrors[name],
            }}
            onSearch={() => onSearch(entry)}
            onToggleFavorite={() => onToggleFavorite(entry)}
            onCheckBrandability={() => onCheckBrandability(name, entry.parts)}
            onRegister={() => onRegister(entry)}
          />
        );
      })}
      {Array.from({ length: pendingCount }).map((_, i) => (
        <PendingCard key={`pending-${i}`} />
      ))}
    </div>
  );
}

// Mirrors a real ResultCard's own structure (name+actions row, then a
// meaning line) at the same padding/gap, rather than a fixed-height box —
// a hardcoded height drifts out of sync with the real card's actual height
// (which varies with how long the meaning text wraps) and causes a visible
// jump each time a placeholder resolves into a real card.
function PendingCard() {
  return (
    <div className="flex animate-pulse flex-col gap-2 rounded-2xl border border-dashed border-black/15 bg-black/[0.02] p-3.5 dark:border-white/15 dark:bg-white/[0.02]">
      <div className="flex items-center justify-between gap-3">
        <div className="h-4 w-32 rounded bg-black/10 dark:bg-white/10" />
        <div className="h-9 w-24 rounded-full bg-black/10 dark:bg-white/10" />
      </div>
      <div className="h-3 w-3/5 rounded bg-black/10 dark:bg-white/10" />
    </div>
  );
}
