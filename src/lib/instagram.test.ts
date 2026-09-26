import { afterEach, describe, expect, it, vi } from "vitest";
import { checkInstagramUsername } from "./instagram";

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
});
