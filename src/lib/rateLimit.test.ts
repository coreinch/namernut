import { describe, expect, it, vi } from "vitest";
import { checkRateLimit, getClientIp } from "./rateLimit";

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    const key = `test-${Math.random()}`;
    expect(checkRateLimit(key, 3, 60_000).ok).toBe(true);
    expect(checkRateLimit(key, 3, 60_000).ok).toBe(true);
    expect(checkRateLimit(key, 3, 60_000).ok).toBe(true);
  });

  it("blocks once the limit is hit, with a positive retryAfterSeconds", () => {
    const key = `test-${Math.random()}`;
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000);
    const result = checkRateLimit(key, 2, 60_000);
    expect(result.ok).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    checkRateLimit(keyA, 1, 60_000);
    expect(checkRateLimit(keyA, 1, 60_000).ok).toBe(false);
    expect(checkRateLimit(keyB, 1, 60_000).ok).toBe(true);
  });

  it("resets once the window elapses", () => {
    vi.useFakeTimers();
    try {
      const key = `test-${Math.random()}`;
      checkRateLimit(key, 1, 1000);
      expect(checkRateLimit(key, 1, 1000).ok).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(checkRateLimit(key, 1, 1000).ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps expired buckets once the map grows past 5000 entries, without touching live ones", () => {
    const id = Math.random();
    const freshKey = `sweep-fresh-${id}`;
    // Inserted before the flood below so the internal sweep (once triggered)
    // walks past both an unexpired and many expired entries in the same pass.
    checkRateLimit(freshKey, 1, 60_000);
    // windowMs of -1000 makes resetAt land in the past immediately — each of
    // these buckets is already expired the instant it's created. Comfortably
    // over the 5000-entry threshold that makes checkRateLimit call sweep(now)
    // internally.
    for (let i = 0; i < 5100; i++) {
      checkRateLimit(`sweep-expired-${id}-${i}`, 1, -1000);
    }
    // freshKey's bucket must have survived every sweep pass above — limit is
    // 1, so this is only blocked if the original count is still there. If
    // sweep had wrongly deleted a live entry, this would incorrectly report
    // ok: true (a fresh bucket, reset to count 1).
    expect(checkRateLimit(freshKey, 1, 60_000).ok).toBe(false);
  });
});

describe("getClientIp", () => {
  it("prefers cf-connecting-ip — Cloudflare sets it itself, unlike x-forwarded-for", () => {
    const request = new Request("http://localhost", {
      headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 8.8.8.8" },
    });
    expect(getClientIp(request)).toBe("1.1.1.1");
  });

  it("falls back to the first x-forwarded-for entry when cf-connecting-ip is absent", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "2.2.2.2, 3.3.3.3" },
    });
    expect(getClientIp(request)).toBe("2.2.2.2");
  });

  it("falls back to \"unknown\" when x-forwarded-for's first entry is empty", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": ", 3.3.3.3" },
    });
    expect(getClientIp(request)).toBe("unknown");
  });

  it("returns \"unknown\" when neither header is present", () => {
    const request = new Request("http://localhost");
    expect(getClientIp(request)).toBe("unknown");
  });
});
