import type { FoundEntry } from "@/lib/types";
import { ResultCard } from "./ResultCard";

/**
 * The grid of ResultCards — shared by "Available domains", "Top ranked",
 * "Favorites", and "Previous results", which previously each duplicated
 * the same mapping/collision-prop-wiring block. `pendingCount` (only ever
 * passed by "Available domains", while a search is actively running) adds
 * that many dashed placeholder tiles after the real cards.
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
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
          className="h-[76px] animate-pulse rounded-xl border border-dashed border-black/15 bg-black/[0.02] dark:border-white/15 dark:bg-white/[0.02]"
        />
      ))}
    </div>
  );
}
