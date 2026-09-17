import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeChatMock = vi.fn<(prompt: string, signal?: AbortSignal) => Promise<string>>();

vi.mock("./kilocode", () => ({
  completeChat: (...args: Parameters<typeof completeChatMock>) => completeChatMock(...args),
}));

// Static imports receive the mocked module above, since vi.mock is hoisted
// by Vitest's transform above every other statement in this file.
import { suggestKeywordSynonyms } from "./synonyms";

describe("suggestKeywordSynonyms", () => {
  beforeEach(() => {
    completeChatMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns [] without ever calling the LLM when KILOCODE_API_KEY is unset", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    const result = await suggestKeywordSynonyms("fast");
    expect(result).toEqual([]);
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("parses one lowercase word per line, dropping anything malformed", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue("Quick\nrapid\n\n1. swift\nblaze!\n");
    const result = await suggestKeywordSynonyms("fast");
    expect(result).toEqual(["quick", "rapid", "swift", "blaze"]);
  });

  it("excludes the literal keyword itself and dedupes", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue("fast\nquick\nquick\nFAST");
    const result = await suggestKeywordSynonyms("fast");
    expect(result).toEqual(["quick"]);
  });

  it("drops words outside the 2-15 character range", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue("a\nquick\nsupercalifragilisticexpialidocious");
    const result = await suggestKeywordSynonyms("fast");
    expect(result).toEqual(["quick"]);
  });

  it("caps the result at 6 words even if the LLM returns more", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue(
      ["quick", "rapid", "swift", "blaze", "dash", "zoom", "speedy", "hasty"].join("\n")
    );
    const result = await suggestKeywordSynonyms("fast");
    expect(result.length).toBe(6);
  });

  it("returns [] (not a rejection) when the LLM call fails", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockRejectedValue(new Error("rate limited"));
    const result = await suggestKeywordSynonyms("fast");
    expect(result).toEqual([]);
  });
});
