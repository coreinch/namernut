import { checkDomain } from "@/lib/rdap";
import { checkDomainWhois } from "@/lib/whois";
import { checkInstagramUsername } from "@/lib/instagram";
import { checkGithubUsername } from "@/lib/github";
import { checkTiktokUsername } from "@/lib/tiktok";
import { checkNpmPackageName } from "@/lib/npm";
import { checkYoutubeHandle } from "@/lib/youtube";
import { checkTwitterHandle } from "@/lib/twitter";
import type { SocialStatus } from "@/lib/socialStatus";
import type { DiscoveryEvent, DiscoveryGates } from "@/lib/discoveryTypes";
import { TtlCache } from "@/lib/ttlCache";

export const CHECK_DELAY_MS = 350;
const RATE_LIMIT_BACKOFF_MS = 5000;
const MAX_TRANSIENT_RETRIES = 3;

// Conclusive availability results are remembered across searches (see
// lib/ttlCache.ts): the same names get re-checked constantly between
// overlapping or repeated searches, and each re-check spends an RDAP/whois
// or social-platform request against a limit. Ten minutes keeps a freshly
// registered or claimed name from looking available for long. "unknown",
// "blocked", and "aborted" outcomes are never cached — they say nothing
// about the name itself.
const AVAILABILITY_CACHE_TTL_MS = 10 * 60 * 1000;
const AVAILABILITY_CACHE_MAX_ENTRIES = 20000;
const domainCache = new TtlCache<"available" | "taken" | "unknown" | "aborted">(
  AVAILABILITY_CACHE_TTL_MS,
  AVAILABILITY_CACHE_MAX_ENTRIES
);
const socialCache = new TtlCache<SocialStatus | "blocked" | "aborted">(
  AVAILABILITY_CACHE_TTL_MS,
  AVAILABILITY_CACHE_MAX_ENTRIES
);
const isConclusive = (v: string) => v === "available" || v === "taken";

/** Drops every remembered availability result (used by tests). */
export function clearAvailabilityCaches() {
  domainCache.clear();
  socialCache.clear();
}

/** True when checkOne(name, tld) would be answered from cache, with no request. */
export function isDomainCached(name: string, tld: string) {
  return domainCache.get(`${name}.${tld}`) !== undefined;
}

export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

async function checkOneUncached(name: string, tld: string, signal: AbortSignal, onEvent: (event: DiscoveryEvent) => void) {
  let status: "available" | "taken" | "unknown" = "unknown";
  let attempt = 0;
  for (;;) {
    if (signal.aborted) return "aborted" as const;
    try {
      status = await checkDomain(name, tld, signal);
      break;
    } catch (err) {
      if (signal.aborted) return "aborted" as const;
      if (err instanceof Error && err.name === "RateLimitError") {
        onEvent({ type: "error", message: "RDAP rate limited, falling back to whois..." });
        status = await checkDomainWhois(name, tld);
        if (status !== "unknown") break;
        // whois can't help for every TLD (e.g. .dev/.app have no whois
        // server at all) — count this against the same retry cap so
        // persistent rate-limiting eventually gives up instead of backing
        // off forever.
        attempt++;
        if (attempt >= MAX_TRANSIENT_RETRIES) {
          status = "unknown";
          break;
        }
        await delay(RATE_LIMIT_BACKOFF_MS, signal);
        continue;
      }
      attempt++;
      if (attempt >= MAX_TRANSIENT_RETRIES) {
        status = "unknown";
        break;
      }
      await delay(1000, signal);
    }
  }

  if (signal.aborted) return "aborted" as const;

  // RDAP was inconclusive (down, errored out, or returned a non-200/404
  // status, or the TLD isn't in the bootstrap registry) — fall back to whois.
  if (status === "unknown") {
    status = await checkDomainWhois(name, tld);
  }
  return status;
}

/**
 * One entry per social platform runDiscovery can require a result's
 * handle be available on — see DiscoveryGates and checkSocialOne/worker
 * below. Each platform's own lib module (instagram.ts, github.ts,
 * tiktok.ts) knows nothing about the others; this is the one place that
 * treats them as an interchangeable list, which is what lets the worker
 * loop check all of them with one generic path (checkSocialOne/
 * checkPlatformGroup) instead of a separate copy of the same
 * concurrency-sensitive logic per platform. Split below into two groups —
 * EAGER_PLATFORMS and DEFERRED_PLATFORMS — rather than one flat list,
 * since they're checked in two separate phases (see the pendingAvailable
 * loop in worker()). The split is by which platforms have actually been
 * observed hitting a real rate limit in practice, not by "documented API
 * vs. scraping" or "dev tool vs. social platform" — see the two groups'
 * own doc comments below for specifics. A 100-request-in-a-row burst
 * against each platform (2026-09-27) settled this empirically: GitHub hit
 * its documented cap exactly on schedule (403 starting at request #61 of
 * 100), while npm, Instagram (with INSTAGRAM_SESSION_ID configured),
 * TikTok, YouTube, and X all came back clean with zero rate-limit
 * responses — including two (YouTube, X) that had been deferred on a mere
 * suspicion before that test ran.
 */
export interface SocialPlatform {
  key: "instagram" | "github" | "tiktok" | "npm" | "youtube" | "twitter";
  /** Used in user-facing log/error messages — see checkSocialOne and the
   * "structurally blocked" breaker below. */
  label: string;
  gate: keyof Pick<
    DiscoveryGates,
    "requireInstagram" | "requireGithub" | "requireTiktok" | "requireNpm" | "requireYoutube" | "requireTwitter"
  >;
  check: (name: string, signal?: AbortSignal) => Promise<SocialStatus>;
  /** The Error.name a check throws for "structurally blocked, not just
   * rate-limited" (retrying the identical request won't help — only
   * dropping the requirement will) — see instagram.ts's LoginWallError.
   * Undefined for a platform with no such distinct failure mode: github.ts
   * hits a real, documented API that has no login-wall-style redirect to
   * detect, and tiktok.ts's scraping hasn't shown one either (its own
   * failure modes so far are 429 and generic non-200s, both already
   * covered by the same retry/backoff every platform gets below). Same for
   * npm.ts (a real documented API, like github.ts) and youtube.ts/twitter.ts
   * (status-code-only scraping that also hasn't shown a distinct
   * login-wall-style signal in testing).
   */
  blockedErrorName?: string;
}
// Every platform here (like every one below) throws RateLimitError on a
// 429, but none of these five have actually been observed hitting it in
// practice: npm's public registry limit isn't documented and a 100-request
// burst (2026-09-27) came back clean; Instagram's only real out-of-the-box
// failure mode is its login wall (a structural block, not a rate limit —
// see LoginWallError above — and a non-issue at all once
// INSTAGRAM_SESSION_ID is configured); and TikTok/YouTube/X all held up
// through that same 100-request burst with zero rate-limit responses
// (YouTube and X had been grouped as deferred before that test ran, on a
// suspicion neither actually panned out). Cheap enough to run eagerly
// alongside the domain checks and on by default.
export const EAGER_PLATFORMS: SocialPlatform[] = [
  { key: "npm", label: "npm", gate: "requireNpm", check: checkNpmPackageName },
  { key: "instagram", label: "Instagram", gate: "requireInstagram", check: checkInstagramUsername, blockedErrorName: "LoginWallError" },
  { key: "tiktok", label: "TikTok", gate: "requireTiktok", check: checkTiktokUsername },
  { key: "youtube", label: "YouTube", gate: "requireYoutube", check: checkYoutubeHandle },
  { key: "twitter", label: "X", gate: "requireTwitter", check: checkTwitterHandle },
];

// Checked only once every EAGER_PLATFORMS requirement has already passed
// (see the pendingAvailable loop below), so a candidate that would be
// filtered out anyway never burns one of these requests, and it defaults
// off (see parseGates/DEFAULT_GATES) rather than requiring the user to
// hit a rate limit before discovering they should turn it off. GitHub is
// the only platform in this app confirmed to actually hit its limit in
// practice: unlike every other platform, its 403 + X-RateLimit-Remaining:0
// response documents a hard, tight cap (60 unauthenticated requests/hour
// per IP — confirmed directly 2026-09-25 by reading its docs, and again
// 2026-09-27 by an actual 100-request-in-a-row test that hit 403 exactly
// at request #61), and was the platform whose exhausted-rate-limit case
// this app's SOCIAL_BLOCKED_STREAK_THRESHOLD breaker was originally
// written to handle. That same test ran against npm/Instagram/TikTok/
// YouTube/X too (see EAGER_PLATFORMS above) and came back clean for all
// five, so GitHub stands alone here now.
export const DEFERRED_PLATFORMS: SocialPlatform[] = [
  { key: "github", label: "GitHub", gate: "requireGithub", check: checkGithubUsername },
];

// How many consecutive "blocked" results (see SocialPlatform.blockedErrorName
// above) it takes before a search concludes a given platform's checking is
// structurally blocked right now, not just having a rough patch — at which
// point it stops requiring that one platform for the rest of this search.
// Reset by any non-blocked result for that platform, so a handful of
// sporadic blips can't trip it; only a sustained run can. Each platform
// tracks its own streak independently (see gateDisabled/blockedStreaks in
// runDiscovery) — one platform tripping this never affects the others.
export const SOCIAL_BLOCKED_STREAK_THRESHOLD = 3;

// Checked once per found name (see worker below), not once per TLD, so this
// runs far less often than checkOne — but every platform here is on much
// shakier ground than RDAP/whois (either undocumented HTML structure, or —
// for GitHub — a real API but one this app has no elevated access to), so
// each gets the same retry/backoff treatment rather than failing a whole
// search over one flaky response. Returns "blocked" (rather than retrying)
// when the platform's own blockedErrorName fires — that isn't transient the
// way a rate limit is, so retrying the same candidate won't help; the
// caller tracks how often this happens per platform.
async function checkSocialOneUncached(
  platform: SocialPlatform,
  name: string,
  signal: AbortSignal,
  onEvent: (event: DiscoveryEvent) => void
) {
  let status: SocialStatus = "unknown";
  let attempt = 0;
  for (;;) {
    if (signal.aborted) return "aborted" as const;
    try {
      status = await platform.check(name, signal);
      break;
    } catch (err) {
      if (signal.aborted) return "aborted" as const;
      if (platform.blockedErrorName && err instanceof Error && err.name === platform.blockedErrorName) {
        return "blocked" as const;
      }
      if (err instanceof Error && err.name === "RateLimitError") {
        onEvent({ type: "error", message: `${platform.label} rate limited, backing off...` });
        attempt++;
        if (attempt >= MAX_TRANSIENT_RETRIES) {
          // Some of these limits are hourly (see github.ts's 60/hour
          // unauthenticated cap) — a few seconds of backoff can't outlast
          // that, and falling through to "unknown" would fail every
          // remaining candidate for the rest of this search with no way
          // to recover, unlike the SOCIAL_BLOCKED_STREAK_THRESHOLD breaker
          // below, which only counts the "blocked" return value. Returning
          // "blocked" here (once retries are exhausted, not on the first
          // hit) lets a sustained rate limit trip that same breaker instead.
          return "blocked" as const;
        }
        await delay(RATE_LIMIT_BACKOFF_MS, signal);
        continue;
      }
      attempt++;
      if (attempt >= MAX_TRANSIENT_RETRIES) {
        status = "unknown";
        break;
      }
      await delay(1000, signal);
    }
  }
  if (signal.aborted) return "aborted" as const;
  // A slightly longer delay than the domain check's: this only fires once
  // per found name (bounded by targetCount) rather than once per TLD, but
  // every platform here has a stricter anti-scraping/rate-limit posture
  // than a domain registry's, so it's worth being more conservative
  // per-request. Platforms run concurrently (see worker below), so this
  // delay overlaps across them rather than stacking.
  await delay(CHECK_DELAY_MS * 2, signal);
  return status;
}

export async function checkOne(name: string, tld: string, signal: AbortSignal, onEvent: (event: DiscoveryEvent) => void) {
  for (;;) {
    const result = await domainCache.getOrCompute(
      `${name}.${tld}`,
      () => checkOneUncached(name, tld, signal, onEvent),
      isConclusive
    );
    // Shared an in-flight lookup that another search aborted — not this
    // search's own abort, so go again (the aborted promise is already gone).
    if (result === "aborted" && !signal.aborted) continue;
    return result;
  }
}

export async function checkSocialOne(
  platform: SocialPlatform,
  name: string,
  signal: AbortSignal,
  onEvent: (event: DiscoveryEvent) => void
) {
  for (;;) {
    const result = await socialCache.getOrCompute(
      `${platform.key}:${name}`,
      () => checkSocialOneUncached(platform, name, signal, onEvent),
      isConclusive
    );
    if (result === "aborted" && !signal.aborted) continue;
    return result;
  }
}
