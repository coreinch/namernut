// Client-side domain types shared between src/app/page.tsx and the
// presentational components under src/components/ — split out so a
// component file doesn't need to import from page.tsx (the orchestrating
// component) just to get at a shape it renders.

// A type-only import — erased at compile time, so this doesn't pull
// candidates.ts's runtime code (or its dictionary-data dependency) into the
// client bundle. Same pattern as DiscoveryGates in page.tsx.
import type { CandidateSource } from "@/lib/candidates";

// "filtered": the domain itself was available, but its Instagram username
// wasn't (or the check was inconclusive) — see the "instagram" filter,
// which requires both to count as a result.
export type LogStatus = "checking" | "taken" | "unknown" | "available" | "filtered";

export interface LogEntry {
  id: string;
  name: string;
  status: LogStatus;
}

export type InstagramStatus = "available" | "taken" | "unknown";

export interface FoundEntry {
  id: string;
  domain: string;
  meaning: string;
  // The two literal strings domain's name was concatenated from — see
  // Candidate.parts in lib/candidates.ts — passed to checkBrandabilityFor so
  // it can search the name as two separate words. Optional so entries
  // persisted before this field existed still hydrate fine; absent means
  // checkBrandabilityFor falls back to brandability.ts's own dictionary-based
  // guess (splitIntoWords) instead.
  parts?: [string, string];
  checkedCount: number;
  runId: string;
  // Optional so entries persisted before this field existed still hydrate
  // fine — treated as "unknown" wherever it's read (see InstagramBadge).
  instagram?: InstagramStatus;
  // Populated on demand via checkBrandabilityFor (the "Brandability" button
  // in BrandabilityBadge) — absent until checked, or if the check
  // failed. 0 = as unrankable as "Google" itself; 100 = a long random
  // string with no real-world usage anywhere to compete with.
  brandabilityScore?: number;
  brandabilitySummary?: string;
  // Which generation mechanism produced this result — see CandidateSource.
  // Optional so entries persisted before this field existed still hydrate
  // fine; treated as "dictionary" wherever it's read (see ResultCard).
  source?: CandidateSource;
}

export type RunStatus = "idle" | "running" | "stopped" | "found" | "error";
