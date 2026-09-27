import crypto from "node:crypto";
import type { WordEntry } from "@/lib/dictionary";
import { buildCandidateSpace, type Candidate, type CandidateSource } from "@/lib/candidates";
import { isPronounceable } from "@/lib/pronounceable";
import { buildTypoIndex } from "@/lib/typocheck";
import { buildNicenessIndex } from "@/lib/niceness";
import { ShuffledRange } from "@/lib/permutation";
import { checkDomain } from "@/lib/rdap";
import { checkDomainWhois } from "@/lib/whois";
import { checkInstagramUsername } from "@/lib/instagram";
import { checkGithubUsername } from "@/lib/github";
import { checkTiktokUsername } from "@/lib/tiktok";
import { checkNpmPackageName } from "@/lib/npm";
import { checkYoutubeHandle } from "@/lib/youtube";
import { checkTwitterHandle } from "@/lib/twitter";
import type { SocialStatus } from "@/lib/socialStatus";

export type DiscoveryEvent =
  // Emitted by the /api/discover route itself (never by runDiscovery below)
  // right after the SSE connection opens, only when at least one AI
  // candidate source is actually about to be fetched — the route awaits
  // suggestKeywordSynonyms/suggestInventedNames before it has anything else
  // to send, and without this the client sees total silence for however
  // long that call takes (a real multi-second gap, not a rare edge case),
  // easily read as "stuck" rather than "the AI step is not done making up
  // words yet". Purely informational, like "synonyms"/"invented" below.
  | { type: "preparing" }
  // Emitted once, before any "checking" events, only when aiSynonyms is
  // non-empty — see suggestKeywordSynonyms in lib/synonyms.ts. Purely
  // informational: the words are already baked into the candidate space
  // buildCandidateSpace built (see runDiscovery below) by the time this
  // fires, so the UI can surface what's being searched without gating
  // anything on it.
  | { type: "synonyms"; words: string[] }
  // Same posture as "synonyms" above, but for suggestInventedNames in
  // lib/inventedNames.ts — a distinct event since these are complete
  // standalone candidate names, not halves paired with a dictionary word.
  | { type: "invented"; words: string[] }
  // Same posture again, but for alternateSpellings in
  // lib/alternateSpelling.ts — deterministic respellings of the literal
  // keyword (e.g. "lyft" for "lift"), not an AI suggestion at all. Emitted
  // synchronously (no "preparing" wait needed, since there's no LLM call
  // behind it) once runDiscovery starts, only when the list is non-empty.
  | { type: "altSpellings"; words: string[] }
  | { type: "checking"; name: string; checkedCount: number }
  | { type: "taken"; name: string; checkedCount: number }
  | { type: "unknown"; name: string; checkedCount: number }
  // The domain itself was available, but one of its required social
  // handles wasn't (or that check was inconclusive) — doesn't count
  // toward the target, but is still worth a distinct log entry rather
  // than looking identical to a plain domain-taken/unknown result.
  | { type: "filtered"; name: string; checkedCount: number }
  | {
      type: "found";
      domain: string;
      meaning: string;
      /** The two literal strings the name was concatenated from — see
       * Candidate.parts in lib/candidates.ts — carried through so
       * lib/brandability.ts can search the name as two separate words without
       * re-deriving the split. */
      parts: [string, string];
      checkedCount: number;
      foundCount: number;
      /** All six are always present regardless of which gates were on —
       * "unknown" for any platform that wasn't required (see
       * DiscoveryGates) rather than the field being absent, so the client
       * never has to distinguish "not checked" from "checked, but
       * inconclusive" itself. */
      instagram: SocialStatus;
      github: SocialStatus;
      tiktok: SocialStatus;
      npm: SocialStatus;
      youtube: SocialStatus;
      twitter: SocialStatus;
      /** Which generation mechanism produced this candidate — see CandidateSource — carried through so the UI can tell a dictionary pairing apart from an AI synonym/invented name/alt-spelling without re-parsing `meaning`. */
      source: CandidateSource;
    }
  | { type: "complete"; checkedCount: number; foundCount: number }
  | { type: "stopped"; checkedCount: number }
  | { type: "error"; message: string };

/**
 * Which of runDiscovery's candidate-rejection gates are actually active —
 * user-configurable (see the "Filters" section in page.tsx). Every gate
 * defaults to true (on) so the out-of-the-box behavior is unchanged from
 * before these were exposed, EXCEPT requireGithub, which defaults to false
 * (off) — see DEFERRED_PLATFORMS below for why GitHub specifically: it's
 * the one platform in this app confirmed (by a real 100-request-in-a-row
 * test, 2026-09-27) to actually hit a hard rate limit in practice, unlike
 * every other platform here (including two, Instagram/TikTok, that are
 * undocumented scraping just like GitHub's neighbors YouTube/X, and
 * including YouTube/X themselves, which cleared that same 100-request test
 * with zero rate-limit responses). Turning a gate off doesn't relax it —
 * it removes that check entirely, so more candidates (including
 * lower-quality ones) reach a real domain/social check.
 */
export interface DiscoveryGates {
  /** A result also requires an available Instagram username for the name — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireInstagram: boolean;
  /** Same requirement, for GitHub — see DEFERRED_PLATFORMS/gateDisabled below. Off by default. */
  requireGithub: boolean;
  /** Same requirement, for TikTok — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireTiktok: boolean;
  /** Same requirement, for an npm package name — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireNpm: boolean;
  /** Same requirement, for a YouTube channel handle — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireYoutube: boolean;
  /** Same requirement, for an X (Twitter) handle — see EAGER_PLATFORMS/gateDisabled below. On by default. */
  requireTwitter: boolean;
  /** Reject candidates isPronounceable() flags as unpronounceable. */
  filterPronounceable: boolean;
  /** Reject candidates that read as a likely typo of a common word — see typocheck.ts. Only ever applies with no keyword (see worker() below). */
  filterTypos: boolean;
  /** Reject candidates with a rare/awkward letter pair — see niceness.ts. Only ever applies with no keyword (see worker() below). */
  filterNiceness: boolean;
}

/**
 * Parses the nine gate toggles from request query params. Every gate
 * except requireGithub defaults to on (true) if absent/malformed,
 * reproducing the pre-gates behavior; only the literal string "false"
 * turns one of those off. requireGithub defaults to off (false) instead —
 * see the DiscoveryGates doc comment above — so only the literal string
 * "true" turns it on.
 */
export function parseGates(searchParams: URLSearchParams): DiscoveryGates {
  const onByDefault = (key: string) => searchParams.get(key) !== "false";
  const offByDefault = (key: string) => searchParams.get(key) === "true";
  return {
    requireInstagram: onByDefault("requireInstagram"),
    requireGithub: offByDefault("requireGithub"),
    requireTiktok: onByDefault("requireTiktok"),
    requireNpm: onByDefault("requireNpm"),
    requireYoutube: onByDefault("requireYoutube"),
    requireTwitter: onByDefault("requireTwitter"),
    filterPronounceable: onByDefault("filterPronounceable"),
    filterTypos: onByDefault("filterTypos"),
    filterNiceness: onByDefault("filterNiceness"),
  };
}

const CONCURRENCY = 4;
const CHECK_DELAY_MS = 350;
const RATE_LIMIT_BACKOFF_MS = 5000;
const MAX_TRANSIENT_RETRIES = 3;

// A name's least-common letter-pair needs to account for at least this
// fraction of all letter-pairs in the dictionary to count as "nice" —
// chosen empirically against the real dictionary: about 83% of realistic
// word-pair combos clear it, while genuinely awkward ones (e.g. a rare
// pair like "mw") don't. A candidate below this is rejected outright (see
// the niceness check in worker() below), the same as isPronounceable.
const NICENESS_THRESHOLD = 0.0001;

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

async function checkOne(name: string, tld: string, signal: AbortSignal, onEvent: (event: DiscoveryEvent) => void) {
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
interface SocialPlatform {
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
const EAGER_PLATFORMS: SocialPlatform[] = [
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
const DEFERRED_PLATFORMS: SocialPlatform[] = [
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
const SOCIAL_BLOCKED_STREAK_THRESHOLD = 3;

// Checked once per found name (see worker below), not once per TLD, so this
// runs far less often than checkOne — but every platform here is on much
// shakier ground than RDAP/whois (either undocumented HTML structure, or —
// for GitHub — a real API but one this app has no elevated access to), so
// each gets the same retry/backoff treatment rather than failing a whole
// search over one flaky response. Returns "blocked" (rather than retrying)
// when the platform's own blockedErrorName fires — that isn't transient the
// way a rate limit is, so retrying the same candidate won't help; the
// caller tracks how often this happens per platform.
async function checkSocialOne(
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

/**
 * Runs one independent discovery search: a freshly seeded, shuffled walk
 * over the candidate-name space, checking each candidate across every
 * selected TLD (a handful of candidates at a time, see CONCURRENCY) and
 * collecting up to `targetCount` results before finishing (or until the
 * caller aborts). A result requires an available domain *and* the handle
 * being available on every social platform currently required (see
 * EAGER_PLATFORMS/DEFERRED_PLATFORMS and
 * gates.requireInstagram/requireGithub/requireTiktok) for the same name —
 * a domain match where any one of those is taken (or
 * inconclusive) doesn't count toward the target and is reported as
 * "filtered" instead of "found", so the search keeps going rather than
 * surfacing it. If a given platform's checking turns out to be
 * structurally blocked for this whole search (see
 * SOCIAL_BLOCKED_STREAK_THRESHOLD) rather than just occasionally flaky,
 * that one platform's requirement is dropped part-way through — the other
 * still-required platforms (if any) keep being enforced, and once none are
 * left a domain match counts on its own — rather than the search silently
 * producing zero results forever. A candidate that doesn't read as a
 * natural-sounding name (see niceness.ts) is rejected outright, the same
 * as an unpronounceable one — but only when there's no keyword: those two
 * checks assume the whole name was algorithmically generated, which isn't
 * true of a user-typed keyword. A short keyword (e.g. "x") is always
 * exactly one edit away from whatever word it's glued to, tripping the
 * typo check on every single candidate, and a keyword with a letter pair
 * absent from the dictionary (e.g. "xx") tanks the niceness score of every
 * candidate the same way — either would silently reduce the whole search
 * to zero candidates ever reaching a real check, with no visible feedback,
 * rather than rejecting a candidate that's actually clumsy. Each call gets
 * its own random seed and local
 * counters — nothing here is shared across callers, so concurrent
 * searches (e.g. from separate browser tabs) never interfere with each
 * other or resume one another's progress. `maxLength` caps the combined
 * candidate name's length (e.g. modifier+core, or keyword+word) — the
 * dictionary itself spans a range of word lengths, so this is what
 * actually limits how long a result can be, not any per-word restriction.
 * `gates` toggles each rejection check independently — see DiscoveryGates.
 * `aiSynonyms` (only ever meaningful alongside `keyword`) widens the
 * candidate space with AI-suggested synonym tiers — see
 * suggestKeywordSynonyms in lib/synonyms.ts and selectTierSpecs in
 * candidates.ts; an empty array reproduces the pre-synonyms behavior
 * exactly (just the literal keyword tier). `inventedNames` adds one more
 * tier of complete, AI-invented candidate names (see suggestInventedNames
 * in lib/inventedNames.ts) — unlike every other candidate, these aren't
 * built from two paired halves, and unlike aiSynonyms this tier exists
 * whether or not there's a keyword at all. Every candidate from either
 * tier still passes through the exact same maxLength/gates checks below
 * as any other candidate — neither is special-cased in the worker loop.
 * `altSpellings` (only ever meaningful alongside `keyword`, like
 * aiSynonyms) adds one keyword-shaped tier per deterministic respelling of
 * the literal keyword — see alternateSpellings in lib/alternateSpelling.ts.
 * Unlike every other tier, an alt-spelling candidate is exempt from the
 * pronounceable gate specifically (see altSpellingSet in the worker below)
 * — a respelling is built by deliberately dropping a vowel or doubling a
 * letter, which isPronounceable would otherwise reject as unpronounceable
 * on sight, defeating the point of the feature.
 */
export async function runDiscovery(
  pool: WordEntry[],
  keyword: string | undefined,
  tlds: string[],
  targetCount: number,
  onEvent: (event: DiscoveryEvent) => void,
  signal: AbortSignal,
  maxLength: number,
  gates: DiscoveryGates,
  aiSynonyms: string[] = [],
  inventedNames: string[] = [],
  altSpellings: string[] = []
) {
  const space = buildCandidateSpace(pool, keyword, aiSynonyms, inventedNames, altSpellings);
  if (aiSynonyms.length > 0) onEvent({ type: "synonyms", words: aiSynonyms });
  if (inventedNames.length > 0) onEvent({ type: "invented", words: inventedNames });
  if (altSpellings.length > 0) onEvent({ type: "altSpellings", words: altSpellings });
  const typoIndex = buildTypoIndex(pool.filter((w) => w.common).map((w) => w.word));
  const nicenessIndex = buildNicenessIndex(pool.map((w) => w.word));
  const seed = crypto.randomInt(0, 2 ** 31);
  // One independently-shuffled walk per tier (e.g. common+common word pairs,
  // then the full pool) — each tier gets its own derived seed so the walks
  // aren't correlated, but everything is still deterministic given the
  // master seed. A tier with total 0 (e.g. no common words at all) gets no
  // range — never claimed, since claimCandidate skips straight past it.
  const tierRanges = space.tiers.map((tier, i) =>
    tier.total > 0 ? new ShuffledRange(tier.total, (seed + i) >>> 0) : null
  );

  // Per-tier cursor, claimed round-robin (see claimCandidate below) rather
  // than exhausting one tier fully before moving to the next — with, say,
  // 6 AI-synonym tiers plus the literal keyword tier, any tier fully
  // drained before moving on means later tiers (often each one alone
  // larger than a normal target count) never get reached at all. This
  // also made the earlier fix of just reordering tiers (AI tiers before
  // the literal keyword tier) a dead end: it only helps the tier placed
  // first among equals, not the rest. Round-robin means a search with N
  // non-empty tiers draws roughly 1/N of its results from each.
  const tierCursors = new Array(space.tiers.length).fill(0);
  let nextTier = 0;
  let checkedCount = 0;
  let foundCount = 0;
  // See SOCIAL_BLOCKED_STREAK_THRESHOLD / checkSocialOne. Once a platform's
  // streak trips, it's no longer checked at all for the rest of this search
  // (no point spending requests on a mechanism confirmed blocked) and stops
  // gating results — the other still-required platforms (if any) keep
  // being enforced. Keyed by SocialPlatform.key, one entry per platform
  // across EAGER_PLATFORMS and DEFERRED_PLATFORMS combined.
  const blockedStreaks: Record<string, number> = { instagram: 0, github: 0, tiktok: 0, npm: 0, youtube: 0, twitter: 0 };
  // Starting "disabled" when a platform's gate is turned off reuses the
  // exact same fallback path the blocked-streak breaker below drops into
  // once it trips at runtime — a domain match counts on its own for that
  // platform, with no separate code path needed for "never required" vs.
  // "no longer required".
  const gateDisabled: Record<string, boolean> = {
    instagram: !gates.requireInstagram,
    github: !gates.requireGithub,
    tiktok: !gates.requireTiktok,
    npm: !gates.requireNpm,
    youtube: !gates.requireYoutube,
    twitter: !gates.requireTwitter,
  };
  // Word concatenation has no separator, so two different underlying word
  // pairs can occasionally produce the identical candidate string (e.g. a
  // 3+4 split landing on the same characters as a different 4+3 split) —
  // and now, the same pair can also legitimately appear in more than one
  // tier (a common+common pair is also part of the full-pool tier).
  // Dedupe by name so we never check (or report as found) the same domain
  // twice in one run.
  const seenNames = new Set<string>();

  // A respelling is deliberately built to drop a vowel or double a letter
  // (see lib/alternateSpelling.ts) — "lyft" reads as an intentional brand
  // the way isPronounceable can't tell apart from a random unpronounceable
  // string, so it would reject nearly every alt-spelling candidate outright
  // if the check applied to them the same as everything else. Checking
  // parts against this set (rather than tagging Candidate itself) is a
  // cheap, worker-local way to know which candidates came from an
  // alt-spelling tier specifically, without threading tier provenance
  // through the whole CandidateSpace/Candidate shape for just this one gate.
  const altSpellingSet = new Set(altSpellings);

  // Synchronous claim (no `await` before the mutation), so concurrent
  // workers never race over the same (tier, index) pair or overshoot the
  // target. Advances past exhausted or empty tiers to the next one.
  function claimCandidate(): Candidate | null {
    if (signal.aborted) return null;
    if (foundCount >= targetCount) return null;
    // Scan at most once around the full ring looking for a tier that
    // isn't exhausted yet, starting from nextTier — same synchronous,
    // no-`await`-in-between claim as before, so concurrent workers still
    // never race over the same (tier, index) pair.
    for (let attempts = 0; attempts < space.tiers.length; attempts++) {
      const i = (nextTier + attempts) % space.tiers.length;
      if (tierCursors[i] < space.tiers[i].total) {
        const idx = tierCursors[i]++;
        nextTier = (i + 1) % space.tiers.length;
        return space.tiers[i].candidateAt(tierRanges[i]!.at(idx));
      }
    }
    return null; // every tier exhausted
  }

  // Awaits every still-required platform in `platforms` for `name`,
  // folding each result into `social` and applying the same
  // blocked-streak bookkeeping (see SOCIAL_BLOCKED_STREAK_THRESHOLD)
  // regardless of which group (EAGER_PLATFORMS/DEFERRED_PLATFORMS) is
  // passed in — factored out so the two-phase check below (eager
  // platforms, then deferred platforms only once those pass) doesn't
  // duplicate this bookkeeping.
  async function checkPlatformGroup(
    platforms: SocialPlatform[],
    name: string,
    social: Record<string, SocialStatus>,
    socialForName: Partial<Record<string, ReturnType<typeof checkSocialOne>>>
  ): Promise<"ok" | "aborted"> {
    const active = platforms.filter((p) => !gateDisabled[p.key]);
    const results = await Promise.all(
      active.map(async (platform) => {
        if (!socialForName[platform.key]) {
          socialForName[platform.key] = checkSocialOne(platform, name, signal, onEvent);
        }
        return { platform, result: await socialForName[platform.key]! };
      })
    );
    if (results.some((r) => r.result === "aborted")) return "aborted";

    for (const { platform, result } of results) {
      if (result === "blocked") {
        blockedStreaks[platform.key]++;
        // Guarded on !gateDisabled[platform.key] too: several workers can
        // have a check for this platform in flight when its streak first
        // trips, and each one's in-flight request can still resolve
        // "blocked" afterward — without this, each of those would re-trip
        // the (already-tripped) breaker and emit a duplicate event.
        if (!gateDisabled[platform.key] && blockedStreaks[platform.key] >= SOCIAL_BLOCKED_STREAK_THRESHOLD) {
          gateDisabled[platform.key] = true;
          onEvent({
            type: "error",
            message: `${platform.label} checking appears to be blocked — no longer requiring it for the rest of this search.`,
          });
        }
      } else {
        blockedStreaks[platform.key] = 0;
        social[platform.key] = result as SocialStatus;
      }
    }
    return "ok";
  }

  async function worker() {
    for (;;) {
      const candidate = claimCandidate();
      if (candidate === null) return;

      const { name, meaning, parts, source } = candidate;
      // Synchronous check-then-add, no `await` in between, so concurrent
      // workers can't both slip past this for the same name.
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      if (name.length > maxLength) continue;
      // Alt-spelling candidates are exempt — see altSpellingSet above.
      const isAltSpelling = altSpellingSet.has(parts[0]) || altSpellingSet.has(parts[1]);
      if (gates.filterPronounceable && !isAltSpelling && !isPronounceable(name)) continue;
      // Skipped when a keyword is present: both checks judge the whole
      // name as if it were algorithmically generated, but a keyword is a
      // fixed, user-chosen string glued onto a word, not another generated
      // half — see the doc comment above for why that always trips both.
      if (!keyword) {
        // Reads as a likely typo of an unrelated common word (e.g. one
        // letter off) rather than an intentional invented name — see
        // typocheck.ts for why this is a local dictionary check rather than
        // a live search engine's spelling correction.
        if (gates.filterTypos && typoIndex.findMatch(name)) continue;
        // Contains a letter pair that barely occurs anywhere in real English
        // words (e.g. "mw") — reads as clunky rather than a natural-sounding
        // invented name. See niceness.ts.
        if (gates.filterNiceness && nicenessIndex.score(name) < NICENESS_THRESHOLD) continue;
      }

      // Each social platform is checked once per name (none of them have a
      // TLD), lazily — only once a domain actually turns out available for
      // this name, and cached here (one slot per platform key) so a name
      // matching several TLDs doesn't re-check any of them. That bounds
      // each platform's requests to roughly targetCount rather than one
      // per candidate examined, which would be a much larger volume.
      const socialForName: Partial<Record<string, ReturnType<typeof checkSocialOne>>> = {};

      // TLDs whose domain came back available, in the order found. Kicking
      // off (but not yet awaiting) this name's EAGER_PLATFORMS checks the
      // moment the *first* one is found — see below — lets them run in the
      // background while the loop moves straight on to the next TLD's
      // domain check, instead of paying their latency before that next
      // domain check can even start. They're only actually awaited once
      // every TLD has been checked, by which point they're often already
      // resolved. This overlaps domain and eager-platform checking without
      // increasing eager-platform request volume: a candidate whose domain
      // is unavailable on every TLD still never triggers one. Unlike
      // EAGER_PLATFORMS, DEFERRED_PLATFORMS checks are never started
      // here — see DEFERRED_PLATFORMS above for why they wait until
      // EAGER_PLATFORMS has already passed, in the pendingAvailable loop
      // below.
      const pendingAvailable: { domain: string }[] = [];

      for (const tld of tlds) {
        if (signal.aborted) return;
        if (foundCount >= targetCount) return;

        const domain = `${name}.${tld}`;
        onEvent({ type: "checking", name: domain, checkedCount });

        const status = await checkOne(name, tld, signal, onEvent);
        if (status === "aborted") return;

        checkedCount++;

        if (status === "available") {
          // Only EAGER_PLATFORMS are kicked off eagerly here — see
          // DEFERRED_PLATFORMS above for why its checks wait until the
          // pendingAvailable loop below instead of starting in the
          // background this early.
          for (const platform of EAGER_PLATFORMS) {
            if (!gateDisabled[platform.key] && !socialForName[platform.key]) {
              socialForName[platform.key] = checkSocialOne(platform, name, signal, onEvent);
            }
          }
          pendingAvailable.push({ domain });
        } else {
          onEvent({ type: status === "taken" ? "taken" : "unknown", name: domain, checkedCount });
        }

        if (signal.aborted) return;
        await delay(CHECK_DELAY_MS, signal);
      }

      for (const { domain } of pendingAvailable) {
        if (signal.aborted) return;
        // Re-check right here, with no `await` before the increment below:
        // the guard at the top of the domain-check loop only catches
        // workers that hadn't yet started an in-flight RDAP/whois check
        // when the target was reached. Without this second, synchronous
        // check, several concurrent workers can all pass that guard while
        // foundCount is still under target, then all resolve "available"
        // and all increment — overshooting by up to CONCURRENCY-1 results.
        if (foundCount >= targetCount) continue;

        // "unknown" is the correct resting value for every platform
        // that's disabled (never required, or dropped mid-search — see
        // gateDisabled below) — SocialStatus has no separate "not
        // checked" state, and DiscoveryEvent's "found" case always
        // carries all six (see its own doc comment), so a disabled
        // platform reports the same "unknown" a genuinely inconclusive
        // check would.
        const social: Record<string, SocialStatus> = {
          instagram: "unknown",
          github: "unknown",
          tiktok: "unknown",
          npm: "unknown",
          youtube: "unknown",
          twitter: "unknown",
        };

        // Every still-required EAGER_PLATFORMS check was already started
        // above (as soon as this name's first available TLD was found)
        // rather than here — awaiting it now just picks up results that
        // have often already arrived while later TLDs in this candidate
        // were still being domain-checked.
        const eagerOutcome = await checkPlatformGroup(EAGER_PLATFORMS, name, social, socialForName);
        if (eagerOutcome === "aborted") return;

        // Only a domain match plus every *currently* required eager
        // platform's handle being available qualifies for a
        // DEFERRED_PLATFORMS check at all — "taken"/"unknown" here
        // means this candidate is already disqualified, so there's no
        // point spending a request against a rate-limited, off-by-default
        // deferred platform for a name that can't be a result anyway.
        const anyEagerUnavailable = EAGER_PLATFORMS.some(
          (p) => !gateDisabled[p.key] && social[p.key] !== "available"
        );
        if (anyEagerUnavailable) {
          onEvent({ type: "filtered", name: domain, checkedCount });
          continue;
        }

        // Re-check once more before spending a deferred-platform request:
        // the eager-platform checks above can take a while, and another
        // worker may have filled the last slot during them (same
        // overshoot race as above, closed the same way).
        if (foundCount >= targetCount) continue;

        // Reached only once every EAGER_PLATFORMS requirement already
        // passed — see DEFERRED_PLATFORMS above for why these run
        // last, unlike EAGER_PLATFORMS these were never started eagerly, so
        // this is the first await for any of them.
        const deferredOutcome = await checkPlatformGroup(DEFERRED_PLATFORMS, name, social, socialForName);
        if (deferredOutcome === "aborted") return;

        const anyDeferredUnavailable = DEFERRED_PLATFORMS.some(
          (p) => !gateDisabled[p.key] && social[p.key] !== "available"
        );
        if (anyDeferredUnavailable) {
          onEvent({ type: "filtered", name: domain, checkedCount });
          continue;
        }

        // Re-check once more: the deferred checks above can take a while,
        // and another worker may have filled the last slot during them
        // (same overshoot race as above, closed the same way).
        if (foundCount >= targetCount) continue;
        foundCount++;
        onEvent({
          type: "found",
          domain,
          meaning,
          parts,
          checkedCount,
          foundCount,
          instagram: social.instagram,
          github: social.github,
          tiktok: social.tiktok,
          npm: social.npm,
          youtube: social.youtube,
          twitter: social.twitter,
          source,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if (signal.aborted) {
    onEvent({ type: "stopped", checkedCount });
  } else {
    onEvent({ type: "complete", checkedCount, foundCount });
  }
}
