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

type SearchFn = (query: string, signal?: AbortSignal) => Promise<SearchResult[]>;

const PROVIDERS: Record<string, SearchFn> = {
  serper: serperSearch,
  serpent: serpentSearch,
};

/**
 * Picks which Google-results API collision.ts searches against, via
 * SEARCH_PROVIDER — "serper" (default, https://serper.dev) or "serpent"
 * (https://apiserpent.com, a multi-engine SERP API restricted here to its
 * Google engine). Defaults to "serper" so nothing changes for existing
 * deployments unless the env var is set.
 */
export function search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const name = process.env.SEARCH_PROVIDER || "serper";
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown SEARCH_PROVIDER "${name}" — expected "serper" or "serpent"`);
  }
  return provider(query, signal);
}
