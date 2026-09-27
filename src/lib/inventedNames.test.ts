import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeChatMock = vi.fn<(prompt: string, signal?: AbortSignal, temperature?: number) => Promise<string>>();

vi.mock("./kilocode", () => ({
  completeChat: (...args: Parameters<typeof completeChatMock>) => completeChatMock(...args),
}));

// Static imports receive the mocked module above, since vi.mock is hoisted
// by Vitest's transform above every other statement in this file.
import { suggestInventedNames } from "./inventedNames";

describe("suggestInventedNames", () => {
  beforeEach(() => {
    completeChatMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns [] without ever calling the LLM when KILOCODE_API_KEY is unset", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    const result = await suggestInventedNames("fast");
    expect(result).toEqual([]);
    expect(completeChatMock).not.toHaveBeenCalled();
  });

  it("works with no keyword at all", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue("zuvio\nfovixia\ndevosix");
    const result = await suggestInventedNames(undefined);
    expect(result).toEqual(["zuvio", "fovixia", "devosix"]);
  });

  it("parses one lowercase word per line, dropping anything malformed", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue("Zuvio\nfovixia\n\n1. devosix\nnexbara!\n");
    const result = await suggestInventedNames("fast");
    expect(result).toEqual(["zuvio", "fovixia", "devosix", "nexbara"]);
  });

  it("dedupes and drops words outside the 4-10 character range", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockResolvedValue("ab\nzuvio\nzuvio\nabcdefghijklmnopqrstuvwxyz");
    const result = await suggestInventedNames("fast");
    expect(result).toEqual(["zuvio"]);
  });

  it("caps the result at 40 words even if the LLM returns more", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
    const words = alphabet.flatMap((a) => alphabet.map((b) => `word${a}${b}`)).slice(0, 50);
    completeChatMock.mockResolvedValue(words.join("\n"));
    const result = await suggestInventedNames("fast");
    expect(result.length).toBe(40);
  });

  it("returns [] (not a rejection) when the LLM call fails", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
    completeChatMock.mockRejectedValue(new Error("rate limited"));
    const result = await suggestInventedNames("fast");
    expect(result).toEqual([]);
  });
});
