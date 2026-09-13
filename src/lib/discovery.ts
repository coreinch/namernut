import crypto from "node:crypto";
import type { WordEntry } from "@/lib/dictionary";
import { buildCandidateSpace } from "@/lib/candidates";
import { isPronounceable } from "@/lib/pronounceable";
import { buildTypoIndex } from "@/lib/typocheck";
import { buildNicenessIndex } from "@/lib/niceness";
import { ShuffledRange } from "@/lib/permutation";
import { checkDomain } from "@/lib/rdap";
import { checkDomainWhois } from "@/lib/whois";
import { checkInstagramUsername, type InstagramStatus } from "@/lib/instagram";

export type DiscoveryEvent =
  | { type: "checking"; name: string; checkedCount: number }
  | { type: "taken"; name: string; checkedCount: number }
  | { type: "unknown"; name: string; checkedCount: number }
  // The domain itself was available, but its Instagram username wasn't (or
  // the check was inconclusive) — doesn't count toward the target, but is
  // still worth a distinct log entry rather than looking identical to a
  // plain domain-taken/unknown result.
  | { type: "filtered"; name: string; checkedCount: number }
  | {
      type: "found";
      domain: string;
      meaning: string;
      checkedCount: number;
      foundCount: number;
      instagram: InstagramStatus;
    }
  | { type: "complete"; checkedCount: number; foundCount: number }
  | { type: "stopped"; checkedCount: number }
  | { type: "error"; message: string };

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

// How many consecutive LoginWallError results (see instagram.ts) it takes
// before a search concludes Instagram checking is structurally blocked
// right now, not just having a rough patch — at which point it stops
// gating results on it. Reset by any non-blocked result, so a handful of
// sporadic blips can't trip it; only a sustained run can.
const INSTAGRAM_BLOCKED_STREAK_THRESHOLD = 3;

// Checked once per found name (see worker below), not once per TLD, so this
// runs far less often than checkOne — but Instagram's page-scraping check is
// on much shakier ground than RDAP/whois (an undocumented HTML structure,
// not a protocol meant for this), so it gets the same retry/backoff
// treatment rather than failing a whole search over one flaky response.
// Returns "blocked" (rather than retrying) for a login-wall redirect — that
// isn't transient the way a rate limit is, so retrying the same candidate
// won't help; the caller tracks how often this happens across candidates.
async function checkInstagramOne(name: string, signal: AbortSignal, onEvent: (event: DiscoveryEvent) => void) {
  let status: InstagramStatus = "unknown";
  let attempt = 0;
  for (;;) {
    if (signal.aborted) return "aborted" as const;
    try {
      status = await checkInstagramUsername(name, signal);
      break;
    } catch (err) {
      if (signal.aborted) return "aborted" as const;
      if (err instanceof Error && err.name === "LoginWallError") return "blocked" as const;
      if (err instanceof Error && err.name === "RateLimitError") {
        onEvent({ type: "error", message: "Instagram rate limited, backing off..." });
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
  // Instagram's anti-scraping posture is stricter than a domain registry's,
  // so it's worth being more conservative per-request here.
  await delay(CHECK_DELAY_MS * 2, signal);
  return status;
}

/**
 * Runs one independent discovery search: a freshly seeded, shuffled walk
 * over the candidate-name space, checking each candidate across every
 * selected TLD (a handful of candidates at a time, see CONCURRENCY) and
 * collecting up to `targetCount` results before finishing (or until the
 * caller aborts). A result requires both an available domain *and* an
 * available Instagram username for the same name — a domain match whose
 * Instagram username is taken (or inconclusive) doesn't count toward the
 * target and is reported as "filtered" instead of "found", so the search
 * keeps going rather than surfacing it. If Instagram checking turns out to
 * be structurally blocked for this whole search (see
 * INSTAGRAM_BLOCKED_STREAK_THRESHOLD) rather than just occasionally
 * flaky, that requirement is dropped part-way through — a domain match
 * counts on its own again — rather than the search silently producing
 * zero results forever. A candidate that doesn't read as a
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
 */
export async function runDiscovery(
  pool: WordEntry[],
  keyword: string | undefined,
  tlds: string[],
  targetCount: number,
  onEvent: (event: DiscoveryEvent) => void,
  signal: AbortSignal,
  maxLength: number
) {
  const space = buildCandidateSpace(pool, keyword);
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

  let tierIndex = 0;
  let nextIndexInTier = 0;
  let checkedCount = 0;
  let foundCount = 0;
  // See INSTAGRAM_BLOCKED_STREAK_THRESHOLD / checkInstagramOne. Once
  // tripped, Instagram is no longer checked at all for the rest of this
  // search (no point spending requests on a mechanism confirmed blocked)
  // and stops gating results — a domain match counts on its own again,
  // same as before Instagram checking existed.
  let instagramBlockedStreak = 0;
  let instagramGateDisabled = false;
  // Word concatenation has no separator, so two different underlying word
  // pairs can occasionally produce the identical candidate string (e.g. a
  // 3+4 split landing on the same characters as a different 4+3 split) —
  // and now, the same pair can also legitimately appear in more than one
  // tier (a common+common pair is also part of the full-pool tier).
  // Dedupe by name so we never check (or report as found) the same domain
  // twice in one run.
  const seenNames = new Set<string>();

  // Synchronous claim (no `await` before the mutation), so concurrent
  // workers never race over the same (tier, index) pair or overshoot the
  // target. Advances past exhausted or empty tiers to the next one.
  function claimCandidate(): { name: string; meaning: string } | null {
    if (signal.aborted) return null;
    if (foundCount >= targetCount) return null;
    while (tierIndex < space.tiers.length && nextIndexInTier >= space.tiers[tierIndex].total) {
      tierIndex++;
      nextIndexInTier = 0;
    }
    if (tierIndex >= space.tiers.length) return null;
    const tier = space.tiers[tierIndex];
    const range = tierRanges[tierIndex]!;
    const idx = nextIndexInTier++;
    return tier.candidateAt(range.at(idx));
  }

  async function worker() {
    for (;;) {
      const candidate = claimCandidate();
      if (candidate === null) return;

      const { name, meaning } = candidate;
      // Synchronous check-then-add, no `await` in between, so concurrent
      // workers can't both slip past this for the same name.
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      if (name.length > maxLength) continue;
      if (!isPronounceable(name)) continue;
      // Skipped when a keyword is present: both checks judge the whole
      // name as if it were algorithmically generated, but a keyword is a
      // fixed, user-chosen string glued onto a word, not another generated
      // half — see the doc comment above for why that always trips both.
      if (!keyword) {
        // Reads as a likely typo of an unrelated common word (e.g. one
        // letter off) rather than an intentional invented name — see
        // typocheck.ts for why this is a local dictionary check rather than
        // a live search engine's spelling correction.
        if (typoIndex.findMatch(name)) continue;
        // Contains a letter pair that barely occurs anywhere in real English
        // words (e.g. "mw") — reads as clunky rather than a natural-sounding
        // invented name. See niceness.ts.
        if (nicenessIndex.score(name) < NICENESS_THRESHOLD) continue;
      }

      // Instagram is checked once per name (it has no TLD), lazily — only
      // once a domain actually turns out available for this name, and
      // cached here so a name matching several TLDs doesn't re-check it.
      // That bounds Instagram requests to roughly targetCount rather than
      // one per candidate examined, which would be a much larger volume.
      let instagramForName: ReturnType<typeof checkInstagramOne> | null = null;

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

          let instagram: InstagramStatus = "unknown";
          if (!instagramGateDisabled) {
            if (!instagramForName) instagramForName = checkInstagramOne(name, signal, onEvent);
            const result = await instagramForName;
            if (result === "aborted") return;
            if (result === "blocked") {
              instagramBlockedStreak++;
              // Guarded on !instagramGateDisabled too: several workers can
              // have a check in flight when the streak first trips, and
              // each one's in-flight request can still resolve "blocked"
              // afterward — without this, each of those would re-trip the
              // (already-tripped) breaker and emit a duplicate event.
              if (!instagramGateDisabled && instagramBlockedStreak >= INSTAGRAM_BLOCKED_STREAK_THRESHOLD) {
                instagramGateDisabled = true;
                onEvent({
                  type: "error",
                  message:
                    "Instagram checking appears to be blocked (redirecting to login) — no longer requiring it for the rest of this search.",
                });
              }
            } else {
              instagramBlockedStreak = 0;
              instagram = result;
            }
          }

          // Only a domain+Instagram-username match counts as a result —
          // "taken" and "unknown" (an inconclusive check, e.g. rate
          // limited, or Instagram checking confirmed blocked for this
          // whole search) are both treated as not qualifying, since
          // "unknown" is not the same as confirmed available. Once the
          // gate above is disabled, though, a domain match counts on its
          // own — Instagram is no longer required at all.
          if (!instagramGateDisabled && instagram !== "available") {
            onEvent({ type: "filtered", name: domain, checkedCount });
            continue;
          }

          // Re-check once more: the Instagram lookup above can take a
          // while, and another worker may have filled the last slot during
          // it (same overshoot race as above, closed the same way).
          if (foundCount >= targetCount) continue;
          foundCount++;
          onEvent({ type: "found", domain, meaning, checkedCount, foundCount, instagram });
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
