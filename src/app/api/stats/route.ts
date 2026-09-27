import { parseKeyword } from "@/lib/candidates";
import { getDictionaryStats, parseLangs, parseMaxLength } from "@/lib/dictionary";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

// Unlike /api/discover and /api/brandability (rate-limited to bound metered
// third-party API/LLM spend), this route only computes over the in-memory
// dictionary — no external cost, just CPU. The limit exists purely to bound
// abusive request volume, not normal use: the frontend debounces its own
// calls to one per 250ms of typing (see page.tsx), so this leaves generous
// headroom above that.
const STATS_RATE_LIMIT = 120;
const STATS_RATE_WINDOW_MS = 60 * 1000;

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(`stats:${getClientIp(request)}`, STATS_RATE_LIMIT, STATS_RATE_WINDOW_MS);
  if (!rateLimit.ok) {
    return Response.json(
      { error: "Too many requests — try again in a bit." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const langs = parseLangs(searchParams.get("langs"));
  const maxLength = parseMaxLength(searchParams.get("maxLength"));
  const keyword = parseKeyword(searchParams.get("keyword"));
  try {
    return Response.json(getDictionaryStats(langs, maxLength, keyword));
  } catch (err) {
    // Matches the {error: "..."} JSON contract every other route returns —
    // without this, an unexpected throw here falls through to Next's raw
    // HTML error page, which the frontend isn't prepared to parse.
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to compute dictionary stats" },
      { status: 500 }
    );
  }
}
