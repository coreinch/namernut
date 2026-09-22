import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "./searchProvider";

const serperSearchMock = vi.fn<(query: string, signal?: AbortSignal) => Promise<SearchResult[]>>();
const serpentSearchMock = vi.fn<(query: string, signal?: AbortSignal) => Promise<SearchResult[]>>();

vi.mock("./serperSearch", () => ({
  serperSearch: (...args: Parameters<typeof serperSearchMock>) => serperSearchMock(...args),
}));
vi.mock("./serpentSearch", () => ({
  serpentSearch: (...args: Parameters<typeof serpentSearchMock>) => serpentSearchMock(...args),
}));

// Static import receives the mocked modules above, since vi.mock is hoisted
// by Vitest's transform above every other statement in this file.
import { search } from "./searchProvider";

describe("search", () => {
  beforeEach(() => {
    serperSearchMock.mockReset().mockResolvedValue([]);
    serpentSearchMock.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses serper when SEARCH_PROVIDER is unset", async () => {
    await search("foo");
    expect(serperSearchMock).toHaveBeenCalledWith("foo", undefined);
    expect(serpentSearchMock).not.toHaveBeenCalled();
  });

  it("uses serper when SEARCH_PROVIDER is explicitly \"serper\"", async () => {
    vi.stubEnv("SEARCH_PROVIDER", "serper");
    await search("foo");
    expect(serperSearchMock).toHaveBeenCalledWith("foo", undefined);
    expect(serpentSearchMock).not.toHaveBeenCalled();
  });

  it("uses serpent when SEARCH_PROVIDER is \"serpent\"", async () => {
    vi.stubEnv("SEARCH_PROVIDER", "serpent");
    await search("foo");
    expect(serpentSearchMock).toHaveBeenCalledWith("foo", undefined);
    expect(serperSearchMock).not.toHaveBeenCalled();
  });

  it("passes the abort signal through to the selected provider", async () => {
    vi.stubEnv("SEARCH_PROVIDER", "serpent");
    const controller = new AbortController();
    await search("foo", controller.signal);
    expect(serpentSearchMock).toHaveBeenCalledWith("foo", controller.signal);
  });

  it("throws on an unrecognized SEARCH_PROVIDER value", () => {
    vi.stubEnv("SEARCH_PROVIDER", "bing");
    expect(() => search("foo")).toThrow(/Unknown SEARCH_PROVIDER "bing"/);
  });
});
