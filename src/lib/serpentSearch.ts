/**
 * Thin wrapper around apiserpent.com's SERP API, restricted here to its
 * Google engine — an alternative to serperSearch.ts, selected via
 * SEARCH_PROVIDER (see searchProvider.ts). Verified directly against the
 * live API (not just its docs) with a real key: GET /api/search returns
 * results.organic[] with title/url/snippet/position, matching the shape
 * documented at https://apiserpent.com/docs. No spelling-correction/"did
 * you mean" field anywhere in the response (checked with a deliberately
 * misspelled query) — same blind spot as Serper.dev, which is why
 * collision.ts relies on the LLM reading result content instead (see the
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

interface SerpentApiResponse {
  results?: {
    organic?: Array<{ title?: string; snippet?: string; url?: string }>;
  };
}

export async function serpentSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = process.env.SERPENT_API_KEY;
  if (!apiKey) throw new SerpentApiKeyMissingError();

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("engine", "google");
  // Pinned deliberately, not just apiserpent's default — see the matching
  // comment in serperSearch.ts. Confirmed directly: "fondterm" returned
  // generic results with country=us, but silently overrode to a real brand,
  // "Finterm", under country=gr. Pinning to "us" doesn't close that gap,
  // just makes it a known, fixed one instead of an undocumented moving
  // target — both providers now use the same region for the same query.
  url.searchParams.set("country", "us");

  const res = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    signal,
  });

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
