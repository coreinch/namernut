import { describe, expect, it } from "vitest";
import { isPronounceable } from "./pronounceable";

describe("isPronounceable", () => {
  it("accepts ordinary word-like strings", () => {
    for (const name of ["novaform", "gauldoto", "heathall", "rusense", "borenag"]) {
      expect(isPronounceable(name)).toBe(true);
    }
  });

  it("rejects 4+ consecutive consonants", () => {
    expect(isPronounceable("pnyxfano")).toBe(false);
    expect(isPronounceable("stopfvgo")).toBe(false);
  });

  it("allows exactly 3 consecutive consonants (common clusters like 'str')", () => {
    expect(isPronounceable("strong".slice(0, 8))).toBe(true);
  });

  it("rejects 3+ consecutive vowels", () => {
    expect(isPronounceable("khottiou")).toBe(false);
  });

  it("rejects 3+ of the same letter in a row", () => {
    expect(isPronounceable("mummmulc")).toBe(false);
    expect(isPronounceable("asssool")).toBe(false);
    expect(isPronounceable("maniiis")).toBe(false);
  });

  it("allows exactly 2 of the same letter in a row", () => {
    expect(isPronounceable("carrot")).toBe(true);
    expect(isPronounceable("toppit")).toBe(true);
  });
});
