import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkBrandability } = vi.hoisted(() => ({ checkBrandability: vi.fn() }));
vi.mock("@/lib/brandability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brandability")>();
  return { ...actual, checkBrandability };
});

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn(() => ({ ok: true, retryAfterSeconds: 0 })) }));
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...actual, checkRateLimit };
});

import { GET } from "./route";

function req(query: string) {
  return new Request(`http://localhost/api/brandability?${query}`);
}

describe("GET /api/brandability", () => {
  beforeEach(() => {
    checkBrandability.mockReset();
    checkRateLimit.mockReset();
    checkRateLimit.mockReturnValue({ ok: true, retryAfterSeconds: 0 });
  });

  it("returns 400 when name is missing", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name/i);
    expect(checkBrandability).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    checkRateLimit.mockReturnValue({ ok: false, retryAfterSeconds: 42 });
    const res = await GET(req("name=glowhut"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(checkBrandability).not.toHaveBeenCalled();
  });

  it("maps a missing Kilocode API key to 503", async () => {
    const err = new Error("no key");
    err.name = "KilocodeApiKeyMissingError";
    checkBrandability.mockRejectedValue(err);
    const res = await GET(req("name=glowhut"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/KILOCODE_API_KEY/);
  });

  it("maps a missing Serper API key to 503", async () => {
    const err = new Error("no key");
    err.name = "SerperApiKeyMissingError";
    checkBrandability.mockRejectedValue(err);
    const res = await GET(req("name=glowhut"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/SERPER_API_KEY/);
  });

  it("maps a missing Serpent API key to 503", async () => {
    const err = new Error("no key");
    err.name = "SerpentApiKeyMissingError";
    checkBrandability.mockRejectedValue(err);
    const res = await GET(req("name=glowhut"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/SERPENT_API_KEY/);
  });

  it("maps an unrecognized error to 500 with its message", async () => {
    checkBrandability.mockRejectedValue(new Error("something unexpected broke"));
    const res = await GET(req("name=glowhut"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("something unexpected broke");
  });

  it("maps insufficient Serpent credits to 402 with the original message", async () => {
    const err = new Error("out of credits");
    err.name = "SerpentInsufficientCreditsError";
    checkBrandability.mockRejectedValue(err);
    const res = await GET(req("name=glowhut"));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("out of credits");
  });

  it("maps a rate-limited search provider to 429 with a service-specific message", async () => {
    const err = new Error("serpent_rate_limited");
    err.name = "RateLimitError";
    checkBrandability.mockRejectedValue(err);
    const res = await GET(req("name=glowhut"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/apiserpent\.com/);
  });

  it("maps an AbortSignal timeout to 504", async () => {
    checkBrandability.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const res = await GET(req("name=glowhut"));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toMatch(/timed out/i);
  });

  it("returns 200 with the check result on success", async () => {
    checkBrandability.mockResolvedValue({ score: 72, summary: "solid" });
    const res = await GET(req("name=glowhut&word1=glow&word2=hut"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ score: 72, summary: "solid" });
    expect(checkBrandability).toHaveBeenCalledWith("glowhut", ["glow", "hut"], expect.anything(), expect.any(String));
  });

  it("returns 400 when name sanitizes down to nothing (e.g. all punctuation)", async () => {
    const res = await GET(req("name=!!!"));
    expect(res.status).toBe(400);
    expect(checkBrandability).not.toHaveBeenCalled();
  });

  it("passes through a region query param that's in the allowed REGIONS list", async () => {
    checkBrandability.mockResolvedValue({ score: 50, summary: "ok" });
    await GET(req("name=glowhut&region=gb"));
    expect(checkBrandability).toHaveBeenCalledWith("glowhut", undefined, expect.anything(), "gb");
  });
});
