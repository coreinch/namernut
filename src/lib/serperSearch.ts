/**
 * Thin wrapper around Serper.dev's Google Search API, used by collision.ts to
 * see what a candidate name actually resolves to in the wild — domain and
 * Instagram availability alone (see whois.ts, rdap.ts, instagram.ts) say
 * nothing about whether the name already means something (an existing
 * brand, product, public figure, or common word) that a fresh registrant
 * would be competing with or mistaken for.
 */
export interface SerperResult {
  title: string;
  description: string;
  url: string;
}

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

export async function serperSearch(query: string, signal?: AbortSignal): Promise<SerperResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new SerperApiKeyMissingError();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query }),
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
