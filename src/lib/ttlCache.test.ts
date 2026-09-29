import { afterEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "./ttlCache";

describe("TtlCache", () => {
  afterEach(() => vi.useRealTimers());

  it("expires entries after the TTL", () => {
    vi.useFakeTimers();
    const cache = new TtlCache<string>(1000, 10);
    cache.set("a", "x");
    expect(cache.get("a")).toBe("x");
    vi.advanceTimersByTime(1001);
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts the oldest entry past the size cap", () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("shares one in-flight compute and only caches conclusive values", async () => {
    const cache = new TtlCache<string>(1000, 10);
    const compute = vi.fn().mockResolvedValue("unknown");
    const [a, b] = await Promise.all([
      cache.getOrCompute("k", compute, (v) => v !== "unknown"),
      cache.getOrCompute("k", compute, (v) => v !== "unknown"),
    ]);
    expect([a, b]).toEqual(["unknown", "unknown"]);
    expect(compute).toHaveBeenCalledTimes(1);
    await cache.getOrCompute("k", compute, (v) => v !== "unknown");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejection", async () => {
    const cache = new TtlCache<string>(1000, 10);
    const compute = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    await expect(cache.getOrCompute("k", compute)).rejects.toThrow("boom");
    await expect(cache.getOrCompute("k", compute)).resolves.toBe("ok");
  });
});
