import type { WordEntry } from "@/lib/dictionary";
import { formatLangs } from "@/lib/dictionary";

export interface Candidate {
  name: string;
  /** Human-readable label of which dictionary/dictionaries each half came from, e.g. "English + Latin". */
  origin: string;
}

export interface CandidateSpace {
  total: number;
  /** Maps a shuffled index in [0, total) to a candidate domain name (no TLD) plus its origin label. */
  candidateAt(shuffledIndex: number): Candidate;
}

/**
 * Builds the space of candidate names to search.
 *
 * With no keyword, every ordered pair of pool words is a candidate
 * (pool.length^2 combinations). With a keyword, every candidate pairs the
 * keyword with one pool word, in both orders (keyword+word, word+keyword) —
 * 2 * pool.length combinations — so every result relates to that keyword,
 * the way "include a word" filters work in commercial name generators.
 */
export function buildCandidateSpace(pool: WordEntry[], keyword?: string): CandidateSpace {
  const L = pool.length;

  if (!keyword) {
    return {
      total: L * L,
      candidateAt(shuffled) {
        const i1 = Math.floor(shuffled / L);
        const i2 = shuffled % L;
        const w1 = pool[i1];
        const w2 = pool[i2];
        return {
          name: `${w1.word}${w2.word}`,
          origin: `${formatLangs(w1.langs)} + ${formatLangs(w2.langs)}`,
        };
      },
    };
  }

  return {
    total: 2 * L,
    candidateAt(shuffled) {
      if (shuffled < L) {
        const w = pool[shuffled];
        return { name: `${keyword}${w.word}`, origin: `Keyword + ${formatLangs(w.langs)}` };
      }
      const w = pool[shuffled - L];
      return { name: `${w.word}${keyword}`, origin: `${formatLangs(w.langs)} + Keyword` };
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
