import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SerperApiKeyMissingError, serperSearch } from "./serperSearch";

function mockResponse(status: number, body: unknown = {}) {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe("serperSearch", () => {
  beforeEach(() => {
    vi.stubEnv("SERPER_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws SerperApiKeyMissingError when no API key is configured", async () => {
    vi.stubEnv("SERPER_API_KEY", "");
    await expect(serperSearch("foo")).rejects.toBeInstanceOf(SerperApiKeyMissingError);
  });

  it("maps organic results to the simplified SerperResult shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, {
          organic: [
            { title: "A", snippet: "desc a", link: "https://a.example" },
            { title: "B", snippet: "desc b", link: "https://b.example" },
          ],
        })
      )
    );
    await expect(serperSearch("foo")).resolves.toEqual([
      { title: "A", description: "desc a", url: "https://a.example" },
      { title: "B", description: "desc b", url: "https://b.example" },
    ]);
  });

  it("returns an empty array when the response has no organic results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, {})));
    await expect(serperSearch("foo")).resolves.toEqual([]);
  });

  it("sends the API key as X-API-KEY and the query as 'q' in a POST body, pinned to gl=us", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await serperSearch("my query");
    const [urlArg, initArg] = fetchMock.mock.calls[0];
    const init = initArg as RequestInit;
    expect(urlArg).toBe("https://google.serper.dev/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-API-KEY": "test-key" });
    expect(JSON.parse(init.body as string)).toEqual({ q: "my query", gl: "us" });
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(serperSearch("foo")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("throws a SerperSearchError on any other non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(serperSearch("foo")).rejects.toMatchObject({ name: "SerperSearchError" });
  });
});
