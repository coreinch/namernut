import { describe, expect, it, vi } from "vitest";
import type { WordEntry } from "./dictionary";

// Decouple this test from the real, regenerable modifiers list (src/data/
// dictionaries.json) — a dictionary rebuild can shuffle which words are
// tagged as modifiers (e.g. a word gaining/losing a cross-language
// collision), which would otherwise make this file's expectations flaky.
// A fixed two-word modifier set keeps "no modifiers in pool" vs. "pool has
// modifiers" deterministic regardless of what the real data looks like.
// (vi.mock calls are hoisted above imports by Vitest's transform, so the
// static import below correctly receives this mock.)
vi.mock("./modifiers", () => ({
  isModifier: (word: string) => word === "wild" || word === "sad",
}));

import {
  buildCandidateSpace,
  parseCount,
  parseKeyword,
  parseTlds,
  SUPPORTED_TLDS,
} from "./candidates";

const pool: WordEntry[] = [
  { word: "cat", langs: ["english"], definition: "a small domesticated animal", common: false, noun: true },
  { word: "dog", langs: ["english"], definition: "a domesticated animal", common: false, noun: true },
  { word: "rex", langs: ["english"], definition: "a king", common: false, noun: true },
];

// Collects every candidate name across every tier in a space (the order
// search would actually try them: tier 0 fully, then tier 1, etc.).
function allNames(space: { tiers: { total: number; candidateAt(i: number): { name: string } }[] }): string[] {
  const names: string[] = [];
  for (const tier of space.tiers) {
    for (let i = 0; i < tier.total; i++) names.push(tier.candidateAt(i).name);
  }
  return names;
}

describe("buildCandidateSpace (no keyword, no modifiers, no common words -> single unrestricted fallback tier)", () => {
  const space = buildCandidateSpace(pool);

  it("has exactly one tier, sized pool.length^2", () => {
    expect(space.tiers.length).toBe(1);
    expect(space.tiers[0].total).toBe(pool.length * pool.length);
  });

  it("covers every ordered pair exactly once, with no separator between words", () => {
    const names = allNames(space);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names)).toEqual(
      new Set(["catcat", "catdog", "catrex", "dogcat", "dogdog", "dogrex", "rexcat", "rexdog", "rexrex"])
    );
  });

  it("labels the meaning with each half's word and definition", () => {
    const tier = space.tiers[0];
    // index 0 -> i1=0 (cat), i2=0 (cat)
    expect(tier.candidateAt(0)).toEqual({
      name: "catcat",
      meaning: "cat: a small domesticated animal · cat: a small domesticated animal",
      parts: ["cat", "cat"],
    });
    // index 2 -> i1=0 (cat), i2=2 (rex)
    expect(tier.candidateAt(2)).toEqual({
      name: "catrex",
      meaning: "cat: a small domesticated animal · rex: a king",
      parts: ["cat", "rex"],
    });
  });
});

describe("buildCandidateSpace (no keyword, some words common -> only the common+common tier is searched)", () => {
  // "cat" and "dog" are common; "rex" isn't.
  const commonPool: WordEntry[] = [
    { word: "cat", langs: ["english"], definition: "a small domesticated animal", common: true, noun: true },
    { word: "dog", langs: ["english"], definition: "a domesticated animal", common: true, noun: true },
    { word: "rex", langs: ["english"], definition: "a king", common: false, noun: true },
  ];
  const space = buildCandidateSpace(commonPool);

  it("has exactly one tier, sized common-only (not the full pool)", () => {
    expect(space.tiers.length).toBe(1);
    expect(space.tiers[0].total).toBe(2 * 2); // cat/dog x cat/dog
  });

  it("the tier only ever pairs common words with each other — a non-common word is never reachable", () => {
    const names = new Set(allNames(space));
    expect(names).toEqual(new Set(["catcat", "catdog", "dogcat", "dogdog"]));
    expect(names.has("rexrex")).toBe(false);
    expect(names.has("catrex")).toBe(false);
  });
});

describe("buildCandidateSpace (no keyword, pool has modifiers -> modifier+core pairing)", () => {
  // "wild" and "sad" are in ENGLISH_MODIFIERS; "cat", "dog", "rex" aren't —
  // so this pool has 2 modifiers and 3 core words, none marked common.
  const modPool: WordEntry[] = [
    { word: "wild", langs: ["english"], definition: "not tamed", common: false, noun: false },
    { word: "sad", langs: ["english"], definition: "unhappy", common: false, noun: false },
    { word: "cat", langs: ["english"], definition: "a small domesticated animal", common: false, noun: true },
    { word: "dog", langs: ["english"], definition: "a domesticated animal", common: false, noun: true },
    { word: "rex", langs: ["english"], definition: "a king", common: false, noun: true },
  ];
  const space = buildCandidateSpace(modPool);

  it("has a single tier sized modifiers * core, not pool.length^2", () => {
    expect(space.tiers.length).toBe(1);
    expect(space.tiers[0].total).toBe(2 * 3);
    expect(space.tiers[0].total).not.toBe(modPool.length * modPool.length);
  });

  it("only ever pairs a modifier followed by a core word, never the reverse", () => {
    const names = new Set(allNames(space));
    expect(names).toEqual(
      new Set(["wildcat", "wilddog", "wildrex", "sadcat", "saddog", "sadrex"])
    );
    // Never core+modifier, modifier+modifier, or core+core.
    expect(names.has("catwild")).toBe(false);
    expect(names.has("wildsad")).toBe(false);
    expect(names.has("sadwild")).toBe(false);
    expect(names.has("catdog")).toBe(false);
  });
});

describe("buildCandidateSpace (a word that's neither a modifier nor a noun is excluded from both roles)", () => {
  // "ago" is a real example: WordNet lists it only as an adjective, and
  // it's excluded from the modifier role too (see MODIFIER_STOPWORDS in
  // build-dictionaries.mjs) since real English never uses it prenominally
  // ("three years ago", never "ago years"). Before WordEntry.noun existed,
  // a word like this fell through into the core/noun role by default,
  // merely by not being tagged a modifier — this proves that no longer
  // happens.
  const modPool: WordEntry[] = [
    { word: "wild", langs: ["english"], definition: "not tamed", common: false, noun: false },
    { word: "cat", langs: ["english"], definition: "a small domesticated animal", common: false, noun: true },
    { word: "ago", langs: ["english"], definition: "gone by; or in the past", common: false, noun: false },
  ];
  const space = buildCandidateSpace(modPool);

  it("never pairs the non-modifier, non-noun word into any candidate", () => {
    const names = new Set(allNames(space));
    expect(names).toEqual(new Set(["wildcat"]));
    expect([...names].some((n) => n.includes("ago"))).toBe(false);
  });
});

describe("buildCandidateSpace (no keyword, common modifiers and core -> only the common modifier x common core tier is searched)", () => {
  const modPool: WordEntry[] = [
    { word: "wild", langs: ["english"], definition: "not tamed", common: true, noun: false },
    { word: "sad", langs: ["english"], definition: "unhappy", common: false, noun: false },
    { word: "cat", langs: ["english"], definition: "a small domesticated animal", common: true, noun: true },
    { word: "dog", langs: ["english"], definition: "a domesticated animal", common: false, noun: true },
  ];
  const space = buildCandidateSpace(modPool);

  it("has exactly one tier, sized common-modifier x common-core (not the full modifier x core space)", () => {
    expect(space.tiers.length).toBe(1);
    expect(space.tiers[0].total).toBe(1 * 1); // wild x cat
  });

  it("is exactly the one common modifier+core pair — non-common words are never reachable", () => {
    expect(space.tiers[0].candidateAt(0).name).toBe("wildcat");
  });
});

describe("buildCandidateSpace (with keyword)", () => {
  const space = buildCandidateSpace(pool, "nova");

  it("has a single tier (no common words in this pool), sized 2 * pool.length", () => {
    expect(space.tiers.length).toBe(1);
    expect(space.tiers[0].total).toBe(2 * pool.length);
  });

  it("pairs the keyword with every pool word in both orders, no other combinations", () => {
    const names = new Set(allNames(space));
    expect(names).toEqual(
      new Set(["novacat", "novadog", "novarex", "catnova", "dognova", "rexnova"])
    );
  });

  it("labels the keyword side of the meaning as the bare keyword (it has no definition)", () => {
    const tier = space.tiers[0];
    expect(tier.candidateAt(0)).toEqual({
      name: "novacat",
      meaning: "nova · cat: a small domesticated animal",
      parts: ["nova", "cat"],
    });
    expect(tier.candidateAt(pool.length)).toEqual({
      name: "catnova",
      meaning: "cat: a small domesticated animal · nova",
      parts: ["cat", "nova"],
    });
  });
});

describe("parseKeyword", () => {
  it("returns undefined for null/empty input", () => {
    expect(parseKeyword(null)).toBeUndefined();
    expect(parseKeyword("")).toBeUndefined();
  });

  it("lowercases and strips punctuation/symbols, but keeps digits", () => {
    expect(parseKeyword("NoVa123!")).toBe("nova123");
  });

  // Regression test: digits used to be stripped entirely, so a purely
  // numeric keyword (e.g. "123") silently collapsed to an empty string and
  // the keyword filter was dropped without any indication — a real bug,
  // since domains can legally contain digits (e.g. "web3.com").
  it("keeps a purely numeric keyword instead of dropping it", () => {
    expect(parseKeyword("123")).toBe("123");
    expect(parseKeyword("web3")).toBe("web3");
  });

  it("returns undefined if nothing letter/digit survives", () => {
    expect(parseKeyword("!!!")).toBeUndefined();
  });

  it("caps length at 15 characters", () => {
    expect(parseKeyword("a".repeat(30))).toBe("a".repeat(15));
  });
});

describe("parseCount", () => {
  it("defaults to 12 for null/invalid input", () => {
    expect(parseCount(null)).toBe(12);
    expect(parseCount("not-a-number")).toBe(12);
  });

  it("clamps to [1, 30]", () => {
    expect(parseCount("0")).toBe(1);
    expect(parseCount("-5")).toBe(1);
    expect(parseCount("1000")).toBe(30);
  });

  it("truncates fractional values", () => {
    expect(parseCount("7.9")).toBe(7);
  });

  it("passes through valid in-range values", () => {
    expect(parseCount("5")).toBe(5);
  });
});

describe("parseTlds", () => {
  it("defaults to ['com'] for null/empty input", () => {
    expect(parseTlds(null)).toEqual(["com"]);
    expect(parseTlds("")).toEqual(["com"]);
  });

  it("filters out unsupported TLDs", () => {
    // .jp/.ru aren't in SUPPORTED_TLDS (no confirmed working RDAP or whois
    // pattern for them yet) — picked instead of .io/.co/.me, which *are*
    // supported despite lacking IANA-bootstrap RDAP (see rdap.ts).
    expect(parseTlds("com,jp,ru,net")).toEqual(["com", "net"]);
  });

  it("falls back to ['com'] if nothing valid survives", () => {
    expect(parseTlds("jp,ru,kr")).toEqual(["com"]);
  });

  it("dedupes and lowercases", () => {
    expect(parseTlds("COM,com,NET")).toEqual(["com", "net"]);
  });

  it("only accepts TLDs from the supported list", () => {
    const parsed = parseTlds(SUPPORTED_TLDS.join(","));
    expect(parsed).toEqual([...SUPPORTED_TLDS]);
  });
});
