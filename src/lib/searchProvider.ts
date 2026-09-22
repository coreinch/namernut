import { serperSearch } from "@/lib/serperSearch";
import { serpentSearch } from "@/lib/serpentSearch";

/**
 * Shared result shape for every search provider (see serperSearch.ts,
 * serpentSearch.ts) — defined once here, rather than per-provider file, so
 * collision.ts and any future provider never need to know which one is
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
 * Picks which Google-results API collision.ts searches against, via
 * SEARCH_PROVIDER — "serper" (code default, https://serper.dev) or
 * "serpent" (https://apiserpent.com, a multi-engine SERP API restricted
 * here to its Google engine). The code defaults to "serper" so nothing
 * changes for a deployment that never sets the env var, but as of this
 * writing the active deployment sets SEARCH_PROVIDER=serpent: testing
 * showed apiserpent.com is the only one of the two that's actually
 * reproduced Google's real silent query-override behavior (see
 * serperSearch.ts's docstring), which is exactly what REGIONS in
 * collision.ts checks for.
 */
export function search(query: string, region: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const name = process.env.SEARCH_PROVIDER || "serper";
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown SEARCH_PROVIDER "${name}" — expected "serper" or "serpent"`);
  }
  return provider(query, region, signal);
}
