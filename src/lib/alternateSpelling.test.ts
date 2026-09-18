import { describe, expect, it } from "vitest";
import { alternateSpellings } from "./alternateSpelling";

describe("alternateSpellings", () => {
  it("drops the vowel before a final -er", () => {
    expect(alternateSpellings("tumbler")).toContain("tumblr");
    expect(alternateSpellings("flicker")).toContain("flickr");
  });

  it("swaps the first i for a y", () => {
    expect(alternateSpellings("lift")).toEqual(["lyft"]);
    expect(alternateSpellings("dig")).toContain("dyg");
  });

  it("skips the i->y swap if the word already contains a y", () => {
    // "diary" has both an i and a y — swapping would read as a doubled-up
    // misspelling ("dyary") rather than a deliberate respelling, and no
    // other rule applies to this word, so nothing is produced at all.
    expect(alternateSpellings("diary")).toEqual([]);
  });

  it("swaps a hard c (before a/o/u/l/r, or at the end) for k", () => {
    expect(alternateSpellings("cool")).toContain("kool");
    expect(alternateSpellings("candy")).toEqual(["kandy"]);
  });

  it("leaves a soft c (before e/i/y) alone", () => {
    // "cent" has a soft c (ce) — the hard-c rule must not fire on it.
    expect(alternateSpellings("cent").some((w) => w.startsWith("k"))).toBe(false);
  });

  it("doubles a single final consonant preceded by a vowel", () => {
    expect(alternateSpellings("fiver")).toContain("fiverr");
    expect(alternateSpellings("dig")).toContain("digg");
  });

  it("never returns the original word itself", () => {
    for (const w of ["lift", "tumbler", "cool", "fiver", "dig"]) {
      expect(alternateSpellings(w)).not.toContain(w);
    }
  });

  it("returns an empty array for a word with no applicable rule", () => {
    expect(alternateSpellings("nova")).toEqual([]);
  });

  it("returns no duplicate variants, even when multiple rules produce the same string", () => {
    for (const w of ["lift", "tumbler", "flicker", "cool", "fiver", "dig", "candy"]) {
      const variants = alternateSpellings(w);
      expect(new Set(variants).size).toBe(variants.length);
    }
  });
});
