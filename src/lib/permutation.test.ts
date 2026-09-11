import { describe, expect, it } from "vitest";
import { ShuffledRange } from "./permutation";

describe("ShuffledRange", () => {
  it("is a bijection over small ranges (every index visited exactly once)", () => {
    for (const size of [1, 2, 3, 7, 16, 100, 1000]) {
      const range = new ShuffledRange(size, 12345);
      const seen = new Set<number>();
      for (let i = 0; i < size; i++) {
        const v = range.at(i);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(size);
        expect(seen.has(v)).toBe(false);
        seen.add(v);
      }
      expect(seen.size).toBe(size);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = new ShuffledRange(5000, 42);
    const b = new ShuffledRange(5000, 42);
    for (let i = 0; i < 5000; i += 137) {
      expect(a.at(i)).toBe(b.at(i));
    }
  });

  it("produces a different order for a different seed", () => {
    const a = new ShuffledRange(5000, 1);
    const b = new ShuffledRange(5000, 2);
    let differences = 0;
    for (let i = 0; i < 5000; i++) {
      if (a.at(i) !== b.at(i)) differences++;
    }
    // Different seeds should disagree on the vast majority of indices.
    expect(differences).toBeGreaterThan(4900);
  });

  it("handles large ranges (hundreds of millions) without hanging or colliding", () => {
    const size = 142_000_000;
    const range = new ShuffledRange(size, 42);
    const sampleIndices = [0, 1, 2, size - 1, Math.floor(size / 2), 987654];
    const seen = new Set<number>();
    for (const i of sampleIndices) {
      const v = range.at(i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(size);
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
  });

  it("throws for an out-of-range index", () => {
    const range = new ShuffledRange(10, 1);
    expect(() => range.at(-1)).toThrow(RangeError);
    expect(() => range.at(10)).toThrow(RangeError);
  });
});
