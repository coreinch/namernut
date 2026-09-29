import { useState } from "react";
import type { FilterCounts, FilterReason } from "@/lib/discoveryTypes";
import { FOCUS_RING } from "./constants";

// Display order and wording for each reason — see FilterReason in
// lib/discoveryTypes.ts. Local-quality reasons first, then the social
// handles, each phrased as what was wrong with the candidate.
const REASON_LABEL: Record<FilterReason, string> = {
  tooLong: "Longer than the max length",
  unpronounceable: "Hard to pronounce",
  typo: "Looked like a typo of a common word",
  awkward: "Awkward letter combination",
  instagram: "Instagram handle taken or unchecked",
  github: "GitHub username taken or unchecked",
  tiktok: "TikTok handle taken or unchecked",
  npm: "npm package name taken or unchecked",
  youtube: "YouTube handle taken or unchecked",
  twitter: "X handle taken or unchecked",
};

/** Sum of every reason's count — a name blocked by two social platforms counts under both. */
export function totalFiltered(counts: FilterCounts) {
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
}

// Collapsed by default, and only rendered once a run has finished with at
// least one filtered candidate: without it, names that fail a quality gate
// or a social check simply vanish, which reads as "the search found
// nothing" rather than "the search found plenty, and these rules removed
// it". Doubles as a hint for which gate to loosen when a run comes up empty.
export function FilterSummary({ counts }: { counts: FilterCounts }) {
  const [expanded, setExpanded] = useState(false);
  const rows = (Object.keys(REASON_LABEL) as FilterReason[])
    .map((reason) => ({ reason, count: counts[reason] ?? 0 }))
    .filter((r) => r.count > 0);
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="filter-summary-panel"
        className={`inline-flex items-center gap-1.5 self-start rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted transition-colors hover:text-foreground ${FOCUS_RING}`}
      >
        {expanded ? "Hide" : "Show"} why names were filtered out ({totalFiltered(counts)})
      </button>
      <div
        id="filter-summary-panel"
        hidden={!expanded}
        className="rounded-2xl bg-card p-3 text-sm shadow-[0_1px_3px_rgba(27,21,51,0.05)] dark:shadow-none"
      >
        <ul className="space-y-0.5">
          {rows.map(({ reason, count }) => (
            <li key={reason} className="flex items-center gap-2">
              <span>{REASON_LABEL[reason]}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{count}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Turn off the matching filter in Settings to let these through. A name blocked on several platforms is counted under each.
        </p>
      </div>
    </section>
  );
}
