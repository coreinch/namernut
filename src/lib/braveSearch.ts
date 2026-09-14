/**
 * Thin wrapper around Brave's Web Search API, used by collision.ts to see
 * what a candidate name actually resolves to in the wild — domain and
 * Instagram availability alone (see whois.ts, rdap.ts, instagram.ts) say
 * nothing about whether the name already means something (an existing
 * brand, product, public figure, or common word) that a fresh registrant
 * would be competing with or mistaken for.
 */
export interface BraveResult {
  title: string;
  description: string;
  url: string;
}

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export class BraveApiKeyMissingError extends Error {
  constructor() {
    super("BRAVE_API_KEY is not set");
    this.name = "BraveApiKeyMissingError";
  }
}

interface BraveApiResponse {
  web?: {
    results?: Array<{ title?: string; description?: string; url?: string }>;
  };
}

export async function braveSearch(query: string, signal?: AbortSignal): Promise<BraveResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) throw new BraveApiKeyMissingError();

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");

  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    signal,
  });

  if (res.status === 429) {
    const err = new Error("brave_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  if (res.status !== 200) {
    const err = new Error(`brave_search_failed_${res.status}`);
    err.name = "BraveSearchError";
    throw err;
  }

  const data = (await res.json()) as BraveApiResponse;
  const items = data.web?.results ?? [];
  return items.map((item) => ({
    title: item.title ?? "",
    description: item.description ?? "",
    url: item.url ?? "",
  }));
}
