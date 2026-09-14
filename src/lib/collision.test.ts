import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BraveResult } from "./braveSearch";

const braveSearchMock = vi.fn<(query: string, signal?: AbortSignal) => Promise<BraveResult[]>>();
const completeChatMock = vi.fn<(prompt: string, signal?: AbortSignal) => Promise<string>>();

vi.mock("./braveSearch", () => ({
  braveSearch: (...args: Parameters<typeof braveSearchMock>) => braveSearchMock(...args),
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

function result(overrides: Partial<BraveResult> = {}): BraveResult {
  return { title: "t", description: "d", url: "https://example.test", ...overrides };
}

describe("checkCollision", () => {
  beforeEach(() => {
    braveSearchMock.mockReset();
    completeChatMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs only an unquoted Brave search for the name when it doesn't split into two words", async () => {
    braveSearchMock.mockResolvedValue([]);
    await checkCollision("fluidfew");
    expect(braveSearchMock).toHaveBeenCalledTimes(1);
    expect(braveSearchMock).toHaveBeenCalledWith("fluidfew", undefined);
  });

  it("skips the two-word search and doesn't attach a split when the name doesn't split into two dictionary words", async () => {
    braveSearchMock.mockResolvedValue([]);
    const res = await checkCollision("fluidfew");
    expect(braveSearchMock).toHaveBeenCalledTimes(1);
    expect(res.twoWordSplit).toBeUndefined();
    expect(res.twoWordResultCount).toBeUndefined();
  });

  it("also runs an unquoted two-word search when the name splits into two dictionary words", async () => {
    braveSearchMock.mockResolvedValue([]);
    await checkCollision("catdog");
    expect(braveSearchMock).toHaveBeenCalledTimes(2);
    expect(braveSearchMock).toHaveBeenCalledWith("catdog", undefined);
    expect(braveSearchMock).toHaveBeenCalledWith("cat dog", undefined);
  });

  it("factors the two-word search's result count into the heuristic score and summary, weighted higher than unquoted", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce([]) // unquoted: 0
      .mockResolvedValueOnce(Array.from({ length: 4 }, () => result())); // "cat dog": 4
    const res = await checkCollision("catdog");
    // 100 - (0*4) - (4*8) = 68
    expect(res.rankabilityScore).toBe(68);
    expect(res.twoWordSplit).toBe("cat dog");
    expect(res.twoWordResultCount).toBe(4);
    expect(res.summary).toContain('"cat dog"');
  });

  it("scores 100 with zero results on both searches, via the heuristic", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    braveSearchMock.mockResolvedValue([]);
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("scores lower as the unquoted result count rises, via the heuristic", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    braveSearchMock.mockResolvedValueOnce(Array.from({ length: 9 }, () => result())); // unquoted: 9
    const res = await checkCollision("oddago");
    // 100 - (9*4) = 64
    expect(res.rankabilityScore).toBe(64);
  });

  it("penalizes a two-word split hit more than the same count of unquoted hits, via the heuristic", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce(Array.from({ length: 3 }, () => result())) // unquoted: 3
      .mockResolvedValueOnce(Array.from({ length: 3 }, () => result())); // "cat dog": 3
    const res = await checkCollision("catdog");
    // 100 - (3*4) - (3*8) = 64, well below what 6 unquoted-only hits would cost (76)
    expect(res.rankabilityScore).toBe(64);
  });

  it("never returns a negative score even when the count is very high, via the heuristic", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    braveSearchMock.mockResolvedValueOnce(Array.from({ length: 30 }, () => result()));
    const res = await checkCollision("sadpitch");
    expect(res.rankabilityScore).toBeGreaterThanOrEqual(0);
  });

  it("uses the LLM score when KILOCODE_API_KEY is set and it responds in the expected format", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue(
      "SCORE: 4\nSUMMARY: This name is fully absorbed by a major existing brand."
    );
    const res = await checkCollision("sadpitch");
    expect(res.rankabilityScore).toBe(4);
    expect(res.summary).toContain("major existing brand");
  });

  it("falls back to the heuristic when the LLM response doesn't match the expected format", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue("I'm not sure, sorry!");
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
  });

  it("falls back to the heuristic when the LLM score is out of range", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue("SCORE: 150\nSUMMARY: nonsense value");
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
  });

  it("falls back to the heuristic when the LLM call throws", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockRejectedValue(new Error("rate limited"));
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
  });

  it("names Kilo Gateway's rate limit specifically, rather than misleadingly asking to set an already-configured key", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    const err = new Error("rate limited");
    err.name = "RateLimitError";
    completeChatMock.mockRejectedValue(err);
    const res = await checkCollision("fluidfew");
    expect(res.summary).toContain("free-tier daily request limit");
    expect(res.summary).not.toContain("Set KILOCODE_API_KEY");
  });

  it("gives a generic failure note (not the rate-limit or missing-key message) for any other LLM error", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockRejectedValue(new Error("network hiccup"));
    const res = await checkCollision("fluidfew");
    expect(res.summary).toContain("didn't return a usable verdict");
    expect(res.summary).not.toContain("Set KILOCODE_API_KEY");
    expect(res.summary).not.toContain("free-tier daily request limit");
  });

  it("prefers two-word split results for topResults, falling back to unquoted when there are none", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce([]) // unquoted: none
      .mockResolvedValueOnce([result({ title: "two-word hit" })]); // "cat dog"
    const res = await checkCollision("catdog");
    expect(res.topResults).toEqual([result({ title: "two-word hit" })]);
  });

  it("prefers two-word split results for topResults even when unquoted also has hits", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    braveSearchMock
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
    braveSearchMock.mockResolvedValue([]);
    await checkCollision("poetapps", ["poet", "apps"]);
    expect(braveSearchMock).toHaveBeenCalledTimes(2);
    expect(braveSearchMock).toHaveBeenCalledWith("poetapps", undefined);
    expect(braveSearchMock).toHaveBeenCalledWith("poet apps", undefined);
  });

  it("falls back to splitIntoWords when no parts is given or it doesn't concatenate to name", async () => {
    braveSearchMock.mockResolvedValue([]);
    await checkCollision("catdog", ["not", "matching"]);
    expect(braveSearchMock).toHaveBeenCalledTimes(2);
    expect(braveSearchMock).toHaveBeenCalledWith("cat dog", undefined);
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
