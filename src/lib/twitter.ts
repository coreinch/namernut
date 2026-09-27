/**
 * Checks X (formerly Twitter) handle availability by fetching the public
 * profile page at x.com and reading the HTTP status alone: a taken handle
 * serves the real profile page (200); a free one serves a real 404
 * (confirmed directly, 2026-09-27, against both a known-real handle and a
 * made-up one, including a handful of different handles back-to-back with
 * no sign of rate limiting in that test). Unlike instagram.ts/tiktok.ts,
 * there's no useful embedded HTML marker to fall back on either way — x.com
 * ships its profile data through a client-side GraphQL call, not baked into
 * the initial HTML — so the status code is the only signal available here,
 * not just the simplest one.
 *
 * This is the least trustworthy of this app's status-code-based checks
 * (npm.ts/github.ts hit real documented APIs; youtube.ts at least confirmed
 * a distinct 404 page): X is known for aggressive, frequently-changing bot
 * detection on unauthenticated scraping, and the fact that this held up in
 * one direct test is no guarantee it keeps working — same "may change
 * without notice" posture as every scraping-based check in this app, just
 * with a shakier foundation than most. Anything inconclusive resolves to
 * "unknown" rather than failing the whole search.
 */
import { SOCIAL_CHECK_USER_AGENT, type SocialStatus } from "@/lib/socialStatus";

// Matches rdap.ts's FETCH_TIMEOUT_MS — without this, a hung request here
// would keep discovery.ts's checkSocialOne waiting indefinitely rather than
// the retry/backoff path it's built for.
const FETCH_TIMEOUT_MS = 10000;

export async function checkTwitterHandle(handle: string, signal?: AbortSignal): Promise<SocialStatus> {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(`https://x.com/${encodeURIComponent(handle)}`, {
    headers: { "User-Agent": SOCIAL_CHECK_USER_AGENT, Accept: "text/html" },
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });

  if (res.status === 404) return "available";
  if (res.status === 200) return "taken";
  if (res.status === 429) {
    const err = new Error("twitter_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  return "unknown";
}
