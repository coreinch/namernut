/** Shared by instagram.ts, github.ts, and tiktok.ts — each checks a
 * different platform's username/handle availability by a completely
 * different mechanism (an official REST API, an undocumented HTML
 * signal, login-walled scraping), but all three resolve to the same
 * three-state result, so runDiscovery's generalized per-platform check
 * runner (see discovery.ts) can treat them identically rather than
 * needing platform-specific handling at the call site. */
export type SocialStatus = "available" | "taken" | "unknown";
