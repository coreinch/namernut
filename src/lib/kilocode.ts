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

async function completeChatOnce(
  prompt: string,
  apiKey: string,
  model: string,
  temperature: number,
  signal?: AbortSignal
): Promise<{ content: string } | { timedOut: true }> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
      }),
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
  } catch (err) {
    // Only our own REQUEST_TIMEOUT_MS counts as "timed out" here, not the
    // caller's own signal firing (e.g. the user hit Stop, or checkBrandability's
    // outer abort) — that's a real cancellation the caller asked for, not a
    // hung model, and completeChatOnce's own caller below must never retry it.
    if (timeoutSignal.aborted) return { timedOut: true };
    throw err;
  }

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
  return { content: content.trim() };
}

/**
 * Retries exactly once, and only on our own REQUEST_TIMEOUT_MS firing — the
 * specific, empirically-confirmed failure mode of kilo-auto/free (see
 * REQUEST_TIMEOUT_MS's own comment): a rotated-through free upstream model
 * hanging with zero response, not an error. A retry gets a fresh shot at the
 * router picking a different (responsive) free model. Deliberately NOT
 * retried: a 429 (still rate-limited a moment later) or any other
 * KilocodeError (a real failure a second identical request won't fix) —
 * retrying those would just spend another request for no benefit. Without
 * this, a single hung free-model pick silently degraded every caller
 * (suggestKeywordSynonyms, suggestInventedNames, checkBrandability) straight
 * to their no-AI fallback — confirmed directly: a keyword whose literal
 * dictionary-pairing space is thin and heavily domain-squatted (e.g.
 * "studio") could swing between finding a full batch of results (when the
 * AI call succeeded) and "No matches found" (when it silently timed out)
 * from one run to the next, with nothing in the UI hinting that AI
 * augmentation was the actual difference.
 */
export async function completeChat(prompt: string, signal?: AbortSignal, temperature: number = 0.2): Promise<string> {
  const apiKey = process.env.KILOCODE_API_KEY;
  if (!apiKey) throw new KilocodeApiKeyMissingError();
  const model = process.env.KILOCODE_MODEL || DEFAULT_MODEL;

  const first = await completeChatOnce(prompt, apiKey, model, temperature, signal);
  if ("content" in first) return first.content;

  const second = await completeChatOnce(prompt, apiKey, model, temperature, signal);
  if ("content" in second) return second.content;

  const err = new Error("kilocode_timeout");
  err.name = "KilocodeError";
  throw err;
}
