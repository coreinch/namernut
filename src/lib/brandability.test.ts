import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "./searchProvider";

const searchMock =
  vi.fn<(query: string, region: string, signal: AbortSignal | undefined, provider: string) => Promise<SearchResult[]>>();
const completeChatMock = vi.fn<(prompt: string, signal?: AbortSignal) => Promise<string>>();

vi.mock("./searchProvider", () => ({
  search: (...args: Parameters<typeof searchMock>) => searchMock(...args),
}));
vi.mock("./kilocode", () => ({
  completeChat: (...args: Parameters<typeof completeChatMock>) => completeChatMock(...args),
}));
// A small fixed pool so splitIntoWords is deterministic: only "catdog"
// (and other names built from these two words) can ever split, so the
// rest of the suite's names are unaffected.
vi.mock("./dictionary", () => ({
  getWordPool: () => [
    { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    { word: "dog", langs: ["english"], definition: "", common: true, noun: true },
  ],
}));

// Static imports receive the mocked modules above, since vi.mock is hoisted
// by Vitest's transform above every other statement in this file.
import { checkBrandability, DEFAULT_PROVIDER, DEFAULT_REGION, splitIntoWords, validateParts } from "./brandability";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return { title: "t", description: "d", url: "https://example.test", ...overrides };
}

const DEFAULT_LLM_RESPONSE = "SCORE: 50\nSUMMARY: default verdict";

describe("checkBrandability", () => {
  beforeEach(() => {
    searchMock.mockReset();
    completeChatMock.mockReset();
    // Every test needs a real LLM verdict now — there's no heuristic
    // fallback — so give one a default and let individual tests override it
    // (mockResolvedValueOnce, or a rejection) where the response matters.
    completeChatMock.mockResolvedValue(DEFAULT_LLM_RESPONSE);
    searchMock.mockResolvedValue([]);
  });

  it("runs a single unquoted search in the default region when the name doesn't split into two words", async () => {
    await checkBrandability("fluidfew");
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("fluidfew", DEFAULT_REGION, undefined, DEFAULT_PROVIDER);
  });

  it("doesn't attach a split when the name doesn't split into two dictionary words", async () => {
    const res = await checkBrandability("fluidfew");
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(res.twoWordSplit).toBeUndefined();
  });

  it("merges the two-word split into the same query as an unquoted, parenthesized OR term instead of a second search", async () => {
    await checkBrandability("catdog");
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("catdog OR (cat dog)", DEFAULT_REGION, undefined, DEFAULT_PROVIDER);
  });

  it("uses the caller-supplied region for the merged query instead of the default", async () => {
    await checkBrandability("catdog", undefined, undefined, "gb");
    expect(searchMock).toHaveBeenCalledWith("catdog OR (cat dog)", "gb", undefined, DEFAULT_PROVIDER);
  });

  it("uses the caller-supplied provider for the merged query instead of the default", async () => {
    await checkBrandability("catdog", undefined, undefined, DEFAULT_REGION, "serper");
    expect(searchMock).toHaveBeenCalledWith("catdog OR (cat dog)", DEFAULT_REGION, undefined, "serper");
  });

  it("exposes which region and provider were checked", async () => {
    const res = await checkBrandability("fluidfew", undefined, undefined, "au", "serper");
    expect(res.region).toBe("au");
    expect(res.provider).toBe("serper");
  });

  it("attaches the two-word split and the merged query's result count to the returned result", async () => {
    searchMock.mockResolvedValue(Array.from({ length: 4 }, () => result()));
    const res = await checkBrandability("catdog");
    expect(res.twoWordSplit).toBe("cat dog");
    expect(res.resultCount).toBe(4);
  });

  it("includes the region's results in the prompt sent to the LLM, labeled by region", async () => {
    searchMock.mockImplementation(async () => [result({ title: "gb hit" })]);
    await checkBrandability("fluidfew", undefined, undefined, "gb");
    const prompt = completeChatMock.mock.calls[0][0];
    expect(prompt).toContain("region: gb");
    expect(prompt).toContain("gb hit");
  });

  it("includes the merged query's results in the prompt sent to the LLM, and notes the two-word reading", async () => {
    searchMock.mockResolvedValue([result({ title: "cat dog hit" })]);
    await checkBrandability("catdog");
    const prompt = completeChatMock.mock.calls[0][0];
    expect(prompt).toContain("cat dog hit");
    expect(prompt).toContain("also reads as the two real dictionary words");
  });

  it("uses the LLM's score and summary verbatim", async () => {
    completeChatMock.mockResolvedValue(
      "SCORE: 4\nSUMMARY: This name is fully absorbed by a major existing brand."
    );
    const res = await checkBrandability("sadpitch");
    expect(res.brandabilityScore).toBe(4);
    expect(res.summary).toContain("major existing brand");
  });

  it("instructs the LLM to detect Google's silent query-override from the results themselves, noting region-dependence", async () => {
    await checkBrandability("sadpitch");
    const prompt = completeChatMock.mock.calls[0][0];
    expect(prompt).toContain("silently substitutes");
    expect(prompt).toContain("region-dependent");
  });

  it("instructs the LLM to check its own brand knowledge independently of the search results", async () => {
    await checkBrandability("sadpitch");
    const prompt = completeChatMock.mock.calls[0][0];
    expect(prompt).toContain("independently of the search results");
    expect(prompt).toContain("duck brand");
  });

  it("throws when the LLM response doesn't match the expected SCORE/SUMMARY format", async () => {
    completeChatMock.mockResolvedValue("I'm not sure, sorry!");
    await expect(checkBrandability("fluidfew")).rejects.toMatchObject({ name: "KilocodeParseError" });
  });

  it("throws when the LLM score is out of range", async () => {
    completeChatMock.mockResolvedValue("SCORE: 150\nSUMMARY: nonsense value");
    await expect(checkBrandability("fluidfew")).rejects.toMatchObject({ name: "KilocodeParseError" });
  });

  it("propagates the error when the LLM call fails, rather than silently degrading to a guess", async () => {
    const err = new Error("kilocode_rate_limited");
    err.name = "RateLimitError";
    completeChatMock.mockRejectedValue(err);
    await expect(checkBrandability("fluidfew")).rejects.toBe(err);
  });

  it("propagates a missing-key error from completeChat rather than falling back", async () => {
    const err = new Error("KILOCODE_API_KEY is not set");
    err.name = "KilocodeApiKeyMissingError";
    completeChatMock.mockRejectedValue(err);
    await expect(checkBrandability("fluidfew")).rejects.toBe(err);
  });

  it("returns the merged query's top 5 results as topResults", async () => {
    searchMock.mockResolvedValue(Array.from({ length: 8 }, (_, i) => result({ title: `hit ${i}` })));
    const res = await checkBrandability("catdog");
    expect(res.topResults).toEqual(Array.from({ length: 5 }, (_, i) => result({ title: `hit ${i}` })));
  });

  it("uses the caller-supplied parts even for a word the dictionary doesn't have (e.g. a user keyword)", async () => {
    // "apps" isn't in the mocked pool (only cat/dog) and would never be
    // found by splitIntoWords, but it's a real keyword-tier split — see
    // buildKeywordTier in lib/candidates.ts — passed straight through as
    // Candidate.parts instead of re-derived from a dictionary lookup.
    await checkBrandability("poetapps", ["poet", "apps"]);
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("poetapps OR (poet apps)", DEFAULT_REGION, undefined, DEFAULT_PROVIDER);
  });

  it("falls back to splitIntoWords when no parts is given or it doesn't concatenate to name", async () => {
    await checkBrandability("catdog", ["not", "matching"]);
    expect(searchMock).toHaveBeenCalledWith("catdog OR (cat dog)", DEFAULT_REGION, undefined, DEFAULT_PROVIDER);
  });
});

describe("validateParts", () => {
  it("accepts parts that concatenate to name", () => {
    expect(validateParts("poetapps", ["poet", "apps"])).toEqual(["poet", "apps"]);
  });

  it("returns null when parts is undefined", () => {
    expect(validateParts("catdog", undefined)).toBeNull();
  });

  it("returns null when parts don't concatenate back to name", () => {
    expect(validateParts("catdog", ["cat", "fish"])).toBeNull();
  });

  it("returns null when either part is empty", () => {
    expect(validateParts("catdog", ["", "catdog"])).toBeNull();
  });
});

describe("splitIntoWords", () => {
  it("splits a name into two real dictionary words when such a split exists", () => {
    expect(splitIntoWords("catdog")).toEqual(["cat", "dog"]);
  });

  it("returns null when no split makes both halves real words", () => {
    expect(splitIntoWords("fluidfew")).toBeNull();
  });

  it("returns null for a name too short to split into two 2+ letter words", () => {
    expect(splitIntoWords("cat")).toBeNull();
  });
});
