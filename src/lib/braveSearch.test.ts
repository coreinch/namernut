import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BraveApiKeyMissingError, braveSearch } from "./braveSearch";

function mockResponse(status: number, body: unknown = {}) {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe("braveSearch", () => {
  beforeEach(() => {
    vi.stubEnv("BRAVE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws BraveApiKeyMissingError when no API key is configured", async () => {
    vi.stubEnv("BRAVE_API_KEY", "");
    await expect(braveSearch("foo")).rejects.toBeInstanceOf(BraveApiKeyMissingError);
  });

  it("maps web.results to the simplified BraveResult shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          web: {
            results: [
              { title: "A", description: "desc a", url: "https://a.example" },
              { title: "B", description: "desc b", url: "https://b.example" },
            ],
          },
        })
      )
    );
    await expect(braveSearch("foo")).resolves.toEqual([
      { title: "A", description: "desc a", url: "https://a.example" },
      { title: "B", description: "desc b", url: "https://b.example" },
    ]);
  });

  it("returns an empty array when the response has no web.results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, {})));
    await expect(braveSearch("foo")).resolves.toEqual([]);
  });

  it("sends the API key as X-Subscription-Token and the query as 'q'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await braveSearch("my query");
    const [urlArg, initArg] = fetchMock.mock.calls[0];
    const url = urlArg as URL;
    expect(url.searchParams.get("q")).toBe("my query");
    expect((initArg as RequestInit).headers).toMatchObject({ "X-Subscription-Token": "test-key" });
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(braveSearch("foo")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("throws a BraveSearchError on any other non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(braveSearch("foo")).rejects.toMatchObject({ name: "BraveSearchError" });
  });
});
