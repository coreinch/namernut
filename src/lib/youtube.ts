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
import { checkStatusOnly, SOCIAL_CHECK_USER_AGENT, type SocialStatus } from "@/lib/socialStatus";

export async function checkYoutubeHandle(handle: string, signal?: AbortSignal): Promise<SocialStatus> {
  return checkStatusOnly(
    `https://www.youtube.com/@${encodeURIComponent(handle)}`,
    { "User-Agent": SOCIAL_CHECK_USER_AGENT, Accept: "text/html" },
    "youtube_rate_limited",
    signal
  );
}
