import { afterEach, describe, expect, it, vi } from "vitest";
import { checkTiktokUsername } from "./tiktok";

function mockResponse(status: number, html = "") {
  return {
    status,
    text: async () => html,
  } as Response;
}

describe("checkTiktokUsername", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a page with a matching uniqueId to 'taken'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse(200, 'blah "uniqueId":"nike" blah'))
    );
    await expect(checkTiktokUsername("nike")).resolves.toBe("taken");
  });

  it("maps a page without a matching uniqueId to 'available' — even with the generic not-found boilerplate present", async () => {
    // Both a taken and a free page contain this exact boilerplate text
    // (see the module doc comment) — it's never a usable signal on its
    // own, only the presence/absence of the uniqueId field is.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse(200, "Couldn't find this account"))
    );
    await expect(checkTiktokUsername("somefreename")).resolves.toBe("available");
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(checkTiktokUsername("someuser")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("resolves any other non-200 status to 'unknown'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(checkTiktokUsername("someuser")).resolves.toBe("unknown");
  });

  it("doesn't match a different username's uniqueId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, '"uniqueId":"someoneelse"')));
    await expect(checkTiktokUsername("nike")).resolves.toBe("available");
  });

  it("escapes regex metacharacters in the username rather than letting them affect matching", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, '"uniqueId":"aXb"')));
    // If the dot in "a.b" were treated as a regex wildcard, this page
    // (which contains "aXb", not "a.b") would incorrectly match.
    await expect(checkTiktokUsername("a.b")).resolves.toBe("available");
  });

  // Round 9 added AbortSignal.any([signal, timeoutSignal]) so a caller's
  // own abort still cancels the request alongside the fetch timeout — every
  // test above only exercises the no-signal-passed branch (timeoutSignal
  // alone), which is not what discovery.ts actually calls this with.
  it("composes a caller-supplied AbortSignal with the fetch timeout, and still resolves normally", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, "Couldn't find this account"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await expect(checkTiktokUsername("someuser", controller.signal)).resolves.toBe("available");
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal).toBeInstanceOf(AbortSignal);
    expect(passedSignal.aborted).toBe(false);
  });

  it("the composed signal passed to fetch reflects the caller's own signal aborting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, "Couldn't find this account"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await checkTiktokUsername("someuser", controller.signal);
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal.aborted).toBe(true);
  });
});
