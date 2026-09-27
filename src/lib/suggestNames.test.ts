import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeChatMock = vi.fn<(prompt: string, signal?: AbortSignal, temperature?: number) => Promise<string>>();

vi.mock("./kilocode", () => ({
  completeChat: (...args: Parameters<typeof completeChatMock>) => completeChatMock(...args),
}));

// Static imports receive the mocked module above, since vi.mock is hoisted
// by Vitest's transform above every other statement in this file.
import { suggestSynonymsAndInvented } from "./suggestNames";

describe("suggestSynonymsAndInvented", () => {
  beforeEach(() => {
    completeChatMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns empty arrays without ever calling the LLM when KILOCODE_API_KEY is unset", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    const result = await suggestSynonymsAndInvented("fast");
    expect(result).toEqual({ synonyms: [], invented: [] });
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("splits the single response into synonyms and invented words by section header", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue(
      ["SYNONYMS:", "quick", "rapid", "swift", "INVENTED:", "zuvio", "fovixia", "devosix"].join("\n")
    );
    const result = await suggestSynonymsAndInvented("fast");
    expect(result.synonyms).toEqual(["quick", "rapid", "swift"]);
    expect(result.invented).toEqual(["zuvio", "fovixia", "devosix"]);
    expect(completeChatMock).toHaveBeenCalledTimes(1);
  });

  it("excludes the literal keyword and dedupes within each section", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue(["SYNONYMS:", "fast", "quick", "quick", "INVENTED:", "zuvio", "zuvio"].join("\n"));
    const result = await suggestSynonymsAndInvented("fast");
    expect(result.synonyms).toEqual(["quick"]);
    expect(result.invented).toEqual(["zuvio"]);
  });

  it("returns a partial result when only one section is present", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue(["SYNONYMS:", "quick", "rapid"].join("\n"));
    const result = await suggestSynonymsAndInvented("fast");
    expect(result.synonyms).toEqual(["quick", "rapid"]);
    expect(result.invented).toEqual([]);
  });

  it("returns empty arrays (not a rejection) when the LLM call fails", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockRejectedValue(new Error("rate limited"));
    const result = await suggestSynonymsAndInvented("fast");
    expect(result).toEqual({ synonyms: [], invented: [] });
  });
});
