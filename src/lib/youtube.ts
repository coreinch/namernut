/**
 * Checks YouTube channel handle (the `@name` in youtube.com/@name) availability
 * by fetching the public channel page and reading the HTTP status alone: a
 * taken handle serves the real channel page (200); a free one serves
 * YouTube's own 404 page (confirmed directly, 2026-09-27, by its
 * `<title>404 Not Found</title>`) — no HTML-content scraping needed the way
 * instagram.ts/tiktok.ts require, since YouTube's 404 here is a real,
 * distinct HTTP status rather than a 200 page with an error message baked
 * in. fetch() follows redirects by default, which matters here: an
 * unauthenticated request is first redirected through a cookie-consent
 * bounce (`?cbrd=1&ucbcb=1`) before landing on the real channel-or-404
 * response — confirmed both a real handle and a made-up one follow the
 * exact same redirect shape and still resolve to the correct final status.
 *
 * Like instagram.ts/tiktok.ts, this is undocumented behavior (an HTTP
 * status code convention, not a published API) that can change without
 * notice, so anything inconclusive resolves to "unknown" rather than
 * failing the whole search.
 */
import { SOCIAL_CHECK_USER_AGENT, type SocialStatus } from "@/lib/socialStatus";

// Matches rdap.ts's FETCH_TIMEOUT_MS — without this, a hung request here
// would keep discovery.ts's checkSocialOne waiting indefinitely rather than
// the retry/backoff path it's built for.
const FETCH_TIMEOUT_MS = 10000;

export async function checkYoutubeHandle(handle: string, signal?: AbortSignal): Promise<SocialStatus> {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(`https://www.youtube.com/@${encodeURIComponent(handle)}`, {
    headers: { "User-Agent": SOCIAL_CHECK_USER_AGENT, Accept: "text/html" },
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });

  if (res.status === 404) return "available";
  if (res.status === 200) return "taken";
  if (res.status === 429) {
    const err = new Error("youtube_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  return "unknown";
}
