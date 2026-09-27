import { checkTwitterHandle } from "@/lib/twitter";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// This check has no metered cost of its own (a single unauthenticated fetch
// to x.com, not a paid API or LLM call — contrast BRANDABILITY_RATE_LIMIT in
// the brandability route), but it's the same checkTwitterHandle every
// discover run already shares — an IP that gets itself rate-limited or
// flagged by X's bot detection here degrades that shared check for
// everyone, not just this endpoint's caller. Sized well above normal
// on-demand use (checking a handful of handles by hand) while still well
// under anything that would look like scraping.
const TWITTER_RATE_LIMIT = 30;
const TWITTER_RATE_WINDOW_MS = 60 * 60 * 1000;

// Real X handles are 1-15 characters, letters/digits/underscore only —
// unlike parseName in the brandability route (which sanitizes a candidate
// *name*, i.e. domain-safe lowercase letters/digits), this preserves case
// and allows underscores since those are both legal and meaningful in an
// actual handle.
function parseHandle(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
  return cleaned.length > 0 ? cleaned : null;
}

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(`twitter:${getClientIp(request)}`, TWITTER_RATE_LIMIT, TWITTER_RATE_WINDOW_MS);
  if (!rateLimit.ok) {
    return Response.json(
      { error: "Too many X/Twitter checks — try again in a bit." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const handle = parseHandle(searchParams.get("handle"));
  if (!handle) {
    return Response.json({ error: "Missing or invalid 'handle' query param" }, { status: 400 });
  }

  try {
    const status = await checkTwitterHandle(handle, request.signal);
    return Response.json({ handle, status });
  } catch (err) {
    if (err instanceof Error && err.name === "RateLimitError") {
      return Response.json({ error: "x.com rate limit hit — try again shortly." }, { status: 429 });
    }
    // AbortSignal.timeout() inside checkTwitterHandle (see FETCH_TIMEOUT_MS
    // in twitter.ts) rejects with a DOMException whose .name is
    // "TimeoutError" and whose .message is a raw, implementation-specific
    // string — not something written for an end user. Same convention as
    // the brandability route's own timeout mapping.
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return Response.json({ error: "X/Twitter check timed out — try again." }, { status: 504 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "X/Twitter check failed" },
      { status: 500 }
    );
  }
}
