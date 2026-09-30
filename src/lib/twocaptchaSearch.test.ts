import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwocaptchaApiKeyMissingError, twocaptchaSearch } from "./twocaptchaSearch";

function mockResponse(status: number, body: unknown = {}) {
  return { status, json: async () => body } as Response;
}

const OK = {
  status: "success",
  groups: {
    organic: {
      items: [
        { url: "https://a.example", title: "A", description: "desc a", position: 1 },
        { url: "https://b.example", title: "B", description: "desc b", position: 2 },
      ],
    },
  },
};

describe("twocaptchaSearch", () => {
  beforeEach(() => {
    vi.stubEnv("TWOCAPTCHA_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws TwocaptchaApiKeyMissingError when no API key is configured", async () => {
    vi.stubEnv("TWOCAPTCHA_API_KEY", "");
    await expect(twocaptchaSearch("foo", "us")).rejects.toBeInstanceOf(TwocaptchaApiKeyMissingError);
  });

  it("maps organic items to the shared SearchResult shape, with no context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, OK)));
    await expect(twocaptchaSearch("foo", "us")).resolves.toEqual({
      results: [
        { title: "A", description: "desc a", url: "https://a.example" },
        { title: "B", description: "desc b", url: "https://b.example" },
      ],
    });
  });

  it("POSTs a google_search task with a bearer key, the encoded query, the region as gl, and hl=en", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, OK));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await twocaptchaSearch("a b&c", "gb", signal);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://scraper.2captcha.com/tasks/sync");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body)).toEqual({
      task_type: "google_search",
      url: "https://www.google.com/search?q=a%20b%26c&gl=gb&hl=en",
      data_format: "raw",
      format: "json",
    });
  });

  it("fills missing fields with empty strings and returns an empty list when there are no organic items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(mockResponse(200, { status: "success", groups: { organic: { items: [{}] } } }))
    );
    await expect(twocaptchaSearch("foo", "us")).resolves.toEqual({ results: [{ title: "", description: "", url: "" }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { status: "success" })));
    await expect(twocaptchaSearch("foo", "us")).resolves.toEqual({ results: [] });
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(twocaptchaSearch("foo", "us")).rejects.toMatchObject({
      name: "RateLimitError",
      message: "twocaptcha_rate_limited",
    });
  });

  it("throws on other HTTP errors, and on a 200 whose task status isn't success (never an empty 'nothing found')", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(twocaptchaSearch("foo", "us")).rejects.toMatchObject({
      name: "TwocaptchaSearchError",
      message: "twocaptcha_search_failed_500",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { status: "error" })));
    await expect(twocaptchaSearch("foo", "us")).rejects.toThrow("twocaptcha_search_failed_error");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, {})));
    await expect(twocaptchaSearch("foo", "us")).rejects.toThrow("twocaptcha_search_failed_unknown");
  });
});
