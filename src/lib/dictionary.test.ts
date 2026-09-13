import { describe, expect, it } from "vitest";
import {
  ALL_LANGS,
  DEFAULT_COMBINED_LENGTH,
  formatLangs,
  getDictionaryStats,
  getSelectedPool,
  getWordPool,
  MAX_COMBINED_LENGTH,
  MIN_COMBINED_LENGTH,
  parseLangs,
  parseMaxLength,
} from "./dictionary";

describe("formatLangs", () => {
  it("formats a language", () => {
    expect(formatLangs(["english"])).toBe("English");
  });
});

describe("parseLangs", () => {
  it("defaults to ALL_LANGS for null/empty input", () => {
    expect(parseLangs(null)).toEqual(ALL_LANGS);
    expect(parseLangs("")).toEqual(ALL_LANGS);
  });

  it("filters to only recognized languages", () => {
    expect(parseLangs("english,klingon")).toEqual(["english"]);
  });

  it("falls back to ALL_LANGS if nothing valid survives", () => {
    expect(parseLangs("klingon,elvish")).toEqual(ALL_LANGS);
  });

  it("dedupes and lowercases", () => {
    expect(parseLangs("ENGLISH,english")).toEqual(["english"]);
  });
});

describe("parseMaxLength", () => {
  it("defaults to DEFAULT_COMBINED_LENGTH for null/invalid input", () => {
    expect(parseMaxLength(null)).toBe(DEFAULT_COMBINED_LENGTH);
    expect(parseMaxLength("not-a-number")).toBe(DEFAULT_COMBINED_LENGTH);
  });

  it("clamps to [MIN_COMBINED_LENGTH, MAX_COMBINED_LENGTH]", () => {
    expect(parseMaxLength("0")).toBe(MIN_COMBINED_LENGTH);
    expect(parseMaxLength("1000")).toBe(MAX_COMBINED_LENGTH);
  });

  it("passes through valid in-range values", () => {
    const mid = Math.floor((MIN_COMBINED_LENGTH + MAX_COMBINED_LENGTH) / 2);
    expect(parseMaxLength(String(mid))).toBe(mid);
  });

  it("truncates fractional values", () => {
    expect(parseMaxLength("7.9")).toBe(7);
  });
});

describe("getWordPool (real bundled data)", () => {
  const pool = getWordPool();

  it("is non-empty and every word is 2-8 lowercase letters", () => {
    expect(pool.length).toBeGreaterThan(1000);
    for (const entry of pool) {
      expect(entry.word).toMatch(/^[a-z]{2,8}$/);
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

  it("selecting all languages returns the full pool", () => {
    expect(getSelectedPool(ALL_LANGS).length).toBe(getWordPool().length);
  });
});

describe("getDictionaryStats", () => {
  it("combinedUnique matches getSelectedPool's length for the same filters", () => {
    const stats = getDictionaryStats(["english"]);
    expect(stats.combinedUnique).toBe(getSelectedPool(["english"]).length);
  });

  it("totalCombinations is combinedUnique squared", () => {
    const stats = getDictionaryStats();
    expect(stats.totalCombinations).toBe(stats.combinedUnique * stats.combinedUnique);
  });

  it("per-language counts are all positive", () => {
    const stats = getDictionaryStats();
    expect(stats.english).toBeGreaterThan(0);
  });
});
