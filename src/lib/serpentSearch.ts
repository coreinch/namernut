/**
 * Thin wrapper around apiserpent.com's SERP API, restricted here to its
 * Google engine — an alternative to serperSearch.ts, selected via
 * SEARCH_PROVIDER (see searchProvider.ts). Verified directly against the
 * live API (not just its docs) with a real key: GET /api/search returns
 * results.organic[] with title/url/snippet/position, matching the shape
 * documented at https://apiserpent.com/docs. No spelling-correction/"did
 * you mean" field anywhere in the response (checked with a deliberately
 * misspelled query) — same blind spot as Serper.dev, which is why
 * brandability.ts relies on the LLM reading result content instead (see the
 * override-detection rubric bullet in buildPrompt).
 */
import type { SearchResult } from "@/lib/searchProvider";

const ENDPOINT = "https://apiserpent.com/api/search";

export class SerpentApiKeyMissingError extends Error {
  constructor() {
    super("SERPENT_API_KEY is not set");
    this.name = "SerpentApiKeyMissingError";
  }
}

/** apiserpent.com returns 402 with code "insufficient_credits" once the
 * account balance hits zero (default tier is pay-as-you-go, no auto
 * top-up) — confirmed directly by exhausting a real account's free trial
 * credits during testing. Distinct from SerpentSearchError so the route can
 * give an actionable message instead of a generic failure. */
export class SerpentInsufficientCreditsError extends Error {
  constructor() {
    super("apiserpent.com account has insufficient credits — add funds at https://apiserpent.com");
    this.name = "SerpentInsufficientCreditsError";
  }
}

interface SerpentApiResponse {
  results?: {
    organic?: Array<{ title?: string; snippet?: string; url?: string }>;
  };
}

/**
 * `region` is a required, explicit ISO country code — never left to
 * apiserpent's own default; see the matching comment in serperSearch.ts.
 * brandability.ts checks several in parallel (see REGIONS there): confirmed
 * directly that "fondterm" returned generic results under country=us, but
 * silently overrode to a real brand, "Finterm", under country=gr — a real
 * override can trigger in one region and not another for the same query.
 */
export async function serpentSearch(
  query: string,
  region: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPENT_API_KEY;
  if (!apiKey) throw new SerpentApiKeyMissingError();

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("engine", "google");
  url.searchParams.set("country", region);

  const res = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    signal,
  });

  if (res.status === 402) {
    throw new SerpentInsufficientCreditsError();
  }
  // apiserpent.com's docs don't spell out a rate-limit status code, so this
  // follows the same 429 convention as every other provider in this
  // codebase (see serperSearch.ts, kilocode.ts, rdap.ts, instagram.ts).
  if (res.status === 429) {
    const err = new Error("serpent_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  if (res.status !== 200) {
    const err = new Error(`serpent_search_failed_${res.status}`);
    err.name = "SerpentSearchError";
    throw err;
  }

  const data = (await res.json()) as SerpentApiResponse;
  const items = data.results?.organic ?? [];
  return items.map((item) => ({
    title: item.title ?? "",
    description: item.snippet ?? "",
    url: item.url ?? "",
  }));
}
