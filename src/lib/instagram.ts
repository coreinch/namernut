/**
 * Checks Instagram username availability by fetching the public profile
 * page and looking for its Open Graph metadata (og:title, with follower/
 * post counts in og:description). Instagram serves that server-rendered
 * metadata to any non-browser HTTP client — the same mechanism link-preview
 * bots (Slack, iMessage, Discord, Twitter) rely on to render a preview
 * without logging in — and reserves the full client-rendered app (which
 * requires a login to show anything) for requests that look like an actual
 * browser. An existing profile's page includes the metadata; a free
 * username's page doesn't.
 *
 * This isn't a documented API — it's undocumented HTML structure that can
 * change without notice — so, like the domain checks in rdap.ts/whois.ts,
 * anything inconclusive resolves to "unknown" rather than failing the
 * whole search. It did in fact change: Instagram started redirecting every
 * unauthenticated profile request to its login page, which itself carries
 * a generic og:title — misread as "taken" for every username without the
 * check below. See LoginWallError.
 *
 * If INSTAGRAM_SESSION_ID is set (a real account's `sessionid` cookie
 * value, from .env.local — never committed, see .gitignore), requests are
 * sent authenticated as that account, which avoids the login-wall redirect
 * entirely. That's a live session credential for a real account, and this
 * search does a rapid-fire lookup per candidate — running it authenticated
 * risks that account being flagged or challenged by Instagram's automated-
 * behavior detection, which anonymous requests (just an inconclusive login
 * page) don't risk. Falls back to the unauthenticated path when unset.
 *
 * If PROXY_URL is set (e.g. http://user:pass@host:port, a
 * residential proxy — never committed), the request goes through it. The
 * login wall is IP-based, not username- or User-Agent-based: from the
 * production VPS's datacenter IP every profile, taken or free, redirects to
 * the login page, while the identical request through a residential IP
 * returns the real profile (tested 2026-09-29). The User-Agent stays
 * honest either way. Residential proxies typically bill per GB and each
 * check downloads a full profile page, so this is meant to be paired with
 * the check staying off by default.
 *
 * If INSTAGRAM_TWOCAPTCHA=1 and TWOCAPTCHA_API_KEY are set, the profile page
 * is fetched through 2captcha's Scraper API (task_type "scrape") and read
 * with the same og:title rule. Each scrape exits from a different IP and
 * only some get the real profile page rather than the login wall (tested
 * 2026-09-30: ~1 in 3 for the same username), so a login page is rechecked
 * up to TWOCAPTCHA_LOGIN_WALL_ATTEMPTS times before throwing LoginWallError.
 * Opt-in because each attempt is a metered ~500KB scrape (~4.5s).
 */
import { fetchMaybeProxied, SOCIAL_CHECK_USER_AGENT, throwRateLimited } from "@/lib/socialStatus";

export type InstagramStatus = "available" | "taken" | "unknown";

// Each scrape may exit from a different IP, so a login-wall page on one
// attempt doesn't mean the next will get one too — recheck before giving up.
const TWOCAPTCHA_LOGIN_WALL_ATTEMPTS = 5;

async function checkViaTwocaptcha(username: string, signal?: AbortSignal): Promise<InstagramStatus> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://scraper.2captcha.com/tasks/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TWOCAPTCHA_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        task_type: "scrape",
        url: `https://www.instagram.com/${encodeURIComponent(username)}/`,
        data_format: "raw",
        format: "raw",
      }),
      signal,
    });
    if (res.status === 429) throwRateLimited("instagram_rate_limited");
    if (res.status !== 200) return "unknown";
    const html = await res.text();
    // The login page's alternate links point at /accounts/login/ and it
    // carries a generic og:title, so check for it before reading og:title.
    if (!html.includes("/accounts/login/")) return /property="og:title"/.test(html) ? "taken" : "available";
    if (attempt >= TWOCAPTCHA_LOGIN_WALL_ATTEMPTS) {
      const err = new Error("instagram_login_wall");
      err.name = "LoginWallError";
      throw err;
    }
  }
}

export async function checkInstagramUsername(
  username: string,
  signal?: AbortSignal
): Promise<InstagramStatus> {
  if (process.env.INSTAGRAM_TWOCAPTCHA === "1" && process.env.TWOCAPTCHA_API_KEY) {
    return checkViaTwocaptcha(username, signal);
  }
  const headers: Record<string, string> = { "User-Agent": SOCIAL_CHECK_USER_AGENT, Accept: "text/html" };
  if (process.env.INSTAGRAM_SESSION_ID) {
    headers["Cookie"] = `sessionid=${process.env.INSTAGRAM_SESSION_ID}`;
  }

  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const res = await fetchMaybeProxied(url, { headers }, signal);

  if (res.status === 429) throwRateLimited("instagram_rate_limited");

  // fetch() follows redirects by default — res.url is the final URL, not
  // the one requested. Instagram now sends every unauthenticated profile
  // request here regardless of username; its login page has its own
  // generic og:title (content "Instagram"), which the naive check below
  // would misread as "taken" every single time. Thrown distinctly (not
  // just returned as "unknown") so callers can tell "this one check was
  // inconclusive" apart from "the whole mechanism looks structurally
  // blocked right now" — see discovery.ts, which stops gating results on
  // Instagram availability once this happens repeatedly in one search.
  if (res.url.includes("/accounts/login/")) {
    const err = new Error("instagram_login_wall");
    err.name = "LoginWallError";
    throw err;
  }
  if (res.status !== 200) return "unknown";

  const html = await res.text();
  return /property="og:title"/.test(html) ? "taken" : "available";
}
