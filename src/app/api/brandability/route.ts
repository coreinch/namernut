import {
  checkBrandability,
  DEFAULT_PROVIDER,
  DEFAULT_REGION,
  PROVIDERS,
  REGIONS,
  type Provider,
  type Region,
} from "@/lib/brandability";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Higher than DISCOVER_RATE_LIMIT in the discover route (10/hour): a single
// discover run with autoCheck on can itself fire one of these per found
// result, up to DEFAULT_RESULT_COUNT (10, fixed — see searchConfig.ts) —
// so a visitor legitimately running a few searches with autoCheck on can
// rack up several times that many of these without doing anything
// abusive. Still bounded, just sized to the real usage pattern rather
// than the discover route's own per-search cost.
const BRANDABILITY_RATE_LIMIT = 100;
const BRANDABILITY_RATE_WINDOW_MS = 60 * 60 * 1000;

/** Falls back to DEFAULT_REGION for anything absent or not in REGIONS,
 * rather than passing an arbitrary string through to the active search
 * provider — REGIONS is the fixed set the region dropdown in Advanced
 * filters (page.tsx) actually offers. */
function parseRegion(raw: string | null): Region {
  return (REGIONS as readonly string[]).includes(raw ?? "") ? (raw as Region) : DEFAULT_REGION;
}

/** Same validate-against-a-fixed-set approach as parseRegion — PROVIDERS is
 * the set the provider dropdown in Advanced filters actually offers. */
function parseProvider(raw: string | null): Provider {
  return (PROVIDERS as readonly string[]).includes(raw ?? "") ? (raw as Provider) : DEFAULT_PROVIDER;
}

/** Same sanitization as parseKeyword in lib/candidates.ts — plain lowercase
 * letters/digits only, so this can't be used to smuggle an arbitrary query
 * into the active search provider (see searchProvider.ts) via the `name`
 * param. */
function parseName(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
  return cleaned.length > 0 ? cleaned : null;
}

/** The two literal strings the candidate was concatenated from — see
 * Candidate.parts in lib/candidates.ts — passed straight through from
 * FoundEntry rather than re-derived here. checkBrandability/validateParts
 * re-checks that they actually concatenate to `name` before using them for
 * anything, so no further sanitization is needed beyond a sane length cap. */
function parseParts(word1: string | null, word2: string | null): [string, string] | undefined {
  if (!word1 || !word2) return undefined;
  return [word1.slice(0, 30), word2.slice(0, 30)];
}

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(
    `brandability:${getClientIp(request)}`,
    BRANDABILITY_RATE_LIMIT,
    BRANDABILITY_RATE_WINDOW_MS
  );
  if (!rateLimit.ok) {
    return Response.json(
      { error: "Too many brandability checks — try again in a bit." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const name = parseName(searchParams.get("name"));
  const parts = parseParts(searchParams.get("word1"), searchParams.get("word2"));
  const region = parseRegion(searchParams.get("region"));
  const provider = parseProvider(searchParams.get("provider"));
  if (!name) {
    return Response.json({ error: "Missing or invalid 'name' query param" }, { status: 400 });
  }

  try {
    const result = await checkBrandability(name, parts, request.signal, region, provider);
    return Response.json(result);
  } catch (err) {
    if (err instanceof Error && err.name === "SerperApiKeyMissingError") {
      return Response.json(
        { error: "SERPER_API_KEY is not configured on the server (see .env.local)" },
        { status: 503 }
      );
    }
    if (err instanceof Error && err.name === "SerpentApiKeyMissingError") {
      return Response.json(
        { error: "SERPENT_API_KEY is not configured on the server (see .env.local)" },
        { status: 503 }
      );
    }
    if (err instanceof Error && err.name === "SerpentInsufficientCreditsError") {
      return Response.json({ error: err.message }, { status: 402 });
    }
    if (err instanceof Error && err.name === "KilocodeApiKeyMissingError") {
      return Response.json(
        { error: "KILOCODE_API_KEY is not configured on the server (see .env.local)" },
        { status: 503 }
      );
    }
    if (err instanceof Error && err.name === "RateLimitError") {
      // Shared name across serperSearch.ts, serpentSearch.ts, and
      // kilocode.ts (see src/lib/rdap.ts, instagram.ts for the same
      // convention) — the message each one sets identifies which service
      // actually hit its limit, so the response doesn't misattribute it.
      const service =
        err.message === "kilocode_rate_limited"
          ? "Kilo Gateway"
          : err.message === "serpent_rate_limited"
            ? "apiserpent.com"
            : "Serper.dev";
      return Response.json({ error: `${service} rate limit hit — try again shortly.` }, { status: 429 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Brandability check failed" },
      { status: 500 }
    );
  }
}
