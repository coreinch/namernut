import type { WordEntry } from "@/lib/dictionary";
import { isModifier } from "@/lib/modifiers";

export interface Candidate {
  name: string;
  /** Each half's word plus its short WordNet definition (or just the bare word for a user-supplied keyword, which has none), e.g. "swift: moving fast · fox: a carnivorous mammal". */
  meaning: string;
}

export interface CandidateTier {
  total: number;
  /** Maps a shuffled index in [0, total) to a candidate domain name (no TLD) plus its meaning label. */
  candidateAt(shuffledIndex: number): Candidate;
}

export interface CandidateSpace {
  /**
   * Search draws only from common (see lib/dictionary.ts) words — the full,
   * much larger pool (which includes real-but-obscure WordNet entries) is
   * never searched, except as a one-tier fallback for the rare case where
   * there's no common subset to draw from at all (e.g. a language
   * selection with no common words). Kept as an array of tiers, rather
   * than a single space, so that fallback case slots in the same way
   * without a separate code path. Each tier is independently shuffled by
   * the caller (see discovery.ts).
   */
  tiers: CandidateTier[];
}

/** "word: definition", or just "word" if it has no definition (e.g. a user-supplied keyword). */
function describe(word: string, definition?: string): string {
  return definition ? `${word}: ${definition}` : word;
}

function buildPairTier(
  rows: WordEntry[],
  cols: WordEntry[],
  makeCandidate: (row: WordEntry, col: WordEntry) => Candidate
): CandidateTier {
  const C = cols.length;
  return {
    total: rows.length * C,
    candidateAt(shuffled) {
      const row = rows[Math.floor(shuffled / C)];
      const col = cols[shuffled % C];
      return makeCandidate(row, col);
    },
  };
}

function buildKeywordTier(words: WordEntry[], keyword: string): CandidateTier {
  const L = words.length;
  return {
    total: 2 * L,
    candidateAt(shuffled) {
      if (shuffled < L) {
        const w = words[shuffled];
        return { name: `${keyword}${w.word}`, meaning: `${keyword} · ${describe(w.word, w.definition)}` };
      }
      const w = words[shuffled - L];
      return { name: `${w.word}${keyword}`, meaning: `${describe(w.word, w.definition)} · ${keyword}` };
    },
  };
}

/**
 * Builds the candidate space to search (see CandidateSpace) — restricted to
 * common (see lib/dictionary.ts) words only, e.g. "blue"+"ice" is
 * reachable but "otc"+"bunion" isn't, since WordNet's dictionary spans
 * everyday words and real-but-obscure ones alike with no notion of
 * frequency on its own. The full pool is only ever used as a one-tier
 * fallback when there's no common subset at all to draw from.
 *
 * With no keyword: if the pool has both modifiers (short adjectives, e.g.
 * "swift") and core words (everything else, e.g. "fox"), every candidate
 * pairs a modifier followed by a core word, in that order only —
 * "swiftfox" reads as an intentional brand name the way "foxswift" doesn't,
 * since adjective+noun is the order that actually sounds like English. See
 * lib/modifiers.ts for how a word is tagged as a modifier. A pool that
 * happens to be all modifiers or all core words (rare) falls back to
 * pairing every ordered pair of pool words instead.
 *
 * With a keyword, every candidate pairs the keyword with one pool word, in
 * both orders (keyword+word, word+keyword), so every result relates to
 * that keyword, the way "include a word" filters work in commercial name
 * generators.
 */
export function buildCandidateSpace(pool: WordEntry[], keyword?: string): CandidateSpace {
  if (!keyword) {
    const modifiers = pool.filter((w) => isModifier(w.word, w.langs));
    // Not just "isn't a modifier" — a word can be neither a usable
    // modifier nor a noun (e.g. "ago", "any": adjective/determiner only in
    // WordNet, zero noun senses), and must be excluded from both roles
    // rather than defaulting into the noun role. See WordEntry.noun.
    const core = pool.filter((w) => !isModifier(w.word, w.langs) && w.noun);
    const makeModCoreCandidate = (m: WordEntry, c: WordEntry): Candidate => ({
      name: `${m.word}${c.word}`,
      meaning: `${describe(m.word, m.definition)} · ${describe(c.word, c.definition)}`,
    });

    if (modifiers.length > 0 && core.length > 0) {
      const tiers: CandidateTier[] = [];
      const commonModifiers = modifiers.filter((w) => w.common);
      const commonCore = core.filter((w) => w.common);
      if (commonModifiers.length > 0 && commonCore.length > 0) {
        tiers.push(buildPairTier(commonModifiers, commonCore, makeModCoreCandidate));
      } else {
        // No common subset to draw from at all — fall back to the full
        // space rather than searching nothing.
        tiers.push(buildPairTier(modifiers, core, makeModCoreCandidate));
      }
      return { tiers };
    }

    const makeFallbackCandidate = (w1: WordEntry, w2: WordEntry): Candidate => ({
      name: `${w1.word}${w2.word}`,
      meaning: `${describe(w1.word, w1.definition)} · ${describe(w2.word, w2.definition)}`,
    });
    const tiers: CandidateTier[] = [];
    const commonPool = pool.filter((w) => w.common);
    if (commonPool.length > 0) {
      tiers.push(buildPairTier(commonPool, commonPool, makeFallbackCandidate));
    } else {
      tiers.push(buildPairTier(pool, pool, makeFallbackCandidate));
    }
    return { tiers };
  }

  const tiers: CandidateTier[] = [];
  const commonPool = pool.filter((w) => w.common);
  if (commonPool.length > 0) {
    tiers.push(buildKeywordTier(commonPool, keyword));
  } else {
    tiers.push(buildKeywordTier(pool, keyword));
  }
  return { tiers };
}

// TLDs we've verified actually work — 404=available / 200=taken via RDAP
// where a server exists (either discovered through IANA's bootstrap
// registry at data.iana.org/rdap/dns.json, or, for a couple of registries
// that run RDAP without being listed there — .io/.me via Identity Digital —
// hardcoded in STATIC_RDAP_BASE in rdap.ts), or matching whois text
// patterns for the handful that have no RDAP at all (.co, .us, .de, .eu).
// ccTLDs generally: unlike gTLDs, RDAP isn't ICANN-mandated for them, so
// coverage here is whichever ones we've individually confirmed work, not
// "all ccTLDs". Ordered roughly by real-world popularity — the UI shows the
// front of this list by default and folds the rest behind a "More" toggle.
export const SUPPORTED_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "ai",
  "xyz",
  "app",
  "dev",
  "uk",
  "me",
  "us",
  "de",
  "eu",
  "info",
  "shop",
  "tech",
  "club",
  "biz",
  "cloud",
  "name",
] as const;
export type Tld = (typeof SUPPORTED_TLDS)[number];

/** Parses/validates a requested TLD subset, falling back to .com only. */
export function parseTlds(raw: string | null): Tld[] {
  if (!raw) return ["com"];
  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Tld => (SUPPORTED_TLDS as readonly string[]).includes(s));
  const unique = [...new Set(requested)];
  return unique.length > 0 ? unique : ["com"];
}

/**
 * Sanitizes a user-supplied keyword to a short, plain lowercase string.
 * Digits are kept (domains can legally contain them, e.g. "web3.com") —
 * only letters and digits survive, everything else (spaces, punctuation,
 * emoji, etc.) is stripped.
 */
export function parseKeyword(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Parses/clamps the requested batch size, falling back to a sane default. */
export function parseCount(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return 12;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}
