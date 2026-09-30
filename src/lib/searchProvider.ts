import { serperSearch } from "@/lib/serperSearch";
import { serpentSearch } from "@/lib/serpentSearch";
import { twocaptchaSearch } from "@/lib/twocaptchaSearch";

/**
 * Shared result shape for every search provider (see serperSearch.ts,
 * serpentSearch.ts) — defined once here, rather than per-provider file, so
 * brandability.ts and any future provider never need to know which one is
 * actually running.
 */
export interface SearchResult {
  title: string;
  description: string;
  url: string;
}

/**
 * Extra Google signals some providers return alongside the organic results —
 * all optional, since not every provider has them (see serperSearch.ts,
 * which does; apiserpent.com returned none of these when checked).
 */
export interface SearchContext {
  /** Google's "Showing results for X" — present when it silently replaced
   * the query with a different term. The one direct, programmatic signal
   * of the query-override behavior brandability.ts's prompt asks the LLM to
   * look for (confirmed live: "fondterm" -> "findterm"). */
  showingResultsFor?: string;
  /** Google's own "Knowledge Graph" card — present when the query is a
   * known entity (brand, person, place). */
  knowledgeGraph?: { title?: string; type?: string; description?: string };
  relatedSearches?: string[];
  peopleAlsoAsk?: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  context?: SearchContext;
}

type SearchFn = (query: string, region: string, signal?: AbortSignal) => Promise<SearchResponse>;

const PROVIDERS: Record<string, SearchFn> = {
  serper: serperSearch,
  serpent: serpentSearch,
  twocaptcha: twocaptchaSearch,
};

/**
 * Picks which Google-results API brandability.ts searches against — either
 * "serper" (https://serper.dev) or "serpent" (https://apiserpent.com, a
 * multi-engine SERP API restricted here to its Google engine).
 * `providerOverride` selects which one to use — brandability.ts's
 * searchWithFallback is the only caller, and it always passes one: it
 * tries PRIMARY_PROVIDER ("serper") first and falls back to
 * FALLBACK_PROVIDER ("serpent") once on failure, rather than this being a
 * user- or operator-settable choice (there used to be a SEARCH_PROVIDER
 * env var for that; removed as dead config once searchWithFallback started
 * always passing an explicit override — see brandability.ts). The two have
 * very different operating profiles, confirmed directly: Serper is fast
 * with a high concurrency limit and a 2,500/month free quota, which is
 * what makes automatic per-result checking viable at all; apiserpent.com
 * is slower and its concurrency limit is tied to account balance (see
 * https://apiserpent.com/faq) — but it's the one that's actually
 * demonstrated reproducing Google's real silent query-override behavior in
 * testing, which Serper never has (see serperSearch.ts's docstring).
 * A third, "twocaptcha" (twocaptchaSearch.ts: 2captcha's Scraper API, ~4s),
 * is opt-in via TWOCAPTCHA_API_KEY and, when set, the DEFAULT — tried
 * first in searchWithFallback, with serper and serpent as its fallbacks.
 * Neither one is strictly better — that's the whole reason
 * searchWithFallback tries both rather than picking one fixed provider.
 */
export function search(
  query: string,
  region: string,
  signal?: AbortSignal,
  providerOverride: string = "serper"
): Promise<SearchResponse> {
  const provider = PROVIDERS[providerOverride];
  if (!provider) {
    throw new Error(`Unknown search provider "${providerOverride}" — expected "serper", "serpent" or "twocaptcha"`);
  }
  return provider(query, region, signal);
}
