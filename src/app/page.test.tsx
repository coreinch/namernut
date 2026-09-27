// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Home from "./page";

const STORAGE_KEY = "namernut:state:v1";
const LEGACY_KEY = "namerag:state:v1";
const OLDER_LEGACY_KEY = "domain-finder:state:v1";

// /api/stats fires on every mount (debounced by 250ms — see page.tsx), and
// jsdom doesn't implement fetch at all — stub it so that debounced call
// resolves quietly instead of throwing once its timer fires. Cleanup below
// unmounts before the 250ms debounce ever elapses in practice, but this
// keeps these tests independent of that timing.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ total: 0, matching: 0 }) })
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function openArchiveTab() {
  fireEvent.click(screen.getByRole("tab", { name: /^archive/i }));
}

describe("Home — localStorage hydration", () => {
  it("dedupes persisted entries that share a domain, keeping the one that already has a brandabilityScore", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        foundHistory: [
          { id: "a", domain: "sunnydog.com", meaning: "unscored duplicate", checkedCount: 1, runId: "old-run" },
          {
            id: "b",
            domain: "sunnydog.com",
            meaning: "scored duplicate",
            checkedCount: 1,
            runId: "old-run",
            brandabilityScore: 80,
          },
        ],
      })
    );

    render(<Home />);
    openArchiveTab();

    expect(screen.getByText("scored duplicate")).toBeTruthy();
    expect(screen.queryByText("unscored duplicate")).toBeNull();
  });

  it("keeps unrelated domains as separate entries", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        foundHistory: [
          { id: "a", domain: "foxglow.com", meaning: "first", checkedCount: 1, runId: "old-run" },
          { id: "b", domain: "wrenpath.com", meaning: "second", checkedCount: 1, runId: "old-run" },
        ],
      })
    );

    render(<Home />);
    openArchiveTab();

    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getByText("second")).toBeTruthy();
  });

  it("migrates legacy rankabilityScore/collisionSummary fields onto brandabilityScore/brandabilitySummary", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        foundHistory: [
          {
            id: "a",
            domain: "oldnamer.com",
            meaning: "pre-rename entry",
            checkedCount: 1,
            runId: "old-run",
            rankabilityScore: 42,
            collisionSummary: "a distinctive, unused name",
          },
        ],
      })
    );

    render(<Home />);
    openArchiveTab();

    // brandabilitySummary is only rendered at all once brandabilityScore is
    // also set (see ResultCard) — seeing the summary text proves both
    // legacy fields were migrated onto their current names.
    expect(screen.getByText("a distinctive, unused name")).toBeTruthy();
  });

  it("falls back to the newest legacy storage key when the current key is empty, then removes it", () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        foundHistory: [{ id: "a", domain: "legacyfind.com", meaning: "from namerag", checkedCount: 1, runId: "old-run" }],
      })
    );

    render(<Home />);
    openArchiveTab();

    expect(screen.getByText("from namerag")).toBeTruthy();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("falls back to the older legacy key only when both the current and newer legacy keys are empty", () => {
    localStorage.setItem(
      OLDER_LEGACY_KEY,
      JSON.stringify({
        foundHistory: [
          { id: "a", domain: "veryoldfind.com", meaning: "from domain-finder", checkedCount: 1, runId: "old-run" },
        ],
      })
    );

    render(<Home />);
    openArchiveTab();

    expect(screen.getByText("from domain-finder")).toBeTruthy();
    expect(localStorage.getItem(OLDER_LEGACY_KEY)).toBeNull();
  });

  it("ignores an unparsable persisted value instead of crashing", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => render(<Home />)).not.toThrow();
    // Nothing usable was restored, so this renders exactly like a genuine
    // first visit (see isFirstVisit in page.tsx) — no tab bar, no crash,
    // just the hero.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy();
  });

  // MAX_FOUND_HISTORY (page.tsx) caps foundHistory at 500 entries — both here
  // (persisted history that already exceeds the cap, e.g. saved before the
  // cap existed) and on every live "found" event during a run (see the
  // "Home — live search" describe block below). Without this trim, a
  // long-lived browser profile's persisted state — and the JSON.stringify
  // cost of rewriting it on every single find — would grow without bound.
  // 500 real ResultCards is enough DOM work under v8 coverage instrumentation
  // (see test:coverage) to occasionally miss vitest's default 5000ms
  // per-test timeout, especially with 32 other test files' workers
  // contending for CPU — hence the explicit longer timeout below.
  it(
    "caps persisted foundHistory at 500 entries, keeping the newest",
    () => {
      const entries = Array.from({ length: 501 }, (_, i) => ({
        id: `id-${i}`,
        domain: `entry${i}.com`,
        meaning: `label ${i}`,
        checkedCount: 1,
        runId: "old-run",
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ foundHistory: entries }));

      render(<Home />);
      openArchiveTab();

      // Entries are newest-first, so index 0..499 (the first 500) survive
      // the cap and index 500 (the 501st, oldest) is the one trimmed.
      expect(screen.getByText("label 0")).toBeTruthy();
      expect(screen.getByText("label 499")).toBeTruthy();
      expect(screen.queryByText("label 500")).toBeNull();
      expect(screen.getByRole("tab", { name: /^archive, 500 results$/i })).toBeTruthy();
    },
    15000
  );
});

describe("Home — live search", () => {
  // Builds a fake fetch Response whose body behaves like the real
  // ReadableStream page.tsx's start() reads from (see its `for (;;) { const
  // { value, done } = await reader.read(); ... }` loop) — one SSE "data: "
  // line per event, without needing a real ReadableStream/TextEncoder round
  // trip through an actual network stack.
  function sseResponse(events: object[]) {
    const encoder = new TextEncoder();
    const chunks = events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
    let i = 0;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (i < chunks.length) return { value: chunks[i++], done: false };
            return { value: undefined, done: true };
          },
        }),
      },
    };
  }

  function stubFetchWithDiscoverEvents(events: object[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/discover")) return Promise.resolve(sseResponse(events));
        if (url.includes("/api/brandability")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ brandabilityScore: 50, summary: "" }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({ total: 0, matching: 0 }) });
      })
    );
  }

  it("renders a result card once a live 'found' event arrives", async () => {
    stubFetchWithDiscoverEvents([
      { type: "found", domain: "glowfox.com", meaning: "glow + fox", checkedCount: 1, foundCount: 1 },
      { type: "complete", checkedCount: 1, foundCount: 1 },
    ]);

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByText("glow + fox")).toBeTruthy());
  });

  // 501 "found" events each trigger a setFoundHistory re-sort plus a
  // (mocked) brandability fetch and its own follow-up setFoundHistory — on
  // top of 500 rendered ResultCards, that's meaningfully more work than the
  // other tests here, hence the generous timeouts on both the test itself
  // and the waitFor poll.
  it(
    "caps the live-appended foundHistory at MAX_FOUND_HISTORY (500) during a single run",
    async () => {
      const events = Array.from({ length: 501 }, (_, i) => ({
        type: "found" as const,
        domain: `livefind${i}.com`,
        meaning: `live label ${i}`,
        checkedCount: i + 1,
        foundCount: i + 1,
      }));
      stubFetchWithDiscoverEvents([...events, { type: "complete", checkedCount: 501, foundCount: 501 }]);

      render(<Home />);
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(
        () => expect(screen.getByRole("tab", { name: /^current, 500 results$/i })).toBeTruthy(),
        { timeout: 20000 }
      );
    },
    30000
  );

  it("does not re-check brandability when a 'found' event rediscovers an already-found domain", async () => {
    let brandabilityCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/discover")) {
          // The same domain arrives twice in one run — discovery has no
          // cross-run (or even same-run) exclusion, so this can happen for
          // real; see the "found" handler's foundDomainsRef guard.
          return Promise.resolve(
            sseResponse([
              { type: "found", domain: "glowfox.com", meaning: "glow + fox", checkedCount: 1, foundCount: 1 },
              { type: "found", domain: "glowfox.com", meaning: "glow + fox", checkedCount: 2, foundCount: 1 },
              { type: "complete", checkedCount: 2, foundCount: 1 },
            ])
          );
        }
        if (url.includes("/api/brandability")) {
          brandabilityCalls++;
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ brandabilityScore: 50, summary: "" }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ total: 0, matching: 0 }) });
      })
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: /^current, 1 results$/i })).toBeTruthy());
    // brandabilityCalls only increments asynchronously after the "found"
    // handler fires — give it a tick to settle before asserting the count
    // stayed at one rather than climbing to two.
    await waitFor(() => expect(brandabilityCalls).toBeGreaterThan(0));
    expect(brandabilityCalls).toBe(1);
  });

  it("reuses an already-known brandability score for the same name found under a new TLD, without a fresh check", async () => {
    // glowfox.com was found (and scored) in an earlier run and is already
    // persisted — glowfox.io, a different domain but the same bare name,
    // is then rediscovered live in a new run.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        foundHistory: [
          {
            id: "old",
            domain: "glowfox.com",
            meaning: "glow + fox",
            checkedCount: 1,
            runId: "old-run",
            brandabilityScore: 77,
            brandabilitySummary: "already scored",
          },
        ],
      })
    );

    let brandabilityCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/discover")) {
          return Promise.resolve(
            sseResponse([
              { type: "found", domain: "glowfox.io", meaning: "glow + fox", checkedCount: 1, foundCount: 1 },
              { type: "complete", checkedCount: 1, foundCount: 1 },
            ])
          );
        }
        if (url.includes("/api/brandability")) {
          brandabilityCalls++;
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ brandabilityScore: 50, summary: "" }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ total: 0, matching: 0 }) });
      })
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: /^current, 1 results$/i })).toBeTruthy());
    // Carries the score copied from glowfox.com's earlier check, not a
    // fresh (mocked) score of 50 — proves it was reused, not re-fetched.
    expect(screen.getByLabelText(/77% brandable/i)).toBeTruthy();
    expect(brandabilityCalls).toBe(0);
  });

  // Unlike sseResponse above (a fixed list, exhausted then `done: true`),
  // this lets a test push one SSE event at a time and await its effect on
  // the DOM before pushing the next — needed for asserting a *transient*
  // state (e.g. "Getting AI ideas…") that a fixed-list stream would blow
  // straight through before any assertion could observe it. Aborting the
  // signal (see the Stop test below) rejects any read() still pending,
  // matching a real fetch's ReadableStream reader.
  function controlledSseStream(signal?: AbortSignal) {
    const encoder = new TextEncoder();
    let pendingResolve: ((chunk: { value?: Uint8Array; done: boolean }) => void) | null = null;
    let pendingReject: ((err: unknown) => void) | null = null;
    const queued: Array<{ value?: Uint8Array; done: boolean }> = [];
    signal?.addEventListener("abort", () => {
      if (pendingReject) {
        pendingReject(new DOMException("Aborted", "AbortError"));
        pendingResolve = null;
        pendingReject = null;
      }
    });
    return {
      body: {
        getReader: () => ({
          read: () =>
            new Promise<{ value?: Uint8Array; done: boolean }>((resolve, reject) => {
              if (queued.length > 0) {
                resolve(queued.shift()!);
                return;
              }
              pendingResolve = resolve;
              pendingReject = reject;
            }),
        }),
      },
      push(event: object) {
        const chunk = { value: encoder.encode(`data: ${JSON.stringify(event)}\n\n`), done: false };
        if (pendingResolve) {
          pendingResolve(chunk);
          pendingResolve = null;
          pendingReject = null;
        } else {
          queued.push(chunk);
        }
      },
    };
  }

  it("shows 'Getting AI ideas…' only during the preparing phase, clearing once the first real event arrives", async () => {
    let stream: ReturnType<typeof controlledSseStream>;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, opts?: { signal?: AbortSignal }) => {
        if (url.includes("/api/discover")) {
          stream = controlledSseStream(opts?.signal);
          return Promise.resolve({ ok: true, body: stream.body });
        }
        return Promise.resolve({ json: () => Promise.resolve({ total: 0, matching: 0 }) });
      })
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    stream!.push({ type: "preparing" });
    await waitFor(() =>
      expect(screen.getByText("Getting AI ideas before this search starts checking domains…")).toBeTruthy()
    );

    stream!.push({ type: "found", domain: "glowfox.com", meaning: "glow + fox", checkedCount: 1, foundCount: 1 });
    // Any real event (not just one that itself displays something) closes
    // the wait — see useDiscoveryRun's `setGettingIdeas(event.type ===
    // "preparing")` line, evaluated on every event, not just recognized ones.
    await waitFor(() =>
      expect(screen.queryByText("Getting AI ideas before this search starts checking domains…")).toBeNull()
    );
    expect(screen.getByText("glow + fox")).toBeTruthy();
  });

  it("renders AI synonym, AI-invented, and alt-spelling word lists from their respective SSE events", async () => {
    stubFetchWithDiscoverEvents([
      { type: "synonyms", words: ["lumen", "glow"] },
      { type: "invented", words: ["zylora", "fenbrix"] },
      { type: "altSpellings", words: ["lyft", "phonik"] },
      { type: "found", domain: "glowfox.com", meaning: "glow + fox", checkedCount: 1, foundCount: 1 },
      { type: "complete", checkedCount: 1, foundCount: 1 },
    ]);

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByText(/AI synonyms: lumen, glow/)).toBeTruthy());
    expect(screen.getByText(/AI-invented names: zylora, fenbrix/)).toBeTruthy();
    expect(screen.getByText(/alt spellings: lyft, phonik/)).toBeTruthy();
  });

  it("shows a mid-stream 'error' SSE event as the alert banner without ending the run", async () => {
    stubFetchWithDiscoverEvents([
      {
        type: "error",
        message: "GitHub checking appears to be blocked — no longer requiring it for the rest of this search.",
      },
      { type: "checking", name: "glowfox.com", checkedCount: 1 },
    ]);

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "GitHub checking appears to be blocked — no longer requiring it for the rest of this search."
      )
    );
    // A dropped-platform notice (useDiscoveryRun's "error" case only sets
    // errorMessage) doesn't end the search, unlike a fetch-level failure
    // (the existing "shows only the error banner…" test below, which throws
    // and lands in the catch block that sets runStatus to "error"). Two
    // distinct "Stop" controls stay mounted while running (SearchBar's own
    // submit button relabels itself, plus Footer's — see SearchBar.tsx),
    // and both staying present proves isRunning is still true.
    expect(screen.getAllByRole("button", { name: "Stop" }).length).toBe(2);
  });

  it("stops a live run when Stop is clicked, tearing down the running UI", async () => {
    let stream: ReturnType<typeof controlledSseStream>;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, opts?: { signal?: AbortSignal }) => {
        if (url.includes("/api/discover")) {
          stream = controlledSseStream(opts?.signal);
          return Promise.resolve({ ok: true, body: stream.body });
        }
        return Promise.resolve({ json: () => Promise.resolve({ total: 0, matching: 0 }) });
      })
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    stream!.push({ type: "checking", name: "glowfox.com", checkedCount: 1 });

    // Two distinct "Stop" controls render while running — SearchBar's own
    // submit button relabels itself, plus Footer's (see SearchBar.tsx) —
    // either one calls the same stop().
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Stop" }).length).toBe(2));
    fireEvent.click(screen.getAllByRole("button", { name: "Stop" })[0]);

    // Stop aborts the fetch (rejecting the still-pending read() above) and
    // sets runStatus to "stopped" — the Footer (isRunning-only) and
    // SearchBar's relabel back to "Search again" both follow, rather than
    // the stream continuing to drive the UI in the background.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    expect(screen.getByRole("button", { name: "Search again" })).toBeTruthy();
  });

  it("shows only the error banner, not the 'no matches found' hint, when a search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/discover")) {
          return Promise.resolve({
            ok: false,
            status: 429,
            json: () => Promise.resolve({ error: "Too many searches — try again in a bit." }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({ total: 0, matching: 0 }) });
      })
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toBe("Too many searches — try again in a bit.");
    expect(screen.queryByText(/No matches found/)).toBeNull();
  });
});
