/**
 * Checks GitHub username availability via GitHub's own public REST API
 * (`GET /users/{username}`) — unlike instagram.ts/tiktok.ts, this is a
 * real, documented, officially-supported endpoint: 404 means the username
 * is free, 200 means it's taken, no scraping or undocumented HTML
 * structure involved. Confirmed directly (2026-09-25) against both a
 * known-real account and a random unlikely-to-exist string. Unauthenticated
 * requests are capped at 60/hour per IP (GitHub's documented limit) — no
 * token is used here since this app has no GitHub App/PAT configured and
 * the volume a single search generates (checked once per found name, same
 * as Instagram — see checkGithubOne in discovery.ts) stays well under that
 * in normal use.
 */
import type { SocialStatus } from "@/lib/socialStatus";

const USER_AGENT = "Mozilla/5.0 (compatible; DomainFinderBot/1.0)";

export async function checkGithubUsername(username: string, signal?: AbortSignal): Promise<SocialStatus> {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" },
    signal,
  });

  if (res.status === 404) return "available";
  if (res.status === 200) return "taken";
  // Per GitHub's own API docs (not independently reproduced here — doing
  // so would mean deliberately exhausting the real rate limit): the
  // unauthenticated rate limit is reported as 403 with an
  // X-RateLimit-Remaining: 0 header, not 429. Checked explicitly rather
  // than treating every 403 as a rate limit (a 403 can also mean e.g. an
  // abuse-detection block, which retrying identically wouldn't fix any
  // faster) — but the same backoff-then-give-up handling in discovery.ts's
  // generalized checker is a reasonable response to either.
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const err = new Error("github_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  return "unknown";
}
