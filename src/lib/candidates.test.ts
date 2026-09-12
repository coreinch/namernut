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
  { word: "cat", langs: ["english"], definition: "a small domesticated animal" },
  { word: "dog", langs: ["english"], definition: "a domesticated animal" },
  { word: "rex", langs: ["english"], definition: "a king" },
];

describe("buildCandidateSpace (no keyword, no modifiers in pool -> unrestricted fallback)", () => {
  const space = buildCandidateSpace(pool);

  it("has pool.length^2 total candidates", () => {
    expect(space.total).toBe(pool.length * pool.length);
  });

  it("covers every ordered pair exactly once, with no separator between words", () => {
    const seen = new Set<string>();
    for (let i = 0; i < space.total; i++) {
      const { name } = space.candidateAt(i);
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
    expect(seen).toEqual(
      new Set(["catcat", "catdog", "catrex", "dogcat", "dogdog", "dogrex", "rexcat", "rexdog", "rexrex"])
    );
  });

  it("labels the meaning with each half's word and definition", () => {
    // index 0 -> i1=0 (cat), i2=0 (cat)
    expect(space.candidateAt(0)).toEqual({
      name: "catcat",
      meaning: "cat: a small domesticated animal · cat: a small domesticated animal",
    });
    // index 2 -> i1=0 (cat), i2=2 (rex)
    expect(space.candidateAt(2)).toEqual({
      name: "catrex",
      meaning: "cat: a small domesticated animal · rex: a king",
    });
  });
});

describe("buildCandidateSpace (no keyword, pool has modifiers -> modifier+core pairing)", () => {
  // "wild" and "sad" are in ENGLISH_MODIFIERS; "cat", "dog", "rex" aren't —
  // so this pool has 2 modifiers and 3 core words.
  const modPool: WordEntry[] = [
    { word: "wild", langs: ["english"], definition: "not tamed" },
    { word: "sad", langs: ["english"], definition: "unhappy" },
    { word: "cat", langs: ["english"], definition: "a small domesticated animal" },
    { word: "dog", langs: ["english"], definition: "a domesticated animal" },
    { word: "rex", langs: ["english"], definition: "a king" },
  ];
  const space = buildCandidateSpace(modPool);

  it("has modifiers * core total candidates, not pool.length^2", () => {
    expect(space.total).toBe(2 * 3);
    expect(space.total).not.toBe(modPool.length * modPool.length);
  });

  it("only ever pairs a modifier followed by a core word, never the reverse", () => {
    const names = new Set<string>();
    for (let i = 0; i < space.total; i++) names.add(space.candidateAt(i).name);
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

describe("buildCandidateSpace (with keyword)", () => {
  const space = buildCandidateSpace(pool, "nova");

  it("has 2 * pool.length total candidates", () => {
    expect(space.total).toBe(2 * pool.length);
  });

  it("pairs the keyword with every pool word in both orders, no other combinations", () => {
    const names = new Set<string>();
    for (let i = 0; i < space.total; i++) names.add(space.candidateAt(i).name);
    expect(names).toEqual(
      new Set(["novacat", "novadog", "novarex", "catnova", "dognova", "rexnova"])
    );
  });

  it("labels the keyword side of the meaning as the bare keyword (it has no definition)", () => {
    expect(space.candidateAt(0)).toEqual({
      name: "novacat",
      meaning: "nova · cat: a small domesticated animal",
    });
    expect(space.candidateAt(pool.length)).toEqual({
      name: "catnova",
      meaning: "cat: a small domesticated animal · nova",
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
