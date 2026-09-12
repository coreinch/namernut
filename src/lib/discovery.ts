import crypto from "node:crypto";
import type { WordEntry } from "@/lib/dictionary";
import { buildCandidateSpace } from "@/lib/candidates";
import { isPronounceable } from "@/lib/pronounceable";
import { ShuffledRange } from "@/lib/permutation";
import { checkDomain } from "@/lib/rdap";
import { checkDomainWhois } from "@/lib/whois";

export type DiscoveryEvent =
  | { type: "checking"; name: string; checkedCount: number }
  | { type: "taken"; name: string; checkedCount: number }
  | { type: "unknown"; name: string; checkedCount: number }
  | { type: "found"; domain: string; meaning: string; checkedCount: number; foundCount: number }
  | { type: "complete"; checkedCount: number; foundCount: number }
  | { type: "stopped"; checkedCount: number }
  | { type: "error"; message: string };

const CONCURRENCY = 4;
const CHECK_DELAY_MS = 350;
const RATE_LIMIT_BACKOFF_MS = 5000;
const MAX_TRANSIENT_RETRIES = 3;

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
 * Runs one independent discovery search: a freshly seeded, shuffled walk
 * over the candidate-name space, checking each candidate across every
 * selected TLD (a handful of candidates at a time, see CONCURRENCY) and
 * collecting up to `targetCount` available domains before finishing (or
 * until the caller aborts). Each call gets its own random seed and local
 * counters — nothing here is shared across callers, so concurrent searches
 * (e.g. from separate browser tabs) never interfere with each other or
 * resume one another's progress. `maxLength` caps the combined candidate
 * name's length (e.g. modifier+core, or keyword+word) — the dictionary
 * itself spans a range of word lengths, so this is what actually limits
 * how long a result can be, not any per-word restriction.
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

      for (const tld of tlds) {
        if (signal.aborted) return;
        if (foundCount >= targetCount) return;

        const domain = `${name}.${tld}`;
        onEvent({ type: "checking", name: domain, checkedCount });

        const status = await checkOne(name, tld, signal, onEvent);
        if (status === "aborted") return;

        checkedCount++;

        if (status === "available") {
          foundCount++;
          onEvent({ type: "found", domain, meaning, checkedCount, foundCount });
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
