import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BraveResult } from "./braveSearch";

const braveSearchMock = vi.fn<(query: string, signal?: AbortSignal) => Promise<BraveResult[]>>();
const completeChatMock = vi.fn<(prompt: string, signal?: AbortSignal) => Promise<string>>();

vi.mock("./braveSearch", () => ({
  braveSearch: (...args: Parameters<typeof braveSearchMock>) => braveSearchMock(...args),
}));
vi.mock("./openrouter", () => ({
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
import { checkCollision, splitIntoWords } from "./collision";

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
    vi.stubEnv("OPENROUTER_API_KEY", "");
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
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock.mockResolvedValue([]);
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("scores lower as the unquoted result count rises, via the heuristic", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock.mockResolvedValueOnce(Array.from({ length: 9 }, () => result())); // unquoted: 9
    const res = await checkCollision("oddago");
    // 100 - (9*4) = 64
    expect(res.rankabilityScore).toBe(64);
  });

  it("penalizes a two-word split hit more than the same count of unquoted hits, via the heuristic", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce(Array.from({ length: 3 }, () => result())) // unquoted: 3
      .mockResolvedValueOnce(Array.from({ length: 3 }, () => result())); // "cat dog": 3
    const res = await checkCollision("catdog");
    // 100 - (3*4) - (3*8) = 64, well below what 6 unquoted-only hits would cost (76)
    expect(res.rankabilityScore).toBe(64);
  });

  it("never returns a negative score even when the count is very high, via the heuristic", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock.mockResolvedValueOnce(Array.from({ length: 30 }, () => result()));
    const res = await checkCollision("sadpitch");
    expect(res.rankabilityScore).toBeGreaterThanOrEqual(0);
  });

  it("uses the LLM score when OPENROUTER_API_KEY is set and it responds in the expected format", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue(
      "SCORE: 4\nSUMMARY: This name is fully absorbed by a major existing brand."
    );
    const res = await checkCollision("sadpitch");
    expect(res.rankabilityScore).toBe(4);
    expect(res.summary).toContain("major existing brand");
  });

  it("falls back to the heuristic when the LLM response doesn't match the expected format", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue("I'm not sure, sorry!");
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
  });

  it("falls back to the heuristic when the LLM score is out of range", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockResolvedValue("SCORE: 150\nSUMMARY: nonsense value");
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
  });

  it("falls back to the heuristic when the LLM call throws", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    braveSearchMock.mockResolvedValue([]);
    completeChatMock.mockRejectedValue(new Error("rate limited"));
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
  });

  it("prefers two-word split results for topResults, falling back to unquoted when there are none", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce([]) // unquoted: none
      .mockResolvedValueOnce([result({ title: "two-word hit" })]); // "cat dog"
    const res = await checkCollision("catdog");
    expect(res.topResults).toEqual([result({ title: "two-word hit" })]);
  });

  it("prefers two-word split results for topResults even when unquoted also has hits", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce([result({ title: "unquoted hit" })])
      .mockResolvedValueOnce([result({ title: "two-word hit" })]); // "cat dog"
    const res = await checkCollision("catdog");
    expect(res.topResults).toEqual([result({ title: "two-word hit" })]);
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
