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
 * whole search.
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
  if (res.status !== 200) return "unknown";

  const html = await res.text();
  return /property="og:title"/.test(html) ? "taken" : "available";
}
