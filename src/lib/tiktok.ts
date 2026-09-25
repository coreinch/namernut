/**
 * Checks TikTok username availability by fetching the public profile page
 * and looking for that account's data embedded in the page's server-
 * rendered hydration state. Confirmed directly (2026-09-25): a real
 * account's HTML contains a `"uniqueId":"<username>"` field (case-matched
 * to what was requested); a free username's page doesn't, even though both
 * pages otherwise contain the exact same generic "Couldn't find this
 * account" boilerplate text (part of a client-side error-state template
 * baked into every page's initial bundle regardless of whether it's
 * actually shown) — so that boilerplate text is NOT a usable signal on its
 * own, unlike a naive "page contains an error message" check might assume.
 *
 * Like instagram.ts, this is undocumented HTML structure, not a real API —
 * it can change without notice, so anything inconclusive resolves to
 * "unknown" rather than failing the whole search.
 */
import type { SocialStatus } from "@/lib/socialStatus";

const USER_AGENT = "Mozilla/5.0 (compatible; DomainFinderBot/1.0)";

export async function checkTiktokUsername(username: string, signal?: AbortSignal): Promise<SocialStatus> {
  const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal,
  });

  if (res.status === 429) {
    const err = new Error("tiktok_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  if (res.status !== 200) return "unknown";

  const html = await res.text();
  // Escaped defensively even though a validated username (letters/digits
  // only, enforced by the same sanitization every candidate name already
  // goes through before reaching here) can't itself contain regex
  // metacharacters — cheap insurance against this function ever being
  // called with something less sanitized in the future.
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`"uniqueId":"${escaped}"`, "i").test(html) ? "taken" : "available";
}
