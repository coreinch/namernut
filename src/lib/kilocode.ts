/**
 * Thin wrapper around Kilo Gateway's chat-completions endpoint, used by
 * collision.ts to turn a candidate name's search results into a one-line
 * human-style verdict — real collision vs. coincidental noise — the same
 * judgment call made by hand, repeatedly, before this tool existed. Kilo
 * Gateway is OpenRouter-request-shape-compatible (same request/response
 * JSON), just a different endpoint, key, and model catalog — see
 * https://kilo.ai/docs. Defaults to kilo-auto/free (its free-tier
 * auto-router, which picks a free upstream model per request) so running
 * this costs nothing; list current models with GET
 * https://api.kilo.ai/api/gateway/v1/models if the default ever stops
 * being offered — plain "kilocode/free" is NOT a valid slug on this
 * gateway (it 402s as a paid model), unlike model ids on kilocode.ai's own
 * OpenRouter-proxy path.
 */
const ENDPOINT = "https://api.kilo.ai/api/gateway/v1/chat/completions";
const DEFAULT_MODEL = "kilo-auto/free";

export class KilocodeApiKeyMissingError extends Error {
  constructor() {
    super("KILOCODE_API_KEY is not set");
    this.name = "KilocodeApiKeyMissingError";
  }
}

interface KilocodeResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function completeChat(prompt: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.KILOCODE_API_KEY;
  if (!apiKey) throw new KilocodeApiKeyMissingError();
  const model = process.env.KILOCODE_MODEL || DEFAULT_MODEL;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
    signal,
  });

  if (res.status === 429) {
    const err = new Error("kilocode_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  if (res.status !== 200) {
    const err = new Error(`kilocode_failed_${res.status}`);
    err.name = "KilocodeError";
    throw err;
  }

  const data = (await res.json()) as KilocodeResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content || content.trim() === "") {
    const err = new Error("kilocode_empty_response");
    err.name = "KilocodeError";
    throw err;
  }
  return content.trim();
}
