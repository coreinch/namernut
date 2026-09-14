import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KilocodeApiKeyMissingError, completeChat } from "./kilocode";

function mockResponse(status: number, body: unknown = {}) {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe("completeChat", () => {
  beforeEach(() => {
    vi.stubEnv("KILOCODE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws KilocodeApiKeyMissingError when no API key is configured", async () => {
    vi.stubEnv("KILOCODE_API_KEY", "");
    await expect(completeChat("hello")).rejects.toBeInstanceOf(KilocodeApiKeyMissingError);
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

  it("defaults to the free auto-router model when KILOCODE_MODEL is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { choices: [{ message: { content: "ok" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    await completeChat("hi");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("kilo-auto/free");
  });

  it("uses KILOCODE_MODEL when set", async () => {
    vi.stubEnv("KILOCODE_MODEL", "some/other-model:free");
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

  it("throws a KilocodeError on any other non-200 status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(500)));
    await expect(completeChat("hi")).rejects.toMatchObject({ name: "KilocodeError" });
  });

  it("throws a KilocodeError when the response has no message content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse(200, { choices: [] })));
    await expect(completeChat("hi")).rejects.toMatchObject({ name: "KilocodeError" });
  });
});
