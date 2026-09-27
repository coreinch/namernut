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

// Matches rdap.ts's own FETCH_TIMEOUT_MS (kept separate there since rdap.ts
// has an extra bootstrap-lookup step this helper doesn't need to know
// about) — without this, a hung request from any platform checker would
// keep discovery.ts's checkSocialOne waiting indefinitely rather than the
// retry/backoff path it's built for.
const FETCH_TIMEOUT_MS = 10000;

/** Shared by github.ts, npm.ts, instagram.ts, tiktok.ts, youtube.ts, and
 * twitter.ts — each previously hand-rolled the same
 * `AbortSignal.timeout(...)` + `AbortSignal.any([signal, timeoutSignal])`
 * composition. Centralized so the timeout value and composition logic can
 * only drift in one place, not six. */
export function fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return fetch(url, {
    ...init,
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
}

/** Shared by every platform checker's 429/rate-limit branch — the checker
 * runner in discovery.ts distinguishes rate limiting from other failures by
 * this `name`, not by message content, so the message itself just needs to
 * be a useful log string per platform. */
export function throwRateLimited(message: string): never {
  const err = new Error(message);
  err.name = "RateLimitError";
  throw err;
}

/** Shared by npm.ts, youtube.ts, and twitter.ts — all three resolve
 * availability from the HTTP status code alone (404 free, 200 taken, 429
 * rate-limited), with no HTML scraping needed. github.ts, instagram.ts, and
 * tiktok.ts each have their own extra status/body handling and call
 * fetchWithTimeout/throwRateLimited directly instead. */
export async function checkStatusOnly(
  url: string,
  headers: Record<string, string>,
  rateLimitMessage: string,
  signal?: AbortSignal
): Promise<SocialStatus> {
  const res = await fetchWithTimeout(url, { headers }, signal);
  if (res.status === 404) return "available";
  if (res.status === 200) return "taken";
  if (res.status === 429) throwRateLimited(rateLimitMessage);
  return "unknown";
}
