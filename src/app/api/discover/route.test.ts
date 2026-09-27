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

const { suggestSynonymsAndInvented } = vi.hoisted(() => ({ suggestSynonymsAndInvented: vi.fn() }));
vi.mock("@/lib/suggestNames", () => ({ suggestSynonymsAndInvented }));

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
    suggestSynonymsAndInvented.mockReset();
    suggestSynonymsAndInvented.mockResolvedValue({ synonyms: [], invented: [] });
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
    expect(suggestSynonymsAndInvented).not.toHaveBeenCalled();
  });

  it("opens an SSE stream with the expected headers on success", async () => {
    const res = await GET(req("count=5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
  });

  it("emits a 'preparing' event before awaiting AI helpers when synonyms are requested", async () => {
    let resolveCombined!: (v: { synonyms: string[]; invented: string[] }) => void;
    suggestSynonymsAndInvented.mockReturnValue(
      new Promise<{ synonyms: string[]; invented: string[] }>((resolve) => {
        resolveCombined = resolve;
      })
    );

    const res = await GET(req("keyword=glow&count=5&aiSynonyms=true"));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const { value } = await reader.read();
    expect(decoder.decode(value)).toContain(`data: ${JSON.stringify({ type: "preparing" })}`);

    resolveCombined({ synonyms: [], invented: [] });
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
    let resolveCombined!: (v: { synonyms: string[]; invented: string[] }) => void;
    // A manually-controlled pending promise (rather than an immediately-
    // resolving one) pins down the ordering explicitly: cancel() is
    // guaranteed to run before the AI call resolves, instead of racing
    // against however many microtask ticks the combined single-await path
    // happens to take versus the old two-call Promise.all.
    suggestSynonymsAndInvented.mockImplementation(async (_keyword: string, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<{ synonyms: string[]; invented: string[] }>((resolve) => {
        resolveCombined = resolve;
      });
    });

    const res = await GET(req("keyword=glow&count=5&aiSynonyms=true"));
    const reader = res.body!.getReader();
    await reader.read(); // consume the "preparing" event
    await reader.cancel();

    expect(capturedSignal?.aborted).toBe(true);

    resolveCombined({ synonyms: [], invented: [] });
    await new Promise((r) => setTimeout(r, 0));

    // runDiscovery is only reached after the AI-helper await resolves; since
    // the signal was already aborted by cancel() above, the route's own
    // abort check must skip calling it entirely rather than running a
    // search no one is listening to anymore.
    expect(runDiscovery).not.toHaveBeenCalled();
  });

  it("skips runDiscovery entirely when the client disconnects before the AI helpers resolve", async () => {
    let resolveCombined!: (v: { synonyms: string[]; invented: string[] }) => void;
    suggestSynonymsAndInvented.mockReturnValue(
      new Promise<{ synonyms: string[]; invented: string[] }>((resolve) => {
        resolveCombined = resolve;
      })
    );

    const res = await GET(req("keyword=glow&count=5&aiSynonyms=true"));
    const reader = res.body!.getReader();
    await reader.read(); // consume the "preparing" event
    await reader.cancel();

    resolveCombined({ synonyms: [], invented: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(runDiscovery).not.toHaveBeenCalled();
  });

  it("uses the combined synonyms+invented call when both AI sources are enabled for a keyword search", async () => {
    suggestSynonymsAndInvented.mockResolvedValue({ synonyms: ["glimmer"], invented: ["zuvio"] });

    await GET(req("keyword=glow&count=5&aiSynonyms=true&aiInvented=true"));

    expect(suggestSynonymsAndInvented).toHaveBeenCalledWith("glow", expect.any(AbortSignal));
    expect(suggestKeywordSynonyms).not.toHaveBeenCalled();
    expect(suggestInventedNames).not.toHaveBeenCalled();
    expect(runDiscovery).toHaveBeenCalledWith(
      expect.anything(),
      "glow",
      expect.anything(),
      5,
      expect.any(Function),
      expect.any(AbortSignal),
      expect.anything(),
      expect.anything(),
      ["glimmer"],
      ["zuvio"],
      expect.anything()
    );
  });

  it("falls back to the standalone calls when only one AI source is enabled", async () => {
    suggestKeywordSynonyms.mockResolvedValue(["glimmer"]);

    await GET(req("keyword=glow&count=5&aiSynonyms=true&aiInvented=false"));

    expect(suggestSynonymsAndInvented).not.toHaveBeenCalled();
    expect(suggestKeywordSynonyms).toHaveBeenCalledWith("glow", expect.any(AbortSignal));
    expect(suggestInventedNames).not.toHaveBeenCalled();
  });

  it("falls back to the standalone invented-names call when there's no keyword", async () => {
    suggestInventedNames.mockResolvedValue(["zuvio"]);

    await GET(req("count=5&aiInvented=true"));

    expect(suggestSynonymsAndInvented).not.toHaveBeenCalled();
    expect(suggestKeywordSynonyms).not.toHaveBeenCalled();
    expect(suggestInventedNames).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
  });
});
