import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDomain } from "./rdap";

function mockResponse(status: number, body: unknown = {}) {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe("checkDomain", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps RDAP 404 to 'available' (static TLD, no bootstrap needed)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(404)));
    await expect(checkDomain("somefreename", "com")).resolves.toBe("available");
  });

  // .io/.me run RDAP via Identity Digital but aren't in IANA's bootstrap
  // registry, so they're hardcoded in STATIC_RDAP_BASE like .com/.net —
  // this should query that base directly, never touching the bootstrap URL.
  it.each(["io", "me"])("resolves .%s via its static RDAP base, no bootstrap fetch", async (tld) => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkDomain("somefreename", tld)).resolves.toBe("available");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).not.toContain("data.iana.org");
  });

  it("maps RDAP 200 to 'taken'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200)));
    await expect(checkDomain("google", "com")).resolves.toBe("taken");
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(checkDomain("somename", "net")).rejects.toMatchObject({
      name: "RateLimitError",
    });
  });

  it("maps any other status to 'unknown'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(checkDomain("somename", "net")).resolves.toBe("unknown");
  });

  // Regression test for a real bug: a transient bootstrap-registry fetch
  // failure used to be cached forever (the resolved promise held an empty
  // map with no retry), silently disabling RDAP for every non-static TLD
  // until process restart. It must retry on the next call instead.
  it("retries the IANA bootstrap fetch after a transient failure instead of caching it forever", async () => {
    const bootstrapBody = {
      services: [[["org"], ["https://rdap.example-registry.test/rdap/"]]],
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error("simulated network failure")))
      .mockImplementationOnce(() => Promise.resolve(mockResponse(200, bootstrapBody)))
      .mockImplementationOnce(() => Promise.resolve(mockResponse(404)));
    vi.stubGlobal("fetch", fetchMock);

    // First call: bootstrap fetch fails -> inconclusive -> "unknown".
    await expect(checkDomain("somename", "org")).resolves.toBe("unknown");

    // Second call: bootstrap fetch is retried (not permanently cached as
    // failed) and succeeds, so the actual RDAP lookup can proceed.
    await expect(checkDomain("somename", "org")).resolves.toBe("available");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
