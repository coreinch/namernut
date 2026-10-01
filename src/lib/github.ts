/**
 * Checks GitHub username availability via GitHub's own public REST API
 * (`GET /users/{username}`) — unlike instagram.ts/tiktok.ts, this is a
 * real, documented, officially-supported endpoint: 404 means the username
 * is free, 200 means it's taken, no scraping or undocumented HTML
 * structure involved. Confirmed directly (2026-09-25) against both a
 * known-real account and a random unlikely-to-exist string. Unauthenticated
 * requests are capped at 60/hour per IP (GitHub's documented limit) — no
 * token is used here since this app has no GitHub App/PAT configured. This
 * is checked once per domain-available candidate, not once per *found*
 * result (see runDiscovery in discovery.ts) — a candidate whose domain is
 * free but whose GitHub username is taken still costs one of these checks
 * even though it doesn't count toward the search's target. When GitHub
 * availability is the actual bottleneck, that volume is NOT bounded by the
 * handful of results a search asks for: a direct 100-request-in-a-row test
 * (2026-09-27, see DEFERRED_PLATFORMS in discovery.ts) hit this exact 403
 * limit at request #61 within a single search, which is why requireGithub
 * now defaults to off (see DEFAULT_GATES in usePersistedAppState.ts).
 */
import { fetchMaybeProxied, SOCIAL_CHECK_USER_AGENT, throwRateLimited, type SocialStatus } from "@/lib/socialStatus";

export async function checkGithubUsername(username: string, signal?: AbortSignal): Promise<SocialStatus> {
  const res = await fetchMaybeProxied(
    `https://api.github.com/users/${encodeURIComponent(username)}`,
    { headers: { "User-Agent": SOCIAL_CHECK_USER_AGENT, Accept: "application/vnd.github+json" } },
    signal
  );

  if (res.status === 404) return "available";
  if (res.status === 200) return "taken";
  // Per GitHub's own API docs, later independently confirmed by a real
  // 100-request-in-a-row burst (2026-09-27, see DEFERRED_PLATFORMS in
  // discovery.ts) that hit this exact response — 403 with
  // X-RateLimit-Remaining: 0, not 429 — right on schedule at request #61:
  // the unauthenticated rate limit. Checked explicitly rather than treating
  // every 403 as a rate limit (a 403 can also mean e.g. an abuse-detection
  // block, which retrying identically wouldn't fix any faster) — but the
  // same backoff-then-give-up handling in discovery.ts's generalized
  // checker is a reasonable response to either.
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    throwRateLimited("github_rate_limited");
  }
  return "unknown";
}
