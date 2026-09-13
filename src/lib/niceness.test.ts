import { describe, expect, it } from "vitest";
import { buildNicenessIndex } from "./niceness";

describe("buildNicenessIndex", () => {
  // A small corpus where "st"/"ta"/"an" are common bigrams and "xz" never
  // occurs at all.
  const index = buildNicenessIndex(["star", "stan", "tan", "ant", "art"]);

  it("scores a name built entirely from common bigrams higher than one with a rare bigram", () => {
    const nice = index.score("star"); // st, ta, ar — all attested
    const clunky = index.score("sxzr"); // sx, xz, zr — none attested
    expect(nice).toBeGreaterThan(clunky);
  });

  it("scores a name with one unattested bigram as 0 regardless of the rest", () => {
    // "st" and "ta" are both attested, but "xz" never occurs anywhere —
    // the weakest link (0) should dominate, not an average.
    expect(index.score("staxzta")).toBe(0);
  });

  it("returns 1 for a name shorter than 2 characters (no bigram to score)", () => {
    expect(index.score("a")).toBe(1);
    expect(index.score("")).toBe(1);
  });

  it("is deterministic for the same input", () => {
    expect(index.score("star")).toBe(index.score("star"));
  });
});
