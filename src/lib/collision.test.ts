import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "./searchProvider";

const searchMock = vi.fn<(query: string, signal?: AbortSignal) => Promise<SearchResult[]>>();
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
import { checkCollision, splitIntoWords, validateParts } from "./collision";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return { title: "t", description: "d", url: "https://example.test", ...overrides };
}

const DEFAULT_LLM_RESPONSE = "SCORE: 50\nSUMMARY: default verdict";

describe("checkCollision", () => {
  beforeEach(() => {
    searchMock.mockReset();
    completeChatMock.mockReset();
    // Every test needs a real LLM verdict now — there's no heuristic
    // fallback — so give one a default and let individual tests override it
    // (mockResolvedValueOnce, or a rejection) where the response matters.
    completeChatMock.mockResolvedValue(DEFAULT_LLM_RESPONSE);
  });

  it("runs only an unquoted search for the name when it doesn't split into two words", async () => {
    searchMock.mockResolvedValue([]);
    await checkCollision("fluidfew");
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("fluidfew", undefined);
  });

  it("skips the two-word search and doesn't attach a split when the name doesn't split into two dictionary words", async () => {
    searchMock.mockResolvedValue([]);
    const res = await checkCollision("fluidfew");
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(res.twoWordSplit).toBeUndefined();
    expect(res.twoWordResultCount).toBeUndefined();
  });

  it("also runs an unquoted two-word search when the name splits into two dictionary words", async () => {
    searchMock.mockResolvedValue([]);
    await checkCollision("catdog");
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock).toHaveBeenCalledWith("catdog", undefined);
    expect(searchMock).toHaveBeenCalledWith("cat dog", undefined);
  });

  it("attaches the two-word split and its result count to the returned result", async () => {
    searchMock
      .mockResolvedValueOnce([]) // unquoted
      .mockResolvedValueOnce(Array.from({ length: 4 }, () => result())); // "cat dog"
    const res = await checkCollision("catdog");
    expect(res.twoWordSplit).toBe("cat dog");
    expect(res.twoWordResultCount).toBe(4);
  });

  it("includes the two-word split results in the prompt sent to the LLM", async () => {
    searchMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([result({ title: "cat dog hit" })]);
    await checkCollision("catdog");
    const prompt = completeChatMock.mock.calls[0][0];
    expect(prompt).toContain("cat dog hit");
  });

  it("uses the LLM's score and summary verbatim", async () => {
    searchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue(
      "SCORE: 4\nSUMMARY: This name is fully absorbed by a major existing brand."
    );
    const res = await checkCollision("sadpitch");
    expect(res.rankabilityScore).toBe(4);
    expect(res.summary).toContain("major existing brand");
  });

  it("instructs the LLM to detect Google's silent query-override from the results themselves", async () => {
    searchMock.mockResolvedValue([]);
    await checkCollision("sadpitch");
    const prompt = completeChatMock.mock.calls[0][0];
    expect(prompt).toContain("silently substitutes");
  });

  it("throws when the LLM response doesn't match the expected SCORE/SUMMARY format", async () => {
    searchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue("I'm not sure, sorry!");
    await expect(checkCollision("fluidfew")).rejects.toMatchObject({ name: "KilocodeParseError" });
  });

  it("throws when the LLM score is out of range", async () => {
    searchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue("SCORE: 150\nSUMMARY: nonsense value");
    await expect(checkCollision("fluidfew")).rejects.toMatchObject({ name: "KilocodeParseError" });
  });

  it("propagates the error when the LLM call fails, rather than silently degrading to a guess", async () => {
    searchMock.mockResolvedValue([]);
    const err = new Error("kilocode_rate_limited");
    err.name = "RateLimitError";
    completeChatMock.mockRejectedValue(err);
    await expect(checkCollision("fluidfew")).rejects.toBe(err);
  });

  it("propagates a missing-key error from completeChat rather than falling back", async () => {
    searchMock.mockResolvedValue([]);
    const err = new Error("KILOCODE_API_KEY is not set");
    err.name = "KilocodeApiKeyMissingError";
    completeChatMock.mockRejectedValue(err);
    await expect(checkCollision("fluidfew")).rejects.toBe(err);
  });

  it("prefers two-word split results for topResults, falling back to unquoted when there are none", async () => {
    searchMock
      .mockResolvedValueOnce([]) // unquoted: none
      .mockResolvedValueOnce([result({ title: "two-word hit" })]); // "cat dog"
    const res = await checkCollision("catdog");
    expect(res.topResults).toEqual([result({ title: "two-word hit" })]);
  });

  it("prefers two-word split results for topResults even when unquoted also has hits", async () => {
    searchMock
      .mockResolvedValueOnce([result({ title: "unquoted hit" })])
      .mockResolvedValueOnce([result({ title: "two-word hit" })]); // "cat dog"
    const res = await checkCollision("catdog");
    expect(res.topResults).toEqual([result({ title: "two-word hit" })]);
  });

  it("uses the caller-supplied parts even for a word the dictionary doesn't have (e.g. a user keyword)", async () => {
    // "apps" isn't in the mocked pool (only cat/dog) and would never be
    // found by splitIntoWords, but it's a real keyword-tier split — see
    // buildKeywordTier in lib/candidates.ts — passed straight through as
    // Candidate.parts instead of re-derived from a dictionary lookup.
    searchMock.mockResolvedValue([]);
    await checkCollision("poetapps", ["poet", "apps"]);
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock).toHaveBeenCalledWith("poetapps", undefined);
    expect(searchMock).toHaveBeenCalledWith("poet apps", undefined);
  });

  it("falls back to splitIntoWords when no parts is given or it doesn't concatenate to name", async () => {
    searchMock.mockResolvedValue([]);
    await checkCollision("catdog", ["not", "matching"]);
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock).toHaveBeenCalledWith("cat dog", undefined);
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
