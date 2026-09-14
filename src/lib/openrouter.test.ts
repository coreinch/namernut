import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterApiKeyMissingError, completeChat } from "./openrouter";

function mockResponse(status: number, body: unknown = {}) {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe("completeChat", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws OpenRouterApiKeyMissingError when no API key is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(completeChat("hello")).rejects.toBeInstanceOf(OpenRouterApiKeyMissingError);
  });

  it("returns the trimmed message content on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockResponse(200, { choices: [{ message: { content: "  hello there  \n" } }] })
      )
    );
    await expect(completeChat("hi")).resolves.toBe("hello there");
  });

  it("defaults to the free llama model when OPENROUTER_MODEL is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: "ok" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    await completeChat("hi");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("meta-llama/llama-3.1-8b-instruct:free");
  });

  it("uses OPENROUTER_MODEL when set", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "some/other-model:free");
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: "ok" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    await completeChat("hi");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("some/other-model:free");
  });

  it("throws a RateLimitError on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(429)));
    await expect(completeChat("hi")).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("throws an OpenRouterError on any other non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(completeChat("hi")).rejects.toMatchObject({ name: "OpenRouterError" });
  });

  it("throws an OpenRouterError when the response has no message content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { choices: [] })));
    await expect(completeChat("hi")).rejects.toMatchObject({ name: "OpenRouterError" });
  });
});
