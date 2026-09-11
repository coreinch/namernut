import data from "@/data/dictionaries.json";

export type Lang = "english" | "latin" | "esperanto" | "french" | "spanish";

export const ALL_LANGS: Lang[] = ["english", "latin", "esperanto", "french", "spanish"];

export const LANG_LABELS: Record<Lang, string> = {
  english: "English",
  latin: "Latin",
  esperanto: "Esperanto",
  french: "French",
  spanish: "Spanish",
};

/** Formats a word's contributing language(s) for display, e.g. "English/Latin". */
export function formatLangs(langs: Lang[]): string {
  return langs.map((l) => LANG_LABELS[l]).join("/");
}

export interface WordEntry {
  word: string;
  langs: Lang[];
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

  cachedPool = [...byWord.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([word, langs]) => ({ word, langs: [...langs] }));

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

/** Parses the word-length filter: "3" restricts to 3-letter words only, anything else means 3-4. */
export function parseShortOnly(raw: string | null): boolean {
  return raw === "3";
}

/**
 * The word pool restricted to words present in at least one selected
 * language, and optionally to 3-letter words only (default is 3-4).
 */
export function getSelectedPool(langs: Lang[], shortOnly = false): WordEntry[] {
  const selected = new Set(langs);
  return getWordPool().filter(
    (entry) =>
      entry.langs.some((l) => selected.has(l)) && (!shortOnly || entry.word.length === 3)
  );
}

export function getDictionaryStats(langs: Lang[] = ALL_LANGS, shortOnly = false) {
  const combined = getSelectedPool(langs, shortOnly).length;
  return {
    english: data.english.length,
    latin: data.latin.length,
    esperanto: data.esperanto.length,
    french: data.french.length,
    spanish: data.spanish.length,
    combinedUnique: combined,
    totalCombinations: combined * combined,
    generatedAt: data.generatedAt,
  };
}
