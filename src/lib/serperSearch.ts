/**
 * Thin wrapper around Serper.dev's Google Search API — the default search
 * provider (see searchProvider.ts) used to see what a candidate name
 * actually resolves to in the wild. Domain and Instagram availability alone
 * (see whois.ts, rdap.ts, instagram.ts) say nothing about whether the name
 * already means something (an existing brand, product, public figure, or
 * common word) that a fresh registrant would be competing with or mistaken
 * for.
 */
import type { SearchResult } from "@/lib/searchProvider";

const ENDPOINT = "https://google.serper.dev/search";

export class SerperApiKeyMissingError extends Error {
  constructor() {
    super("SERPER_API_KEY is not set");
    this.name = "SerperApiKeyMissingError";
  }
}

interface SerperApiResponse {
  organic?: Array<{ title?: string; snippet?: string; link?: string }>;
}

export async function serperSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new SerperApiKeyMissingError();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    // Pinned to a fixed region rather than left to Serper's own default:
    // Google's results (including whether it silently overrides an unusual
    // query with a different, existing term — see the override-detection
    // rubric bullet in collision.ts's buildPrompt) vary by region, so an
    // unset region makes results non-reproducible and can miss a real
    // collision that only shows up elsewhere (confirmed directly: "fondterm"
    // returned generic results with no gl set, but silently overrode to a
    // real brand, "Finterm", under gl=gr). "us" doesn't close that gap, just
    // makes it a known, fixed one instead of an undocumented moving target.
    body: JSON.stringify({ q: query, gl: "us" }),
    signal,
  });

  if (res.status === 429) {
    const err = new Error("serper_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  if (res.status !== 200) {
    const err = new Error(`serper_search_failed_${res.status}`);
    err.name = "SerperSearchError";
    throw err;
  }

  const data = (await res.json()) as SerperApiResponse;
  const items = data.organic ?? [];
  return items.map((item) => ({
    title: item.title ?? "",
    description: item.snippet ?? "",
    url: item.link ?? "",
  }));
}
