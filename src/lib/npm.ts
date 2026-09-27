/**
 * Checks npm package name availability via the npm registry's own public
 * REST API (`GET /{name}` on registry.npmjs.org) — like github.ts, a real,
 * documented, officially-supported endpoint: 404 means the name is free,
 * 200 means it's taken, no scraping or undocumented HTML structure
 * involved. Confirmed directly (2026-09-27) against both a known-real
 * package ("react") and a random unlikely-to-exist string. Every candidate
 * name this app generates is already plain lowercase letters/digits (see
 * parseKeyword in candidates.ts and the dictionary source), which is a
 * valid, unscoped npm package name as-is — no extra normalization needed
 * here.
 */
import { SOCIAL_CHECK_USER_AGENT, type SocialStatus } from "@/lib/socialStatus";

// Matches rdap.ts's FETCH_TIMEOUT_MS — without this, a hung request here
// would keep discovery.ts's checkSocialOne waiting indefinitely rather than
// the retry/backoff path it's built for.
const FETCH_TIMEOUT_MS = 10000;

export async function checkNpmPackageName(name: string, signal?: AbortSignal): Promise<SocialStatus> {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { "User-Agent": SOCIAL_CHECK_USER_AGENT, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });

  if (res.status === 404) return "available";
  if (res.status === 200) return "taken";
  if (res.status === 429) {
    const err = new Error("npm_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  return "unknown";
}
