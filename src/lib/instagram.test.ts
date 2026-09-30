import { afterEach, describe, expect, it, vi } from "vitest";
import { checkInstagramUsername } from "./instagram";

const undiciMock = vi.hoisted(() => ({
  fetch: vi.fn(),
  ProxyAgent: vi.fn(function (this: { url: string }, url: string) {
    this.url = url;
  }),
}));
vi.mock("undici", () => undiciMock);

function mockResponse(status: number, url: string, html = "") {
  return {
    status,
    url,
    text: async () => html,
  } as Response;
}

const PROFILE_URL = "https://www.instagram.com/someuser/";
const LOGIN_URL = "https://www.instagram.com/accounts/login/?next=%2Fsomeuser%2F";

describe("checkInstagramUsername", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INSTAGRAM_SESSION_ID;
    delete process.env.INSTAGRAM_PROXY_URL;
    delete process.env.INSTAGRAM_TWOCAPTCHA;
    delete process.env.TWOCAPTCHA_API_KEY;
    undiciMock.fetch.mockReset();
  });

  it("routes through the proxy via undici (and never the global fetch) when INSTAGRAM_PROXY_URL is set", async () => {
    process.env.INSTAGRAM_PROXY_URL = "http://user:pass@proxy.example:1234";
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    undiciMock.fetch.mockResolvedValue(mockResponse(200, PROFILE_URL, '<meta property="og:title" content="nike">'));
    await expect(checkInstagramUsername("nike")).resolves.toBe("taken");
    await checkInstagramUsername("nike");
    expect(globalFetch).not.toHaveBeenCalled();
    expect(undiciMock.fetch.mock.calls[0][1].dispatcher.url).toBe("http://user:pass@proxy.example:1234");
    // The ProxyAgent is created once per proxy URL and reused.
    expect(undiciMock.ProxyAgent).toHaveBeenCalledTimes(1);
  });

  it("via 2captcha: public embed is 'taken', null contextJSON is 'unknown' (never 'available')", async () => {
    process.env.INSTAGRAM_TWOCAPTCHA = "1";
    process.env.TWOCAPTCHA_API_KEY = "k";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, "", '..."contextJSON":"{\\"context\\":{\\"username\\":\\"nike\\"}}"...'))
      .mockResolvedValueOnce(mockResponse(200, "", '..."contextJSON":null...'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkInstagramUsername("nike")).resolves.toBe("taken");
    await expect(checkInstagramUsername("zzqxv")).resolves.toBe("unknown");
    expect(fetchMock.mock.calls[0][0]).toBe("https://scraper.2captcha.com/tasks/sync");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).url).toBe("https://www.instagram.com/nike/embed/");
  });

  it("via 2captcha: rechecks on a login page, then succeeds or throws LoginWallError", async () => {
    process.env.INSTAGRAM_TWOCAPTCHA = "1";
    process.env.TWOCAPTCHA_API_KEY = "k";
    const login = mockResponse(200, "", '<link href="https://www.instagram.com/accounts/login/?next=x">');
    const ok = mockResponse(200, "", '"contextJSON":"{\\"context\\":{\\"username\\":\\"nike\\"}}"');
    const fetchMock = vi.fn().mockResolvedValueOnce(login).mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch", fetchMock);
    await expect(checkInstagramUsername("nike")).resolves.toBe("taken");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(login));
    await expect(checkInstagramUsername("nike")).rejects.toMatchObject({ name: "LoginWallError" });
  });

  it("maps a page with og:title metadata to 'taken'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse(200, PROFILE_URL, '<meta property="og:title" content="nike">'))
    );
    await expect(checkInstagramUsername("nike")).resolves.toBe("taken");
  });

  it("maps a page without og:title metadata to 'available'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, PROFILE_URL, "<html></html>")));
    await expect(checkInstagramUsername("somefreename")).resolves.toBe("available");
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429, PROFILE_URL)));
    await expect(checkInstagramUsername("someuser")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("throws a LoginWallError when redirected to the login page, rather than misreading its generic og:title as 'taken'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse(200, LOGIN_URL, '<meta property="og:title" content="Instagram">'))
    );
    await expect(checkInstagramUsername("someuser")).rejects.toMatchObject({ name: "LoginWallError" });
  });

  it("resolves any other non-200 status to 'unknown'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500, PROFILE_URL)));
    await expect(checkInstagramUsername("someuser")).resolves.toBe("unknown");
  });

  it("sends no Cookie header when INSTAGRAM_SESSION_ID is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, PROFILE_URL, "<html></html>"));
    vi.stubGlobal("fetch", fetchMock);
    await checkInstagramUsername("someuser");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Cookie).toBeUndefined();
  });

  it("sends an authenticated Cookie header when INSTAGRAM_SESSION_ID is set", async () => {
    process.env.INSTAGRAM_SESSION_ID = "abc123";
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, PROFILE_URL, "<html></html>"));
    vi.stubGlobal("fetch", fetchMock);
    await checkInstagramUsername("someuser");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Cookie).toBe("sessionid=abc123");
  });

  // Round 9 added AbortSignal.any([signal, timeoutSignal]) so a caller's
  // own abort still cancels the request alongside the fetch timeout — every
  // test above only exercises the no-signal-passed branch (timeoutSignal
  // alone), which is not what discovery.ts actually calls this with.
  it("composes a caller-supplied AbortSignal with the fetch timeout, and still resolves normally", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, PROFILE_URL, "<html></html>"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await expect(checkInstagramUsername("someuser", controller.signal)).resolves.toBe("available");
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal).toBeInstanceOf(AbortSignal);
    expect(passedSignal.aborted).toBe(false);
  });

  it("the composed signal passed to fetch reflects the caller's own signal aborting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, PROFILE_URL, "<html></html>"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await checkInstagramUsername("someuser", controller.signal);
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal.aborted).toBe(true);
  });
});
