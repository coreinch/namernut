import { describe, expect, it } from "vitest";
import {
  buildCandidateSpace,
  parseCount,
  parseKeyword,
  parseTlds,
  SUPPORTED_TLDS,
} from "./candidates";
import type { WordEntry } from "./dictionary";

const pool: WordEntry[] = [
  { word: "cat", langs: ["english"] },
  { word: "dog", langs: ["english"] },
  { word: "rex", langs: ["latin"] },
];

describe("buildCandidateSpace (no keyword)", () => {
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

  it("labels the origin with each half's contributing language(s)", () => {
    // index 0 -> i1=0 (cat/english), i2=0 (cat/english)
    expect(space.candidateAt(0)).toEqual({ name: "catcat", origin: "English + English" });
    // index 2 -> i1=0 (cat/english), i2=2 (rex/latin)
    expect(space.candidateAt(2)).toEqual({ name: "catrex", origin: "English + Latin" });
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

  it("labels the keyword side of the origin as 'Keyword'", () => {
    expect(space.candidateAt(0)).toEqual({ name: "novacat", origin: "Keyword + English" });
    expect(space.candidateAt(pool.length)).toEqual({ name: "catnova", origin: "English + Keyword" });
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
