import { useMemo } from "react";
import type { FoundEntry } from "@/lib/types";

// Derives the three result lists the tabs show, plus the starred-domain set.
export function useResultLists({
  foundHistory,
  favorites,
  activeRunId,
  archiveFilter,
}: {
  foundHistory: FoundEntry[];
  favorites: FoundEntry[];
  activeRunId: string;
  archiveFilter: string;
}) {
  // foundHistory is stored newest-first (new finds are prepended, so
  // Favorites/Archive read newest-first). Reverse just this slice first so
  // ties (equal score, or both still unscored) fall back to discovery
  // order — first found stays earlier, each new one appends after it —
  // rather than reshuffling on every find. Then rank by brandabilityScore,
  // highest first, same as the Archive tab below: since autoCheck fires a
  // brandability check as soon as a result is found, scores stream in
  // asynchronously and the list re-sorts as they land. Entries with no
  // score yet sort last via the ?? -1 fallback.
  const currentRunResults = useMemo(
    () =>
      foundHistory
        .filter((e) => e.runId === activeRunId)
        .slice()
        .reverse()
        .sort((a, b) => (b.brandabilityScore ?? -1) - (a.brandabilityScore ?? -1)),
    [foundHistory, activeRunId]
  );
  // Everything not from the active run, ranked best-first (highest
  // brandabilityScore — easiest to actually rank #1 for — at the top): once
  // a result has aged out of the current run, how promising it is matters
  // more than when it happened to turn up. Entries with no score yet
  // (never checked — see FoundEntry) sort last, via the ?? -1 fallback,
  // rather than being scattered among real 0-100 scores. Always reachable
  // via the Archive tab (see Header) — there's no separate "top ranked"
  // slot to fill an idle screen anymore, since the tab itself is always on
  // screen.
  const archiveResults = useMemo(
    () =>
      foundHistory
        .filter((e) => e.runId !== activeRunId)
        .slice()
        .sort((a, b) => (b.brandabilityScore ?? -1) - (a.brandabilityScore ?? -1)),
    [foundHistory, activeRunId]
  );
  // Matches on the domain only (not `meaning`'s free-text description) —
  // the filter box exists to jump back to a specific name someone
  // remembers, not to full-text search every dictionary-pairing blurb.
  const trimmedArchiveFilter = archiveFilter.trim().toLowerCase();
  const filteredArchiveResults = useMemo(
    () =>
      trimmedArchiveFilter
        ? archiveResults.filter((e) => e.domain.toLowerCase().includes(trimmedArchiveFilter))
        : archiveResults,
    [archiveResults, trimmedArchiveFilter]
  );
  const favoriteDomains = useMemo(() => new Set(favorites.map((f) => f.domain)), [favorites]);

  return { currentRunResults, archiveResults, filteredArchiveResults, favoriteDomains };
}
