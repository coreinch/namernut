import { afterEach, describe, expect, it, vi } from "vitest";
import { checkNpmPackageName } from "./npm";

function mockResponse(status: number) {
  return { status } as Response;
}

describe("checkNpmPackageName", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps 404 to 'available'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(404)));
    await expect(checkNpmPackageName("some-free-name")).resolves.toBe("available");
  });

  it("maps 200 to 'taken'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200)));
    await expect(checkNpmPackageName("react")).resolves.toBe("taken");
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(checkNpmPackageName("somename")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("resolves any other unexpected status to 'unknown'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(checkNpmPackageName("somename")).resolves.toBe("unknown");
  });

  it("hits the registry with the encoded package name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    await checkNpmPackageName("some name");
    expect(fetchMock.mock.calls[0][0]).toBe("https://registry.npmjs.org/some%20name");
  });

  it("composes a caller-supplied AbortSignal with the fetch timeout, and still resolves normally", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await expect(checkNpmPackageName("somename", controller.signal)).resolves.toBe("available");
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal).toBeInstanceOf(AbortSignal);
    expect(passedSignal.aborted).toBe(false);
  });

  it("the composed signal passed to fetch reflects the caller's own signal aborting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await checkNpmPackageName("somename", controller.signal);
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal.aborted).toBe(true);
  });
});
