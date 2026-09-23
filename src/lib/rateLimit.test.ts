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

  it("returns \"unknown\" when neither header is present", () => {
    const request = new Request("http://localhost");
    expect(getClientIp(request)).toBe("unknown");
  });
});
