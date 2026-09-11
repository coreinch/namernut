import { describe, expect, it } from "vitest";
import {
  ALL_LANGS,
  formatLangs,
  getDictionaryStats,
  getSelectedPool,
  getWordPool,
  parseLangs,
  parseShortOnly,
} from "./dictionary";

describe("formatLangs", () => {
  it("formats a single language", () => {
    expect(formatLangs(["english"])).toBe("English");
  });

  it("joins multiple languages with '/'", () => {
    expect(formatLangs(["english", "latin"])).toBe("English/Latin");
  });
});

describe("parseLangs", () => {
  it("defaults to ALL_LANGS for null/empty input", () => {
    expect(parseLangs(null)).toEqual(ALL_LANGS);
    expect(parseLangs("")).toEqual(ALL_LANGS);
  });

  it("filters to only recognized languages", () => {
    expect(parseLangs("english,klingon,latin")).toEqual(["english", "latin"]);
  });

  it("falls back to ALL_LANGS if nothing valid survives", () => {
    expect(parseLangs("klingon,elvish")).toEqual(ALL_LANGS);
  });

  it("dedupes and lowercases", () => {
    expect(parseLangs("ENGLISH,english,Latin")).toEqual(["english", "latin"]);
  });
});

describe("parseShortOnly", () => {
  it("is true only for exactly '3'", () => {
    expect(parseShortOnly("3")).toBe(true);
    expect(parseShortOnly("3-4")).toBe(false);
    expect(parseShortOnly(null)).toBe(false);
    expect(parseShortOnly("")).toBe(false);
  });
});

describe("getWordPool (real bundled data)", () => {
  const pool = getWordPool();

  it("is non-empty and every word is 3-4 lowercase letters", () => {
    expect(pool.length).toBeGreaterThan(1000);
    for (const entry of pool) {
      expect(entry.word).toMatch(/^[a-z]{3,4}$/);
      expect(entry.langs.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate words (each appears once, tagged with all its languages)", () => {
    const words = pool.map((e) => e.word);
    expect(new Set(words).size).toBe(words.length);
  });

  it("is sorted alphabetically", () => {
    const words = pool.map((e) => e.word);
    const sorted = [...words].sort((a, b) => a.localeCompare(b));
    expect(words).toEqual(sorted);
  });

  it("returns the same cached array reference on repeated calls", () => {
    expect(getWordPool()).toBe(pool);
  });
});

describe("getSelectedPool", () => {
  it("restricting to one language only returns words tagged with that language", () => {
    const englishOnly = getSelectedPool(["english"]);
    expect(englishOnly.length).toBeGreaterThan(0);
    for (const entry of englishOnly) {
      expect(entry.langs).toContain("english");
    }
  });

  it("shortOnly restricts to exactly 3-letter words", () => {
    const short = getSelectedPool(ALL_LANGS, true);
    expect(short.length).toBeGreaterThan(0);
    for (const entry of short) {
      expect(entry.word.length).toBe(3);
    }
  });

  it("selecting all languages returns the full pool", () => {
    expect(getSelectedPool(ALL_LANGS).length).toBe(getWordPool().length);
  });

  it("selecting fewer languages never returns more words than the full pool", () => {
    const subset = getSelectedPool(["latin"]);
    expect(subset.length).toBeLessThanOrEqual(getWordPool().length);
  });
});

describe("getDictionaryStats", () => {
  it("combinedUnique matches getSelectedPool's length for the same filters", () => {
    const stats = getDictionaryStats(["english", "latin"], false);
    expect(stats.combinedUnique).toBe(getSelectedPool(["english", "latin"], false).length);
  });

  it("totalCombinations is combinedUnique squared", () => {
    const stats = getDictionaryStats();
    expect(stats.totalCombinations).toBe(stats.combinedUnique * stats.combinedUnique);
  });

  it("per-language counts are all positive", () => {
    const stats = getDictionaryStats();
    expect(stats.english).toBeGreaterThan(0);
    expect(stats.latin).toBeGreaterThan(0);
    expect(stats.esperanto).toBeGreaterThan(0);
    expect(stats.french).toBeGreaterThan(0);
    expect(stats.spanish).toBeGreaterThan(0);
  });
});
