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
      /** All three are always present regardless of which gates were on —
       * "unknown" for any platform that wasn't required (see
       * DiscoveryGates) rather than the field being absent, so the client
       * never has to distinguish "not checked" from "checked, but
       * inconclusive" itself. */
      instagram: SocialStatus;
      github: SocialStatus;
      tiktok: SocialStatus;
      /** Which generation mechanism produced this candidate — see CandidateSource — carried through so the UI can tell a dictionary pairing apart from an AI synonym/invented name/alt-spelling without re-parsing `meaning`. */
      source: CandidateSource;
    }
  | { type: "complete"; checkedCount: number; foundCount: number }
  | { type: "stopped"; checkedCount: number }
  | { type: "error"; message: string };

/**
 * Which of runDiscovery's candidate-rejection gates are actually active —
 * user-configurable (see the "Filters" section in page.tsx), each
 * defaulting to true (on) so the out-of-the-box behavior is unchanged from
 * before these were exposed. Turning a gate off doesn't relax it — it
 * removes that check entirely, so more candidates (including lower-quality
 * ones) reach a real domain/social check.
 */
export interface DiscoveryGates {
  /** A result also requires an available Instagram username for the name — see SOCIAL_PLATFORMS/gateDisabled below. */
  requireInstagram: boolean;
  /** Same requirement, for GitHub — see SOCIAL_PLATFORMS/gateDisabled below. */
  requireGithub: boolean;
  /** Same requirement, for TikTok — see SOCIAL_PLATFORMS/gateDisabled below. */
  requireTiktok: boolean;
  /** Reject candidates isPronounceable() flags as unpronounceable. */
  filterPronounceable: boolean;
  /** Reject candidates that read as a likely typo of a common word — see typocheck.ts. Only ever applies with no keyword (see worker() below). */
  filterTypos: boolean;
  /** Reject candidates with a rare/awkward letter pair — see niceness.ts. Only ever applies with no keyword (see worker() below). */
  filterNiceness: boolean;
}

/** Parses the six gate toggles from request query params, each defaulting to on (true) — i.e. absent/malformed input reproduces the pre-gates behavior. Only the literal string "false" turns a gate off, so a typo'd value fails safe (on) rather than silently disabling a check. */
export function parseGates(searchParams: URLSearchParams): DiscoveryGates {
  const on = (key: string) => searchParams.get(key) !== "false";
  return {
    requireInstagram: on("requireInstagram"),
    requireGithub: on("requireGithub"),
    requireTiktok: on("requireTiktok"),
    filterPronounceable: on("filterPronounceable"),
    filterTypos: on("filterTypos"),
    filterNiceness: on("filterNiceness"),
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
 * loop check all three with one generic path instead of three copies of
 * the same concurrency-sensitive logic.
 */
interface SocialPlatform {
  key: "instagram" | "github" | "tiktok";
  /** Used in user-facing log/error messages — see checkSocialOne and the
   * "structurally blocked" breaker below. */
  label: string;
  gate: keyof Pick<DiscoveryGates, "requireInstagram" | "requireGithub" | "requireTiktok">;
  check: (name: string, signal?: AbortSignal) => Promise<SocialStatus>;
  /** The Error.name a check throws for "structurally blocked, not just
   * rate-limited" (retrying the identical request won't help — only
   * dropping the requirement will) — see instagram.ts's LoginWallError.
   * Undefined for a platform with no such distinct failure mode: github.ts
   * hits a real, documented API that has no login-wall-style redirect to
   * detect, and tiktok.ts's scraping hasn't shown one either (its own
   * failure modes so far are 429 and generic non-200s, both already
   * covered by the same retry/backoff every platform gets below).
   */
  blockedErrorName?: string;
}
const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { key: "instagram", label: "Instagram", gate: "requireInstagram", check: checkInstagramUsername, blockedErrorName: "LoginWallError" },
  { key: "github", label: "GitHub", gate: "requireGithub", check: checkGithubUsername },
  { key: "tiktok", label: "TikTok", gate: "requireTiktok", check: checkTiktokUsername },
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
 * SOCIAL_PLATFORMS and gates.requireInstagram/requireGithub/requireTiktok)
 * for the same name — a domain match where any one of those is taken (or
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
  // being enforced. Keyed by SocialPlatform.key, one entry per platform in
  // SOCIAL_PLATFORMS.
  const blockedStreaks: Record<string, number> = { instagram: 0, github: 0, tiktok: 0 };
  // Starting "disabled" when a platform's gate is turned off reuses the
  // exact same fallback path the blocked-streak breaker below drops into
  // once it trips at runtime — a domain match counts on its own for that
  // platform, with no separate code path needed for "never required" vs.
  // "no longer required".
  const gateDisabled: Record<string, boolean> = {
    instagram: !gates.requireInstagram,
    github: !gates.requireGithub,
    tiktok: !gates.requireTiktok,
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

      for (const tld of tlds) {
        if (signal.aborted) return;
        if (foundCount >= targetCount) return;

        const domain = `${name}.${tld}`;
        onEvent({ type: "checking", name: domain, checkedCount });

        const status = await checkOne(name, tld, signal, onEvent);
        if (status === "aborted") return;

        checkedCount++;

        if (status === "available") {
          // Re-check right here, with no `await` before the increment: the
          // guard at the top of this loop only catches workers that hadn't
          // yet started an in-flight RDAP/whois check when the target was
          // reached. Without this second, synchronous check, several
          // concurrent workers can all pass that guard while foundCount is
          // still under target, then all resolve "available" and all
          // increment — overshooting by up to CONCURRENCY-1 results.
          if (foundCount >= targetCount) continue;

          // "unknown" is the correct resting value for every platform
          // that's disabled (never required, or dropped mid-search — see
          // gateDisabled below) — SocialStatus has no separate "not
          // checked" state, and DiscoveryEvent's "found" case always
          // carries all three (see its own doc comment), so a disabled
          // platform reports the same "unknown" a genuinely inconclusive
          // check would.
          const social: Record<string, SocialStatus> = { instagram: "unknown", github: "unknown", tiktok: "unknown" };

          // Run every still-required platform's check concurrently rather
          // than one after another — sequentially, three platforms each
          // paying their own CHECK_DELAY_MS*2 tail delay (see
          // checkSocialOne) would nearly triple this section's latency for
          // no benefit, since the checks are fully independent of each
          // other.
          const activePlatforms = SOCIAL_PLATFORMS.filter((p) => !gateDisabled[p.key]);
          const results = await Promise.all(
            activePlatforms.map(async (platform) => {
              if (!socialForName[platform.key]) {
                socialForName[platform.key] = checkSocialOne(platform, name, signal, onEvent);
              }
              return { platform, result: await socialForName[platform.key]! };
            })
          );
          if (results.some((r) => r.result === "aborted")) return;

          for (const { platform, result } of results) {
            if (result === "blocked") {
              blockedStreaks[platform.key]++;
              // Guarded on !gateDisabled[platform.key] too: several
              // workers can have a check for this platform in flight when
              // its streak first trips, and each one's in-flight request
              // can still resolve "blocked" afterward — without this,
              // each of those would re-trip the (already-tripped) breaker
              // and emit a duplicate event.
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

          // Only a domain match plus every *currently* required platform's
          // handle being available counts as a result — "taken" and
          // "unknown" (an inconclusive check, or a platform confirmed
          // blocked for this whole search) both fail to qualify, since
          // "unknown" is not the same as confirmed available. Evaluated
          // against gateDisabled's state *after* the loop above, so a
          // platform whose breaker just tripped on this very candidate is
          // already exempted for it too — same as it always was for
          // Instagram alone.
          const anyRequiredUnavailable = SOCIAL_PLATFORMS.some(
            (p) => !gateDisabled[p.key] && social[p.key] !== "available"
          );
          if (anyRequiredUnavailable) {
            onEvent({ type: "filtered", name: domain, checkedCount });
            continue;
          }

          // Re-check once more: the social checks above can take a while,
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
            source,
          });
        } else {
          onEvent({ type: status === "taken" ? "taken" : "unknown", name: domain, checkedCount });
        }

        if (signal.aborted) return;
        await delay(CHECK_DELAY_MS, signal);
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
