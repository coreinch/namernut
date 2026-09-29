/**
 * A tiny in-memory TTL cache with a size cap and in-flight de-duplication,
 * used to remember availability lookups (domain RDAP/whois, social handles)
 * across searches on this server process. Repeated or overlapping searches
 * re-check many of the same names; this keeps that from hitting every
 * upstream (and its rate limit) again.
 *
 * Only conclusive results should be stored — see `getOrCompute`'s
 * `shouldCache`. Per-process only (like lib/rateLimit.ts): each server
 * instance has its own copy, which is fine for a best-effort optimization.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  private inFlight = new Map<string, Promise<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries: number
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    // Re-insert so Map iteration order stays oldest-first for eviction.
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Returns the cached value, or runs `compute` once (concurrent callers for
   * the same key share that single promise) and stores its result when
   * `shouldCache` says it was conclusive. A rejected compute is never cached
   * and propagates to every waiting caller.
   */
  async getOrCompute(
    key: string,
    compute: () => Promise<T>,
    shouldCache: (value: T) => boolean = () => true
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const promise = compute()
      .then((value) => {
        if (shouldCache(value)) this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }
}
