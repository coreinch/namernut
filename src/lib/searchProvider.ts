import { serperSearch } from "@/lib/serperSearch";
import { serpentSearch } from "@/lib/serpentSearch";

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

type SearchFn = (query: string, region: string, signal?: AbortSignal) => Promise<SearchResult[]>;

const PROVIDERS: Record<string, SearchFn> = {
  serper: serperSearch,
  serpent: serpentSearch,
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
 * Neither one is strictly better — that's the whole reason
 * searchWithFallback tries both rather than picking one fixed provider.
 */
export function search(
  query: string,
  region: string,
  signal?: AbortSignal,
  providerOverride: string = "serper"
): Promise<SearchResult[]> {
  const provider = PROVIDERS[providerOverride];
  if (!provider) {
    throw new Error(`Unknown search provider "${providerOverride}" — expected "serper" or "serpent"`);
  }
  return provider(query, region, signal);
}
