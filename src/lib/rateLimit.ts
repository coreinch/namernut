// Fixed-window per-IP rate limiting for the two routes that spend metered
// API calls (Serper/apiserpent.com search, Kilocode LLM) on every request —
// /api/discover and /api/brandability. In-memory rather than Redis-backed:
// this app runs as a single long-lived container on one VPS (see
// ansible/templates/docker-compose.prod.yml.j2 — one replica), so there's
// no multi-instance state to reconcile, and losing the counters on a
// restart/deploy is an acceptable, rare cost reset rather than a
// correctness bug.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Runs on every check rather than on a timer — this module has no
// lifecycle hook to hang a setInterval off safely across Next.js's dev
// hot-reload, and the map only grows by one entry per distinct IP per
// window, so an occasional O(n) sweep is cheap.
function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the caller may retry — only meaningful when !ok. */
  retryAfterSeconds: number;
}

/** `key` should already be namespaced per route (e.g. `discover:1.2.3.4`) —
 * this function does no namespacing of its own, so two routes sharing a raw
 * IP as the key would incorrectly share one budget. */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (buckets.size > 5000) sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

/** Cloudflare sits in front of this app in production (see
 * ansible/templates/custom-domain.conf.j2) and sets CF-Connecting-IP to the
 * real visitor IP on every request, overwriting any copy of that header a
 * client tries to send itself — so it's checked first and trusted.
 * X-Forwarded-For is NOT trusted the same way: nginx only appends to it
 * (`$proxy_add_x_forwarded_for`) rather than replacing it, so a client that
 * sends its own X-Forwarded-For before ever reaching Cloudflare can plant
 * an arbitrary "first" entry — good enough as a fallback for local/non-CF
 * setups (e.g. `npm run dev` with nothing in front), but not a source of
 * truth once Cloudflare is in the path. */
export function getClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp;
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}
