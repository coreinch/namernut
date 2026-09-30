/**
 * Thin wrapper around 2captcha's Scraper API (https://scraper.2captcha.com),
 * task_type "google_search" — a third search provider (see searchProvider.ts),
 * tried only after serper and serpent both fail and only when
 * TWOCAPTCHA_API_KEY is set (see brandability.ts's searchWithFallback).
 * Verified directly against the live API with a real key (2026-09-30):
 * POST /tasks/sync returns 200 in ~3.7s with
 * { status: "success", groups: { organic: { items: [{ url, title,
 * description, position }] } } }, resolved from a US location. Unlike
 * serper.dev, no "showing results for" / knowledge graph / related-search /
 * people-also-ask field appeared for the query tested, so a result from here
 * carries no SearchContext — brandability.ts falls back to the LLM reading
 * result content, same as for serpent (see serpentSearch.ts).
 */
import type { SearchResponse } from "@/lib/searchProvider";

const ENDPOINT = "https://scraper.2captcha.com/tasks/sync";

export class TwocaptchaApiKeyMissingError extends Error {
  constructor() {
    super("TWOCAPTCHA_API_KEY is not set");
    this.name = "TwocaptchaApiKeyMissingError";
  }
}

interface TwocaptchaResponse {
  status?: string;
  groups?: { organic?: { items?: Array<{ title?: string; description?: string; url?: string }> } };
}

/**
 * `region` is passed as Google's `gl` param, and `hl=en` pins the UI
 * language so results don't come back localized to wherever the service's
 * exit location happens to be.
 */
export async function twocaptchaSearch(
  query: string,
  region: string,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const apiKey = process.env.TWOCAPTCHA_API_KEY;
  if (!apiKey) throw new TwocaptchaApiKeyMissingError();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      task_type: "google_search",
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${encodeURIComponent(region)}&hl=en`,
      data_format: "raw",
      format: "json",
    }),
    signal,
  });

  if (res.status === 429) {
    const err = new Error("twocaptcha_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  if (res.status !== 200) {
    const err = new Error(`twocaptcha_search_failed_${res.status}`);
    err.name = "TwocaptchaSearchError";
    throw err;
  }

  const data = (await res.json()) as TwocaptchaResponse;
  // A 200 with a non-success task status (e.g. Google blocked their fetch)
  // carries no usable results — throwing lets the caller treat it as a
  // provider failure rather than "nothing on the web matches this name".
  if (data.status !== "success") {
    const err = new Error(`twocaptcha_search_failed_${data.status ?? "unknown"}`);
    err.name = "TwocaptchaSearchError";
    throw err;
  }

  const items = data.groups?.organic?.items ?? [];
  return {
    results: items.map((item) => ({
      title: item.title ?? "",
      description: item.description ?? "",
      url: item.url ?? "",
    })),
  };
}
