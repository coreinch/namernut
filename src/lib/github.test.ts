import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGithubUsername } from "./github";

function mockResponse(status: number, headers: Record<string, string> = {}) {
  return {
    status,
    headers: new Headers(headers),
  } as Response;
}

describe("checkGithubUsername", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps 404 to 'available'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(404)));
    await expect(checkGithubUsername("somefreename")).resolves.toBe("available");
  });

  it("maps 200 to 'taken'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200)));
    await expect(checkGithubUsername("torvalds")).resolves.toBe("taken");
  });

  it("throws a RateLimitError on 403 with X-RateLimit-Remaining: 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(403, { "x-ratelimit-remaining": "0" })));
    await expect(checkGithubUsername("someuser")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("does not treat every 403 as a rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(403, { "x-ratelimit-remaining": "42" })));
    await expect(checkGithubUsername("someuser")).resolves.toBe("unknown");
  });

  it("resolves any other unexpected status to 'unknown'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(checkGithubUsername("someuser")).resolves.toBe("unknown");
  });

  it("hits the documented users endpoint with the encoded username", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    await checkGithubUsername("some user");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/users/some%20user");
  });
});
