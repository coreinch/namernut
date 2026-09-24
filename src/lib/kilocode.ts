/**
 * Thin wrapper around Kilo Gateway's chat-completions endpoint, used by
 * brandability.ts to turn a candidate name's search results into a one-line
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

// kilo-auto/free (the default model — see DEFAULT_MODEL above) can pick a
// free upstream that never responds at all: confirmed directly (2026-09-23)
// with a plain curl against ENDPOINT, no response and no connection error
// either, twice in a row, each left hanging a full 25-30s until curl's own
// --max-time cut it off. Without a timeout here, that hang is unbounded —
// fetch has no default one — which is exactly what left real searches
// stuck forever on "Getting AI ideas…" (see the discover route, which
// awaits this with nothing else to unstick it). Both callers (synonyms.ts,
// inventedNames.ts) already catch and fall back to [] on any error here,
// so timing out just triggers that existing, already-safe path.
//
// 15s (the original value) turned out too tight even with a specific,
// reliable model pinned instead of relying on kilo-auto/free's rotation:
// confirmed directly against the live production endpoint (2026-09-24),
// 9/10 real brandability checks succeeded, but one legitimately timed out
// at 15.9s and another only barely made it at 15.66s. checkBrandability's
// own completeChat call happens AFTER its search-provider fetch finishes
// (the prompt needs those results), so a slow-but-working model plus any
// nontrivial search latency in front of it can genuinely exceed 15s
// without either step actually being broken. Bumped to 30s.
//
// Back on kilo-auto/free as of this value (2026-09-24, by request) rather
// than a pinned model — worth flagging: two of its rotated-through free
// models were confirmed to hang with zero response at all for 25-40s+ in
// direct testing the same day, so a 30s timeout doesn't fully cover them;
// it mainly helps the case above (a working-but-slow response) and bounds
// the wait before falling back, it doesn't make a genuinely broken
// upstream succeed.
const REQUEST_TIMEOUT_MS = 30000;

export async function completeChat(prompt: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.KILOCODE_API_KEY;
  if (!apiKey) throw new KilocodeApiKeyMissingError();
  const model = process.env.KILOCODE_MODEL || DEFAULT_MODEL;

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
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
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
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
