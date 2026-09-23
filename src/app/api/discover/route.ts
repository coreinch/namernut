import { parseGates, runDiscovery, type DiscoveryEvent } from "@/lib/discovery";
import { getSelectedPool, parseLangs, parseMaxLength } from "@/lib/dictionary";
import { parseCount, parseKeyword, parseTlds } from "@/lib/candidates";
import { suggestKeywordSynonyms } from "@/lib/synonyms";
import { suggestInventedNames } from "@/lib/inventedNames";
import { alternateSpellings } from "@/lib/alternateSpelling";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Each search costs up to two Kilocode LLM calls (AI synonyms + AI
// invented names) plus, if autoCheck is on client-side, one brandability
// request per found result — capped separately by BRANDABILITY_RATE_LIMIT
// in the brandability route. This limit exists purely to bound that LLM
// spend per visitor; 20/hour comfortably covers real exploratory use
// (trying several keywords) while blocking a scripted hammer.
const DISCOVER_RATE_LIMIT = 20;
const DISCOVER_RATE_WINDOW_MS = 60 * 60 * 1000;

function sse(event: DiscoveryEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Each GET opens one independent, isolated search: its own random seed and
// local counters, scoped entirely to this connection. Nothing is shared
// with other tabs or persisted across requests — closing the connection
// (Stop button, tab close, navigation) aborts this search only.
export async function GET(request: Request) {
  const rateLimit = checkRateLimit(`discover:${getClientIp(request)}`, DISCOVER_RATE_LIMIT, DISCOVER_RATE_WINDOW_MS);
  if (!rateLimit.ok) {
    // Plain JSON, not an SSE event — see the res.ok check page.tsx's
    // start() does before ever treating the body as a stream.
    return Response.json(
      { error: "Too many searches — try again in a bit." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const langs = parseLangs(searchParams.get("langs"));
  const pool = getSelectedPool(langs);
  const maxLength = parseMaxLength(searchParams.get("maxLength"));
  const keyword = parseKeyword(searchParams.get("keyword"));
  const count = parseCount(searchParams.get("count"));
  const tlds = parseTlds(searchParams.get("tlds"));
  const gates = parseGates(searchParams);
  const useAiSynonyms = searchParams.get("aiSynonyms") !== "false";
  const useAiInvented = searchParams.get("aiInvented") !== "false";
  // Opposite default polarity from the two AI toggles above: this is
  // opt-in (absent/malformed input means off), since it's a newer, less
  // proven candidate source. No LLM call behind it, though (see
  // alternateSpellings in lib/alternateSpelling.ts), so it's computed
  // synchronously below rather than joining the Promise.all AI-fetch below.
  const useAltSpellings = searchParams.get("altSpellings") === "true";
  const altSpellings = keyword && useAltSpellings ? alternateSpellings(keyword) : [];
  const willFetchSynonyms = Boolean(keyword && useAiSynonyms);
  const willFetchInvented = useAiInvented;

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    // Async, and doing the AI-fetch work itself (rather than awaiting it
    // before this stream is even constructed): the previous version
    // awaited suggestKeywordSynonyms/suggestInventedNames before returning
    // the Response at all, which meant the client's fetch() didn't resolve
    // — no connection, no heartbeat, nothing — for however long that call
    // took. Doing it here instead means the connection opens immediately,
    // so a "preparing" event (see DiscoveryEvent) can go out right away,
    // distinct from silence, before these two (still the only) awaits.
    async start(controller) {
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // controller already closed
        }
      }, 20000);

      const emit = (event: DiscoveryEvent) => {
        try {
          controller.enqueue(encoder.encode(sse(event)));
        } catch {
          // controller already closed
        }
      };

      if (willFetchSynonyms || willFetchInvented) emit({ type: "preparing" });

      // Run in parallel when both apply, rather than doubling the added
      // latency. Each is one call per search (not per candidate), and
      // buildCandidateSpace needs the full lists synchronously to build
      // its tiers, so there's nothing to stream incrementally here beyond
      // the "preparing" event above. Both take the same abort signal as
      // runDiscovery below, so hitting Stop during this wait actually
      // cancels the in-flight LLM calls instead of letting them finish
      // uselessly.
      const [aiSynonyms, inventedNames] = await Promise.all([
        keyword && useAiSynonyms
          ? suggestKeywordSynonyms(keyword, abortController.signal)
          : Promise.resolve<string[]>([]),
        willFetchInvented ? suggestInventedNames(keyword, abortController.signal) : Promise.resolve<string[]>([]),
      ]);

      if (abortController.signal.aborted) {
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
        return;
      }

      runDiscovery(
        pool,
        keyword,
        tlds,
        count,
        emit,
        abortController.signal,
        maxLength,
        gates,
        aiSynonyms,
        inventedNames,
        altSpellings
      ).finally(() => {
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      abortController.abort();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
