import { parseGates, runDiscovery, type DiscoveryEvent } from "@/lib/discovery";
import { getSelectedPool, parseLangs, parseMaxLength } from "@/lib/dictionary";
import { parseCount, parseKeyword, parseTlds } from "@/lib/candidates";

export const dynamic = "force-dynamic";

function sse(event: DiscoveryEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Each GET opens one independent, isolated search: its own random seed and
// local counters, scoped entirely to this connection. Nothing is shared
// with other tabs or persisted across requests — closing the connection
// (Stop button, tab close, navigation) aborts this search only.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const langs = parseLangs(searchParams.get("langs"));
  const pool = getSelectedPool(langs);
  const maxLength = parseMaxLength(searchParams.get("maxLength"));
  const keyword = parseKeyword(searchParams.get("keyword"));
  const count = parseCount(searchParams.get("count"));
  const tlds = parseTlds(searchParams.get("tlds"));
  const gates = parseGates(searchParams);

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // controller already closed
        }
      }, 20000);

      runDiscovery(pool, keyword, tlds, count, (event) => {
        try {
          controller.enqueue(encoder.encode(sse(event)));
        } catch {
          // controller already closed
        }
      }, abortController.signal, maxLength, gates).finally(() => {
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
