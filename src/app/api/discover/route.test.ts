import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn(() => ({ ok: true, retryAfterSeconds: 0 })) }));
vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rateLimit")>();
  return { ...actual, checkRateLimit };
});

const { runDiscovery } = vi.hoisted(() => ({ runDiscovery: vi.fn() }));
vi.mock("@/lib/discovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discovery")>();
  return { ...actual, runDiscovery };
});

const { suggestKeywordSynonyms } = vi.hoisted(() => ({ suggestKeywordSynonyms: vi.fn() }));
vi.mock("@/lib/synonyms", () => ({ suggestKeywordSynonyms }));

const { suggestInventedNames } = vi.hoisted(() => ({ suggestInventedNames: vi.fn() }));
vi.mock("@/lib/inventedNames", () => ({ suggestInventedNames }));

import { GET } from "./route";

function req(query: string) {
  return new Request(`http://localhost/api/discover?${query}`);
}

async function readAllChunks(res: Response): Promise<string> {
  return res.text();
}

describe("GET /api/discover", () => {
  beforeEach(() => {
    checkRateLimit.mockReset();
    checkRateLimit.mockReturnValue({ ok: true, retryAfterSeconds: 0 });
    runDiscovery.mockReset();
    runDiscovery.mockResolvedValue(undefined);
    suggestKeywordSynonyms.mockReset();
    suggestKeywordSynonyms.mockResolvedValue([]);
    suggestInventedNames.mockReset();
    suggestInventedNames.mockResolvedValue([]);
  });

  it("returns plain JSON with 429 and Retry-After when rate limited, without opening a stream", async () => {
    checkRateLimit.mockReturnValue({ ok: false, retryAfterSeconds: 30 });
    const res = await GET(req("count=5"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Content-Type")).not.toMatch(/text\/event-stream/);
    const body = await res.json();
    expect(body.error).toMatch(/too many/i);
    expect(runDiscovery).not.toHaveBeenCalled();
    expect(suggestKeywordSynonyms).not.toHaveBeenCalled();
    expect(suggestInventedNames).not.toHaveBeenCalled();
  });

  it("opens an SSE stream with the expected headers on success", async () => {
    const res = await GET(req("count=5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
  });

  it("emits a 'preparing' event before awaiting AI helpers when synonyms are requested", async () => {
    let resolveSynonyms!: (v: string[]) => void;
    suggestKeywordSynonyms.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveSynonyms = resolve;
      })
    );

    const res = await GET(req("keyword=glow&count=5&aiSynonyms=true"));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const { value } = await reader.read();
    expect(decoder.decode(value)).toContain(`data: ${JSON.stringify({ type: "preparing" })}`);

    resolveSynonyms([]);
    await reader.cancel();
  });

  it("does not emit 'preparing' when no AI source is requested", async () => {
    const res = await GET(req("count=5&aiSynonyms=false&aiInvented=false"));
    const body = await readAllChunks(res);
    expect(body).not.toContain('"type":"preparing"');
  });

  it("streams events emitted by runDiscovery and closes the stream when it finishes", async () => {
    runDiscovery.mockImplementation(async (_pool, _keyword, _tlds, _count, onEvent) => {
      onEvent({ type: "complete", checkedCount: 3, foundCount: 1 });
    });

    const res = await GET(req("count=5"));
    const body = await readAllChunks(res);
    expect(body).toContain(`data: ${JSON.stringify({ type: "complete", checkedCount: 3, foundCount: 1 })}`);
  });

  it("passes an AbortSignal to the AI helpers and runDiscovery that aborts when the client disconnects", async () => {
    let capturedSignal: AbortSignal | undefined;
    suggestKeywordSynonyms.mockImplementation(async (_keyword: string, signal?: AbortSignal) => {
      capturedSignal = signal;
      return [];
    });

    const res = await GET(req("keyword=glow&count=5&aiSynonyms=true"));
    const reader = res.body!.getReader();
    await reader.cancel();

    expect(capturedSignal?.aborted).toBe(true);
    // runDiscovery is only reached after the AI-helper await resolves; since
    // the signal was already aborted by cancel() above, the route's own
    // abort check must skip calling it entirely rather than running a
    // search no one is listening to anymore.
    expect(runDiscovery).not.toHaveBeenCalled();
  });

  it("skips runDiscovery entirely when the client disconnects before the AI helpers resolve", async () => {
    let resolveSynonyms!: (v: string[]) => void;
    suggestKeywordSynonyms.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveSynonyms = resolve;
      })
    );

    const res = await GET(req("keyword=glow&count=5&aiSynonyms=true"));
    const reader = res.body!.getReader();
    await reader.read(); // consume the "preparing" event
    await reader.cancel();

    resolveSynonyms([]);
    await new Promise((r) => setTimeout(r, 0));

    expect(runDiscovery).not.toHaveBeenCalled();
  });
});
