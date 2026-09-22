import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SerpentApiKeyMissingError, SerpentInsufficientCreditsError, serpentSearch } from "./serpentSearch";

function mockResponse(status: number, body: unknown = {}) {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe("serpentSearch", () => {
  beforeEach(() => {
    vi.stubEnv("SERPENT_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws SerpentApiKeyMissingError when no API key is configured", async () => {
    vi.stubEnv("SERPENT_API_KEY", "");
    await expect(serpentSearch("foo", "us")).rejects.toBeInstanceOf(SerpentApiKeyMissingError);
  });

  it("maps results.organic to the simplified SearchResult shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          success: true,
          results: {
            organic: [
              { title: "A", snippet: "desc a", url: "https://a.example", position: 1 },
              { title: "B", snippet: "desc b", url: "https://b.example", position: 2 },
            ],
          },
        })
      )
    );
    await expect(serpentSearch("foo", "us")).resolves.toEqual([
      { title: "A", description: "desc a", url: "https://a.example" },
      { title: "B", description: "desc b", url: "https://b.example" },
    ]);
  });

  it("returns an empty array when the response has no organic results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { success: true, results: {} })));
    await expect(serpentSearch("foo", "us")).resolves.toEqual([]);
  });

  it("sends the API key as X-API-Key, the query as 'q', and the region as 'country', restricted to the google engine", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await serpentSearch("my query", "gb");
    const [urlArg, initArg] = fetchMock.mock.calls[0];
    const url = urlArg as URL;
    expect(url.origin + url.pathname).toBe("https://apiserpent.com/api/search");
    expect(url.searchParams.get("q")).toBe("my query");
    expect(url.searchParams.get("engine")).toBe("google");
    expect(url.searchParams.get("country")).toBe("gb");
    expect((initArg as RequestInit).headers).toMatchObject({ "X-API-Key": "test-key" });
  });

  it("throws SerpentInsufficientCreditsError on 402", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(402)));
    await expect(serpentSearch("foo", "us")).rejects.toBeInstanceOf(SerpentInsufficientCreditsError);
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(serpentSearch("foo", "us")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("throws a SerpentSearchError on any other non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(401)));
    await expect(serpentSearch("foo", "us")).rejects.toMatchObject({ name: "SerpentSearchError" });
  });
});
