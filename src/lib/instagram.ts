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
 */
export type InstagramStatus = "available" | "taken" | "unknown";

// Honestly identifies this tool as itself, not as a browser or as any
// other service's crawler (e.g. Googlebot) — it doesn't need to claim to
// be one to get the server-rendered response; see the module doc above.
const USER_AGENT = "Mozilla/5.0 (compatible; DomainFinderBot/1.0)";

export async function checkInstagramUsername(
  username: string,
  signal?: AbortSignal
): Promise<InstagramStatus> {
  const res = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal,
  });

  if (res.status === 429) {
    const err = new Error("rate_limited");
    err.name = "RateLimitError";
    throw err;
  }

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
