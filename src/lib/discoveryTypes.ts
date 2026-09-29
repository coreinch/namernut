import type { CandidateSource } from "@/lib/candidates";
import type { SocialStatus } from "@/lib/socialStatus";

/**
 * Why a candidate was dropped before it could become a result — tallied per
 * search and reported on the final "complete"/"stopped" event so the UI can
 * explain where the names went instead of them vanishing silently. The
 * social-platform keys count names whose domain was available but whose
 * handle on that platform wasn't (or was inconclusive).
 */
export type FilterReason =
  | "tooLong"
  | "unpronounceable"
  | "typo"
  | "awkward"
  | "instagram"
  | "github"
  | "tiktok"
  | "npm"
  | "youtube"
  | "twitter";
export type FilterCounts = Partial<Record<FilterReason, number>>;

export type DiscoveryEvent =
  // Emitted by the /api/discover route itself (never by runDiscovery below)
  // right after the SSE connection opens, only when at least one AI
  // candidate source is actually about to be fetched — the route awaits
  // suggestKeywordSynonyms/suggestInventedNames before it has anything else
  // to send, and without this the client sees total silence for however
  // long that call takes (a real multi-second gap, not a rare edge case),
  // easily read as "stuck" rather than "the AI step is not done making up
  // words yet". Purely informational, like "synonyms"/"invented" below.
  | { type: "preparing" }
  // Emitted once, before any "checking" events, only when aiSynonyms is
  // non-empty — see suggestKeywordSynonyms in lib/synonyms.ts. Purely
  // informational: the words are already baked into the candidate space
  // buildCandidateSpace built (see runDiscovery below) by the time this
  // fires, so the UI can surface what's being searched without gating
  // anything on it.
  | { type: "synonyms"; words: string[] }
  // Same posture as "synonyms" above, but for suggestInventedNames in
  // lib/inventedNames.ts — a distinct event since these are complete
  // standalone candidate names, not halves paired with a dictionary word.
  | { type: "invented"; words: string[] }
  // Same posture again, but for alternateSpellings in
  // lib/alternateSpelling.ts — deterministic respellings of the literal
  // keyword (e.g. "lyft" for "lift"), not an AI suggestion at all. Emitted
  // synchronously (no "preparing" wait needed, since there's no LLM call
  // behind it) once runDiscovery starts, only when the list is non-empty.
  | { type: "altSpellings"; words: string[] }
  | { type: "checking"; name: string; checkedCount: number }
  | { type: "taken"; name: string; checkedCount: number }
  | { type: "unknown"; name: string; checkedCount: number }
  // The domain itself was available, but one of its required social
  // handles wasn't (or that check was inconclusive) — doesn't count
  // toward the target, but is still worth a distinct log entry rather
  // than looking identical to a plain domain-taken/unknown result.
  | { type: "filtered"; name: string; checkedCount: number }
  | {
      type: "found";
      domain: string;
      meaning: string;
      /** The two literal strings the name was concatenated from — see
       * Candidate.parts in lib/candidates.ts — carried through so
       * lib/brandability.ts can search the name as two separate words without
       * re-deriving the split. */
      parts: [string, string];
      checkedCount: number;
      foundCount: number;
      /** All six are always present regardless of which gates were on —
       * "unknown" for any platform that wasn't required (see
       * DiscoveryGates) rather than the field being absent, so the client
       * never has to distinguish "not checked" from "checked, but
       * inconclusive" itself. */
      instagram: SocialStatus;
      github: SocialStatus;
      tiktok: SocialStatus;
      npm: SocialStatus;
      youtube: SocialStatus;
      twitter: SocialStatus;
      /** Which generation mechanism produced this candidate — see CandidateSource — carried through so the UI can tell a dictionary pairing apart from an AI synonym/invented name/alt-spelling without re-parsing `meaning`. */
      source: CandidateSource;
    }
  | { type: "complete"; checkedCount: number; foundCount: number; filterCounts: FilterCounts }
  | { type: "stopped"; checkedCount: number; filterCounts: FilterCounts }
  | { type: "error"; message: string };

/**
 * Which of runDiscovery's candidate-rejection gates are actually active —
 * user-configurable (see the "Filters" section in page.tsx). Every gate
 * defaults to true (on) so the out-of-the-box behavior is unchanged from
 * before these were exposed, EXCEPT requireGithub, which defaults to false
 * (off) — see DEFERRED_PLATFORMS below for why GitHub specifically: it's
 * the one platform in this app confirmed (by a real 100-request-in-a-row
 * test, 2026-09-27) to actually hit a hard rate limit in practice, unlike
 * every other platform here (including two, Instagram/TikTok, that are
 * undocumented scraping just like GitHub's neighbors YouTube/X, and
 * including YouTube/X themselves, which cleared that same 100-request test
 * with zero rate-limit responses). Turning a gate off doesn't relax it —
 * it removes that check entirely, so more candidates (including
 * lower-quality ones) reach a real domain/social check.
 */
export interface DiscoveryGates {
  /** A result also requires an available Instagram username for the name — see DEFERRED_PLATFORMS/gateDisabled below. Off by default. */
  requireInstagram: boolean;
  /** Same requirement, for GitHub — see DEFERRED_PLATFORMS/gateDisabled below. Off by default. */
  requireGithub: boolean;
  /** Same requirement, for TikTok — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireTiktok: boolean;
  /** Same requirement, for an npm package name — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireNpm: boolean;
  /** Same requirement, for a YouTube channel handle — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireYoutube: boolean;
  /** Same requirement, for an X (Twitter) handle — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireTwitter: boolean;
  /** Reject candidates isPronounceable() flags as unpronounceable. */
  filterPronounceable: boolean;
  /** Reject candidates that read as a likely typo of a common word — see typocheck.ts. Only ever applies with no keyword (see worker() below). */
  filterTypos: boolean;
  /** Reject candidates with a rare/awkward letter pair — see niceness.ts. Only ever applies with no keyword (see worker() below). */
  filterNiceness: boolean;
}

/**
 * Parses the nine gate toggles from request query params. Every gate
 * except requireGithub defaults to on (true) if absent/malformed,
 * reproducing the pre-gates behavior; only the literal string "false"
 * turns one of those off. requireGithub defaults to off (false) instead —
 * see the DiscoveryGates doc comment above — so only the literal string
 * "true" turns it on.
 */
export function parseGates(searchParams: URLSearchParams): DiscoveryGates {
  const onByDefault = (key: string) => searchParams.get(key) !== "false";
  const offByDefault = (key: string) => searchParams.get(key) === "true";
  return {
    requireInstagram: offByDefault("requireInstagram"),
    requireGithub: offByDefault("requireGithub"),
    requireTiktok: onByDefault("requireTiktok"),
    requireNpm: onByDefault("requireNpm"),
    requireYoutube: onByDefault("requireYoutube"),
    requireTwitter: onByDefault("requireTwitter"),
    filterPronounceable: onByDefault("filterPronounceable"),
    filterTypos: onByDefault("filterTypos"),
    filterNiceness: onByDefault("filterNiceness"),
  };
}
