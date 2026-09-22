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
 * `providerOverride`, when given, wins outright — this is how a per-request
 * choice (the provider dropdown in FiltersPanel.tsx, threaded through
 * route.ts and checkBrandability) picks a provider without redeploying.
 * Falls back to the SEARCH_PROVIDER env var, then to "serper", for any
 * caller that doesn't pass one (e.g. a direct API call with no `provider`
 * param). The two have very different operating profiles, confirmed
 * directly: Serper is fast with a high concurrency limit and a 2,500/month
 * free quota, which is what makes automatic per-result checking viable at
 * all; apiserpent.com is slower and its concurrency limit is tied to
 * account balance (see https://apiserpent.com/faq) — but it's the one
 * that's actually demonstrated reproducing Google's real silent
 * query-override behavior in testing, which Serper never has (see
 * serperSearch.ts's docstring). Neither one is strictly better — that's the
 * whole reason this is switchable per request rather than a fixed choice.
 */
export function search(
  query: string,
  region: string,
  signal?: AbortSignal,
  providerOverride?: string
): Promise<SearchResult[]> {
  const name = providerOverride || process.env.SEARCH_PROVIDER || "serper";
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown SEARCH_PROVIDER "${name}" — expected "serper" or "serpent"`);
  }
  return provider(query, region, signal);
}
