import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkTwitterHandle } = vi.hoisted(() => ({ checkTwitterHandle: vi.fn() }));
vi.mock("@/lib/twitter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/twitter")>();
  return { ...actual, checkTwitterHandle };
});

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn(() => ({ ok: true, retryAfterSeconds: 0 })) }));
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...actual, checkRateLimit };
});

import { GET } from "./route";

function req(query: string) {
  return new Request(`http://localhost/api/twitter?${query}`);
}

describe("GET /api/twitter", () => {
  beforeEach(() => {
    checkTwitterHandle.mockReset();
    checkRateLimit.mockReset();
    checkRateLimit.mockReturnValue({ ok: true, retryAfterSeconds: 0 });
  });

  it("returns 400 when handle is missing", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/handle/i);
    expect(checkTwitterHandle).not.toHaveBeenCalled();
  });

  it("returns 400 when handle sanitizes down to nothing (e.g. all punctuation)", async () => {
    const res = await GET(req("handle=%21%21%21"));
    expect(res.status).toBe(400);
    expect(checkTwitterHandle).not.toHaveBeenCalled();
  });

  it("strips disallowed characters and caps at 15, preserving case and underscores", async () => {
    checkTwitterHandle.mockResolvedValue("available");
    await GET(req("handle=Some_Handle!!!-with-way-too-many-characters"));
    // "Some_Handle" (11) + "with" (4) = 15 chars, exactly the real X handle
    // length cap — everything after "with" is dropped.
    expect(checkTwitterHandle).toHaveBeenCalledWith("Some_Handlewith", expect.anything());
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    checkRateLimit.mockReturnValue({ ok: false, retryAfterSeconds: 42 });
    const res = await GET(req("handle=glowhut"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(checkTwitterHandle).not.toHaveBeenCalled();
  });

  it("maps a rate-limited x.com check to 429", async () => {
    const err = new Error("twitter_rate_limited");
    err.name = "RateLimitError";
    checkTwitterHandle.mockRejectedValue(err);
    const res = await GET(req("handle=glowhut"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/x\.com/);
  });

  it("maps an AbortSignal timeout to 504", async () => {
    checkTwitterHandle.mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError")
    );
    const res = await GET(req("handle=glowhut"));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toMatch(/timed out/i);
  });

  it("maps an unrecognized error to 500 with its message", async () => {
    checkTwitterHandle.mockRejectedValue(new Error("something unexpected broke"));
    const res = await GET(req("handle=glowhut"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("something unexpected broke");
  });

  it("returns 200 with the handle and status on success", async () => {
    checkTwitterHandle.mockResolvedValue("available");
    const res = await GET(req("handle=glowhut"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ handle: "glowhut", status: "available" });
    expect(checkTwitterHandle).toHaveBeenCalledWith("glowhut", expect.anything());
  });
});
