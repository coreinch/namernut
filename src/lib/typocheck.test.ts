import { describe, expect, it } from "vitest";
import { buildTypoIndex } from "./typocheck";

describe("buildTypoIndex", () => {
  const index = buildTypoIndex(["gore", "cat", "swift", "bright"]);

  it("returns null for a name with no near match", () => {
    expect(index.findMatch("zephyr")).toBeNull();
    expect(index.findMatch("plutox")).toBeNull();
  });

  it("does not flag an exact match — it's the word itself, not a typo of it", () => {
    expect(index.findMatch("gore")).toBeNull();
    expect(index.findMatch("cat")).toBeNull();
  });

  it("flags a single substituted character (same length)", () => {
    expect(index.findMatch("gore")).toBeNull();
    expect(index.findMatch("gorx")).toBe("gore");
    expect(index.findMatch("cot")).toBe("cat");
  });

  it("flags a single inserted character (one longer than the common word)", () => {
    expect(index.findMatch("goree")).toBe("gore");
    expect(index.findMatch("swifty")).toBe("swift");
  });

  it("flags a single deleted character (one shorter than the common word)", () => {
    expect(index.findMatch("gor")).toBe("gore");
    expect(index.findMatch("swift".slice(0, 4))).toBe("swift");
  });

  it("does not flag two or more differences", () => {
    expect(index.findMatch("brxght")).toBe("bright"); // 1 substitution — still flagged
    expect(index.findMatch("brxgxt")).toBeNull(); // 2 substitutions — not flagged
  });

  it("does not flag a name whose length differs by 2 or more from every common word", () => {
    expect(index.findMatch("catterpillar")).toBeNull();
  });

  it("only compares against words of a plausible length (same, or one shorter/longer)", () => {
    // "cat" (3) and "swift" (5) differ by 2 — "cot" (3) should only ever
    // match "cat", never accidentally resolve against "swift".
    expect(index.findMatch("cot")).toBe("cat");
  });
});
