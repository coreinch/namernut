import data from "@/data/dictionaries.json";

// A single-entry union (rather than a plain string) so WordEntry/isModifier
// keep the same shape they'd have with multiple languages — English is the
// only language the app supports (Latin/Esperanto/French/Spanish were
// dropped: none of them had a WordNet-equivalent lexicon source, only
// corpus-derived word lists of much lower, unfixable quality).
export type Lang = "english";

export const ALL_LANGS: Lang[] = ["english"];

export const LANG_LABELS: Record<Lang, string> = {
  english: "English",
};

/** Formats a word's contributing language(s) for display, e.g. "English". */
export function formatLangs(langs: Lang[]): string {
  return langs.map((l) => LANG_LABELS[l]).join("/");
}

export interface WordEntry {
  word: string;
  langs: Lang[];
  /** Short WordNet gloss for this word (see src/lib/definitions.ts), or "" if none was found. */
  definition: string;
  /**
   * Common enough (by real-world usage frequency) to prioritize in search —
   * see src/lib/candidates.ts, which tries common+common pairs before
   * falling back to the full (much larger, and much more likely to include
   * an obscure word) dictionary. WordNet alone has no notion of frequency;
   * this comes from a separate word-frequency list applied at build time
   * (see scripts/build-dictionaries.mjs).
   */
  common: boolean;
  /**
   * Has a genuine WordNet noun sense — used to gate the "core" (noun) half
   * of a modifier+core pairing in candidates.ts. Not the same as "isn't a
   * modifier": a word can be neither (e.g. "ago", "any" — adjective/
   * determiner only in WordNet, zero noun senses), and must be excluded
   * from both roles rather than falling through into the noun role.
   */
  noun: boolean;
}

let cachedPool: WordEntry[] | null = null;

/** Merges the three source dictionaries into one deduped, sorted word pool. */
export function getWordPool(): WordEntry[] {
  if (cachedPool) return cachedPool;

  const byWord = new Map<string, Set<Lang>>();
  for (const lang of ALL_LANGS) {
    for (const word of data[lang]) {
      if (!byWord.has(word)) byWord.set(word, new Set());
      byWord.get(word)!.add(lang);
    }
  }

  const commonWords = new Set(data.englishCommon);
  const nounWords = new Set(data.englishNouns);
  cachedPool = [...byWord.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([word, langs]) => ({
      word,
      langs: [...langs],
      definition: (data.englishDefinitions as Record<string, string>)[word] ?? "",
      common: commonWords.has(word),
      noun: nounWords.has(word),
    }));

  return cachedPool;
}

/** Parses/validates a requested language subset, falling back to all three. */
export function parseLangs(raw: string | null): Lang[] {
  if (!raw) return ALL_LANGS;
  const requested = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Lang => (ALL_LANGS as string[]).includes(s));
  const unique = [...new Set(requested)];
  return unique.length > 0 ? unique : ALL_LANGS;
}

// The dictionary itself spans a range of word lengths (2-8 letters) rather
// than being capped at 3-4 — the app limits how long a *result* can be via
// a slider on the combined output length instead of restricting each
// word's own length, so there's no per-word length filter here anymore.
// These bounds are the slider's range: the shortest possible pairing is two
// 2-letter words (4), and the longest sensible one accounts for the
// keyword path pairing a full-length (15-char) keyword with an 8-letter
// dictionary word (23, rounded up to 24).
export const MIN_COMBINED_LENGTH = 4;
export const MAX_COMBINED_LENGTH = 24;

/** Parses the combined-output-length cap, clamping to the slider's range and defaulting to no effective limit. */
export function parseMaxLength(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return MAX_COMBINED_LENGTH;
  return Math.min(MAX_COMBINED_LENGTH, Math.max(MIN_COMBINED_LENGTH, Math.trunc(n)));
}

/** The word pool restricted to words present in at least one selected language. */
export function getSelectedPool(langs: Lang[]): WordEntry[] {
  const selected = new Set(langs);
  return getWordPool().filter((entry) => entry.langs.some((l) => selected.has(l)));
}

export function getDictionaryStats(langs: Lang[] = ALL_LANGS) {
  const combined = getSelectedPool(langs).length;
  return {
    english: data.english.length,
    combinedUnique: combined,
    totalCombinations: combined * combined,
    generatedAt: data.generatedAt,
  };
}
