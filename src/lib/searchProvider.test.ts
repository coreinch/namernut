import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "./searchProvider";

const serperSearchMock = vi.fn<(query: string, region: string, signal?: AbortSignal) => Promise<SearchResponse>>();
const serpentSearchMock = vi.fn<(query: string, region: string, signal?: AbortSignal) => Promise<SearchResponse>>();

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
    serperSearchMock.mockReset().mockResolvedValue({ results: [] });
    serpentSearchMock.mockReset().mockResolvedValue({ results: [] });
  });

  it("defaults to serper when no providerOverride is given", async () => {
    await search("foo", "us");
    expect(serperSearchMock).toHaveBeenCalledWith("foo", "us", undefined);
    expect(serpentSearchMock).not.toHaveBeenCalled();
  });

  it("uses serper when providerOverride is explicitly \"serper\"", async () => {
    await search("foo", "us", undefined, "serper");
    expect(serperSearchMock).toHaveBeenCalledWith("foo", "us", undefined);
    expect(serpentSearchMock).not.toHaveBeenCalled();
  });

  it("uses serpent when providerOverride is \"serpent\"", async () => {
    await search("foo", "us", undefined, "serpent");
    expect(serpentSearchMock).toHaveBeenCalledWith("foo", "us", undefined);
    expect(serperSearchMock).not.toHaveBeenCalled();
  });

  it("passes the region through to the selected provider", async () => {
    await search("foo", "gb", undefined, "serpent");
    expect(serpentSearchMock).toHaveBeenCalledWith("foo", "gb", undefined);
  });

  it("passes the abort signal through to the selected provider", async () => {
    const controller = new AbortController();
    await search("foo", "us", controller.signal, "serpent");
    expect(serpentSearchMock).toHaveBeenCalledWith("foo", "us", controller.signal);
  });

  it("throws on an unrecognized providerOverride value", () => {
    expect(() => search("foo", "us", undefined, "bing")).toThrow(/Unknown search provider "bing"/);
  });
});
