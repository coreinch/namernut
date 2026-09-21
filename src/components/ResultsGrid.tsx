import type { FoundEntry } from "@/lib/types";
import { ResultCard } from "./ResultCard";

/**
 * The vertical list of ResultCards — shared by all three tabs (Current /
 * Favorites / Archive), which previously each duplicated the same mapping/
 * collision-prop-wiring block. A single-column list, not a grid — the
 * guided, one-thing-at-a-time layout stays narrow at every width rather
 * than spreading into columns on a wide screen. `pendingCount` (only ever
 * passed by the Current tab, while a search is actively running) adds that
 * many dashed placeholder rows after the real cards.
 */
export function ResultsGrid({
  entries,
  favoriteDomains,
  checkingCollisionNames,
  collisionErrors,
  onSearch,
  onToggleFavorite,
  onCheckCollision,
  onRegister,
  pendingCount = 0,
}: {
  entries: FoundEntry[];
  favoriteDomains: Set<string>;
  checkingCollisionNames: Set<string>;
  collisionErrors: Record<string, string>;
  onSearch: (entry: FoundEntry) => void;
  onToggleFavorite: (entry: FoundEntry) => void;
  onCheckCollision: (name: string, parts: [string, string] | undefined) => void;
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
            collision={{
              score: entry.rankabilityScore,
              summary: entry.collisionSummary,
              loading: checkingCollisionNames.has(name),
              error: collisionErrors[name],
            }}
            onSearch={() => onSearch(entry)}
            onToggleFavorite={() => onToggleFavorite(entry)}
            onCheckCollision={() => onCheckCollision(name, entry.parts)}
            onRegister={() => onRegister(entry)}
          />
        );
      })}
      {Array.from({ length: pendingCount }).map((_, i) => (
        <div
          key={`pending-${i}`}
          className="h-16 animate-pulse rounded-2xl border border-dashed border-black/15 bg-black/[0.02] dark:border-white/15 dark:bg-white/[0.02]"
        />
      ))}
    </div>
  );
}
