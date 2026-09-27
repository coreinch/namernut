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
import { checkStatusOnly, SOCIAL_CHECK_USER_AGENT, type SocialStatus } from "@/lib/socialStatus";

export async function checkTwitterHandle(handle: string, signal?: AbortSignal): Promise<SocialStatus> {
  return checkStatusOnly(
    `https://x.com/${encodeURIComponent(handle)}`,
    { "User-Agent": SOCIAL_CHECK_USER_AGENT, Accept: "text/html" },
    "twitter_rate_limited",
    signal
  );
}
