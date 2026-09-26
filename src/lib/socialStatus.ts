/** Shared by instagram.ts, github.ts, and tiktok.ts — each checks a
 * different platform's username/handle availability by a completely
 * different mechanism (an official REST API, an undocumented HTML
 * signal, login-walled scraping), but all three resolve to the same
 * three-state result, so runDiscovery's generalized per-platform check
 * runner (see discovery.ts) can treat them identically rather than
 * needing platform-specific handling at the call site. */
export type SocialStatus = "available" | "taken" | "unknown";

/** Shared outbound User-Agent for instagram.ts, github.ts, and tiktok.ts —
 * kept in one place so a future rename doesn't leave it stale in three
 * files at once (it previously read "DomainFinderBot", a name from before
 * two renames). Honestly identifies this tool as itself rather than as a
 * browser or another service's crawler — see instagram.ts's docstring for
 * why that's a deliberate choice, not an oversight. */
export const SOCIAL_CHECK_USER_AGENT = "Mozilla/5.0 (compatible; NamernutBot/1.0; +https://namernut.com)";
