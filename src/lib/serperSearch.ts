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

/**
 * `region` is a required, explicit ISO country code (Serper's `gl` param) —
 * never left to Serper's own default. Google's results (including whether
 * it silently overrides an unusual query with a different, existing term —
 * see the override-detection rubric bullet in brandability.ts's buildPrompt)
 * vary by region; brandability.ts checks a single, user-selected region per
 * request (see the REGIONS comment there for why it isn't checked
 * concurrently across regions). Note Serper specifically didn't reliably
 * reproduce the override behavior at all in testing — confirmed directly
 * across 10 different `gl` values for "fondterm" (including retrying the
 * same one), none consistently showed the real override to "Finterm" that
 * apiserpent.com's country=gr did — so switching regions on Serper may have
 * limited value; see serpentSearch.ts for the provider that's actually
 * demonstrated this.
 */
export async function serperSearch(
  query: string,
  region: string,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new SerperApiKeyMissingError();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, gl: region }),
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
