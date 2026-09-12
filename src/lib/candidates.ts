import type { WordEntry } from "@/lib/dictionary";
import { isModifier } from "@/lib/modifiers";

export interface Candidate {
  name: string;
  /** Each half's word plus its short WordNet definition (or just the bare word for a user-supplied keyword, which has none), e.g. "swift: moving fast · fox: a carnivorous mammal". */
  meaning: string;
}

export interface CandidateSpace {
  total: number;
  /** Maps a shuffled index in [0, total) to a candidate domain name (no TLD) plus its meaning label. */
  candidateAt(shuffledIndex: number): Candidate;
}

/** "word: definition", or just "word" if it has no definition (e.g. a user-supplied keyword). */
function describe(word: string, definition?: string): string {
  return definition ? `${word}: ${definition}` : word;
}

/**
 * Builds the space of candidate names to search.
 *
 * With no keyword: if the pool has both modifiers (short adjectives, e.g.
 * "swift") and core words (everything else, e.g. "fox"), every candidate
 * pairs a modifier followed by a core word, in that order only
 * (modifiers.length * core.length combinations) — "swiftfox" reads as an
 * intentional brand name the way "foxswift" doesn't, since adjective+noun
 * is the order that actually sounds like English. See lib/modifiers.ts for
 * how a word is tagged as a modifier. A pool that happens to be all
 * modifiers or all core words (rare) falls back to pairing every ordered
 * pair of pool words (pool.length^2 combinations) so the search still works.
 *
 * With a keyword, every candidate pairs the keyword with one pool word, in
 * both orders (keyword+word, word+keyword) — 2 * pool.length combinations —
 * so every result relates to that keyword, the way "include a word" filters
 * work in commercial name generators.
 */
export function buildCandidateSpace(pool: WordEntry[], keyword?: string): CandidateSpace {
  const L = pool.length;

  if (!keyword) {
    const modifiers = pool.filter((w) => isModifier(w.word, w.langs));
    const core = pool.filter((w) => !isModifier(w.word, w.langs));
    const M = modifiers.length;
    const C = core.length;

    if (M > 0 && C > 0) {
      return {
        total: M * C,
        candidateAt(shuffled) {
          const m = modifiers[Math.floor(shuffled / C)];
          const c = core[shuffled % C];
          return {
            name: `${m.word}${c.word}`,
            meaning: `${describe(m.word, m.definition)} · ${describe(c.word, c.definition)}`,
          };
        },
      };
    }

    return {
      total: L * L,
      candidateAt(shuffled) {
        const i1 = Math.floor(shuffled / L);
        const i2 = shuffled % L;
        const w1 = pool[i1];
        const w2 = pool[i2];
        return {
          name: `${w1.word}${w2.word}`,
          meaning: `${describe(w1.word, w1.definition)} · ${describe(w2.word, w2.definition)}`,
        };
      },
    };
  }

  return {
    total: 2 * L,
    candidateAt(shuffled) {
      if (shuffled < L) {
        const w = pool[shuffled];
        return { name: `${keyword}${w.word}`, meaning: `${keyword} · ${describe(w.word, w.definition)}` };
      }
      const w = pool[shuffled - L];
      return { name: `${w.word}${keyword}`, meaning: `${describe(w.word, w.definition)} · ${keyword}` };
    },
  };
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
