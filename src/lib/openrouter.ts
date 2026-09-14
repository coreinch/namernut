/**
 * Thin wrapper around OpenRouter's chat-completions endpoint, used by
 * collision.ts to turn a candidate name's search results into a one-line
 * human-style verdict — real collision vs. coincidental noise — the same
 * judgment call made by hand, repeatedly, before this tool existed.
 * Defaults to a free-tier model (see OPENROUTER_MODEL below) so running
 * this costs nothing; browse current free models at
 * https://openrouter.ai/models?max_price=0 if the default ever stops being
 * offered.
 */
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export class OpenRouterApiKeyMissingError extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is not set");
    this.name = "OpenRouterApiKeyMissingError";
  }
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function completeChat(prompt: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterApiKeyMissingError();
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

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
    const err = new Error("openrouter_rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  if (res.status !== 200) {
    const err = new Error(`openrouter_failed_${res.status}`);
    err.name = "OpenRouterError";
    throw err;
  }

  const data = (await res.json()) as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content || content.trim() === "") {
    const err = new Error("openrouter_empty_response");
    err.name = "OpenRouterError";
    throw err;
  }
  return content.trim();
}
