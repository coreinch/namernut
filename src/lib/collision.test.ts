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

// Static imports receive the mocked modules above, since vi.mock is hoisted
// by Vitest's transform above every other statement in this file.
import { checkCollision } from "./collision";

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

  it("runs a quoted and an unquoted Brave search for the name", async () => {
    braveSearchMock.mockResolvedValue([]);
    await checkCollision("fluidfew");
    expect(braveSearchMock).toHaveBeenCalledWith('"fluidfew"', undefined);
    expect(braveSearchMock).toHaveBeenCalledWith("fluidfew", undefined);
  });

  it("scores 100 with zero results on both searches, via the heuristic", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock.mockResolvedValue([]);
    const res = await checkCollision("fluidfew");
    expect(res.rankabilityScore).toBe(100);
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("scores lower as quoted/unquoted result counts rise, via the heuristic", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce([result()]) // quoted: 1
      .mockResolvedValueOnce(Array.from({ length: 9 }, () => result())); // unquoted: 9
    const res = await checkCollision("oddago");
    // 100 - (1*7) - (9*3) = 66
    expect(res.rankabilityScore).toBe(66);
  });

  it("never returns a negative score even when counts are very high, via the heuristic", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce(Array.from({ length: 10 }, () => result()))
      .mockResolvedValueOnce(Array.from({ length: 10 }, () => result()));
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

  it("prefers quoted results for topResults, falling back to unquoted when there are none", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    braveSearchMock
      .mockResolvedValueOnce([]) // quoted: none
      .mockResolvedValueOnce([result({ title: "unquoted hit" })]); // unquoted
    const res = await checkCollision("foo");
    expect(res.topResults).toEqual([result({ title: "unquoted hit" })]);
  });
});
