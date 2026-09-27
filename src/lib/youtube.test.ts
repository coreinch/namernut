import { afterEach, describe, expect, it, vi } from "vitest";
import { checkYoutubeHandle } from "./youtube";

function mockResponse(status: number) {
  return { status } as Response;
}

describe("checkYoutubeHandle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps 404 to 'available'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(404)));
    await expect(checkYoutubeHandle("somefreehandle")).resolves.toBe("available");
  });

  it("maps 200 to 'taken'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200)));
    await expect(checkYoutubeHandle("mrbeast")).resolves.toBe("taken");
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(checkYoutubeHandle("somehandle")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("resolves any other unexpected status to 'unknown'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(checkYoutubeHandle("somehandle")).resolves.toBe("unknown");
  });

  it("hits the channel page with the encoded handle", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    await checkYoutubeHandle("some handle");
    expect(fetchMock.mock.calls[0][0]).toBe("https://www.youtube.com/@some%20handle");
  });

  it("composes a caller-supplied AbortSignal with the fetch timeout, and still resolves normally", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await expect(checkYoutubeHandle("somehandle", controller.signal)).resolves.toBe("available");
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal).toBeInstanceOf(AbortSignal);
    expect(passedSignal.aborted).toBe(false);
  });

  it("the composed signal passed to fetch reflects the caller's own signal aborting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(404));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await checkYoutubeHandle("somehandle", controller.signal);
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    expect(passedSignal.aborted).toBe(true);
  });
});
