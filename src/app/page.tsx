"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// English only — Latin/Esperanto/French/Spanish were dropped (no
// WordNet-equivalent lexicon source existed for them). Kept as a Lang
// union/array of one, matching the shape src/lib/dictionary.ts and
// src/lib/modifiers.ts use, rather than special-casing a bare string.
type Lang = "english";
const LANGS: Lang[] = ["english"];

// Kept as a small local literal (not imported from the server-side lib)
// so this client bundle doesn't pull in the dictionary data file. Ordered
// by real-world popularity — must stay in sync with SUPPORTED_TLDS in
// src/lib/candidates.ts. The first PRIMARY_TLD_COUNT show by default; the
// rest fold behind a "More" toggle.
const TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "ai",
  "xyz",
  "app",
  "dev",
  "uk",
  "me",
  "us",
  "de",
  "eu",
  "info",
  "shop",
  "tech",
  "club",
  "biz",
  "cloud",
  "name",
] as const;
type Tld = (typeof TLDS)[number];
const PRIMARY_TLD_COUNT = 6;

// Must stay in sync with MIN/MAX_COMBINED_LENGTH in src/lib/dictionary.ts
// (same reasoning as TLDS above: duplicated locally rather than imported,
// so this client bundle doesn't pull in the dictionary data file). The
// dictionary spans 2-8 letter words, so the shortest possible pairing is
// two 2-letter words (4) and the longest accounts for the keyword path
// (a 15-char keyword plus an 8-letter word, rounded up to 24).
const MIN_COMBINED_LENGTH = 4;
const MAX_COMBINED_LENGTH = 24;

// "filtered": the domain itself was available, but its Instagram username
// wasn't (or the check was inconclusive) — see the "instagram" filter,
// which requires both to count as a result.
type LogStatus = "checking" | "taken" | "unknown" | "available" | "filtered";

interface LogEntry {
  id: string;
  name: string;
  status: LogStatus;
}

type InstagramStatus = "available" | "taken" | "unknown";

interface FoundEntry {
  id: string;
  domain: string;
  meaning: string;
  checkedCount: number;
  runId: string;
  // Optional so entries persisted before this field existed still hydrate
  // fine — treated as "unknown" wherever it's read (see InstagramBadge).
  instagram?: InstagramStatus;
}

interface PersistedState {
  foundHistory: FoundEntry[];
  favorites: FoundEntry[];
  enabledLangs: Record<Lang, boolean>;
  enabledTlds: Record<Tld, boolean>;
  maxLength: number;
  keywordInput: string;
}

const STORAGE_KEY = "domain-finder:state:v1";

interface DictionaryStats {
  english: number;
  combinedUnique: number;
  totalCombinations: number;
}

type RunStatus = "idle" | "running" | "stopped" | "found" | "error";

const MAX_LOG_ENTRIES = 200;
const BATCH_SIZE = 12;

// Consistent keyboard-focus styling for every interactive element, so tab
// navigation reads as one deliberate system instead of the browser default.
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// crypto.randomUUID() only exists in secure contexts (HTTPS, or
// localhost) — this app is also used over plain HTTP on a LAN (e.g.
// http://192.168.x.x:3000), where the browser doesn't expose it at all.
// crypto.getRandomValues() has no such restriction, so it's the fallback:
// same 128 bits of randomness, just not formatted as a UUID (fine here —
// these ids are only ever compared for equality or used as React keys,
// never parsed as UUIDs).
function generateId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeKeyword(raw: string) {
  // Mirrors parseKeyword in src/lib/candidates.ts — digits are kept
  // (domains can legally contain them), only letters/digits survive.
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
}

function formatNumber(n: number) {
  return n.toLocaleString("en-US");
}

export default function Home() {
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [checkedCount, setCheckedCount] = useState(0);
  const [foundHistory, setFoundHistory] = useState<FoundEntry[]>([]);
  const [favorites, setFavorites] = useState<FoundEntry[]>([]);
  const [stats, setStats] = useState<DictionaryStats | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [enabledLangs, setEnabledLangs] = useState<Record<Lang, boolean>>(() =>
    Object.fromEntries(LANGS.map((l) => [l, true])) as Record<Lang, boolean>
  );
  const [enabledTlds, setEnabledTlds] = useState<Record<Tld, boolean>>(() =>
    Object.fromEntries(TLDS.map((t) => [t, t === "com"])) as Record<Tld, boolean>
  );
  const [maxLength, setMaxLength] = useState(MAX_COMBINED_LENGTH);
  const [keywordInput, setKeywordInput] = useState("");
  const [currentRunFound, setCurrentRunFound] = useState(0);
  // A collision-proof id per search, not a simple counter: results
  // (tagged with the runId that found them) are persisted across reloads
  // in localStorage, but an in-memory counter would reset to 0 on every
  // reload and collide with an old persisted run's id — which previously
  // caused old "previous results" to be misclassified as the current run
  // and reappear in the main grid instead of staying collapsed.
  const [activeRunId, setActiveRunId] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [showMoreTlds, setShowMoreTlds] = useState(false);
  const [showPreviousResults, setShowPreviousResults] = useState(false);

  const selectedLangs = useMemo(
    () => (Object.keys(enabledLangs) as Lang[]).filter((l) => enabledLangs[l]),
    [enabledLangs]
  );
  const langsParam = selectedLangs.join(",");
  const selectedTlds = useMemo(
    () => TLDS.filter((t) => enabledTlds[t]),
    [enabledTlds]
  );
  const tldsParam = selectedTlds.join(",");
  const keywordParam = sanitizeKeyword(keywordInput);
  // Auto-reveal the collapsed row if a persisted/restored selection
  // includes one of the "more" TLDs — a selected TLD should never be
  // hidden from view.
  const effectiveShowMoreTlds =
    showMoreTlds || TLDS.slice(PRIMARY_TLD_COUNT).some((t) => enabledTlds[t]);
  const visibleTlds = effectiveShowMoreTlds ? TLDS : TLDS.slice(0, PRIMARY_TLD_COUNT);

  const toggleTld = useCallback((tld: Tld) => {
    setEnabledTlds((prev) => {
      const activeCount = Object.values(prev).filter(Boolean).length;
      if (prev[tld] && activeCount <= 1) return prev; // keep at least one selected
      return { ...prev, [tld]: !prev[tld] };
    });
  }, []);

  useEffect(() => {
    // Abort the previous in-flight request on every re-run (including on
    // unmount): without this, the very first fetch — dispatched on mount
    // with the default all-languages selection, before localStorage
    // hydration restores the real one a moment later — can resolve *after*
    // the second, correct-filters request and silently overwrite it with
    // the stale, unfiltered pool size. Aborting means only the latest
    // request's response can ever reach setStats.
    const controller = new AbortController();
    fetch(`/api/stats?langs=${encodeURIComponent(langsParam)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
    return () => controller.abort();
  }, [langsParam]);

  // Restore results, favorites, and filters on load. localStorage means
  // this survives closing the browser and is shared across tabs of this
  // origin — only the live/active search itself stays isolated per tab
  // (that's the server-side SSE connection, untouched by this).
  // One-time hydration from an external system (localStorage) on mount —
  // this can't be a lazy useState initializer because it must not run
  // during SSR, where localStorage doesn't exist.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: Partial<PersistedState> = raw ? JSON.parse(raw) : {};
      if (parsed.foundHistory) setFoundHistory(parsed.foundHistory);
      if (parsed.favorites) setFavorites(parsed.favorites);
      if (parsed.enabledLangs) setEnabledLangs(parsed.enabledLangs);
      if (parsed.enabledTlds) setEnabledTlds(parsed.enabledTlds);
      if (typeof parsed.maxLength === "number") {
        setMaxLength(Math.min(MAX_COMBINED_LENGTH, Math.max(MIN_COMBINED_LENGTH, parsed.maxLength)));
      }
      if (typeof parsed.keywordInput === "string") setKeywordInput(parsed.keywordInput);
    } catch {
      // localStorage unavailable (private mode, quota, etc.) — fine, just skip.
    }
    // Set regardless of whether anything was restored — this is what tells
    // the write effect below "the pre-hydration defaults have now been
    // superseded, real writes may proceed."
    setHasHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    // Every state value this effect reads was set in the same hydration
    // effect/render as `hasHydrated`, so React guarantees they're all
    // consistent by the time this effect sees hasHydrated === true — no
    // risk of writing pre-hydration defaults over restored data.
    if (!hasHydrated) return;
    try {
      const state: PersistedState = {
        foundHistory,
        favorites,
        enabledLangs,
        enabledTlds,
        maxLength,
        keywordInput,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore write failures — persistence is a nice-to-have
    }
  }, [hasHydrated, foundHistory, favorites, enabledLangs, enabledTlds, maxLength, keywordInput]);

  useEffect(() => {
    // Scroll only the log's own internal scrollbox to its latest entry —
    // never the page itself, so a found-domain banner above it (or wherever
    // the user has the page scrolled) never gets pulled out of view by new
    // log lines arriving.
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  // One log line per candidate: added as "checking", then updated in place
  // once its result comes in — never a second line for the same name.
  const addChecking = useCallback((name: string) => {
    setLog((prev) => {
      const next = [...prev, { id: name, name, status: "checking" as LogStatus }];
      return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
    });
  }, []);

  const resolveLog = useCallback((name: string, status: LogStatus) => {
    setLog((prev) => prev.map((entry) => (entry.id === name ? { ...entry, status } : entry)));
  }, []);

  const start = useCallback(async () => {
    if (abortRef.current) return;
    // Every start is a brand new, independently seeded search — this tab's
    // own random walk over the candidate space, isolated from any other
    // tab's search. Found domains accumulate in a grid across searches.
    const runId = generateId();
    setActiveRunId(runId);
    setRunStatus("running");
    setErrorMessage(null);
    setCheckedCount(0);
    setCurrentRunFound(0);
    setLog([]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `/api/discover?langs=${encodeURIComponent(langsParam)}&maxLength=${maxLength}&keyword=${encodeURIComponent(keywordParam)}&tlds=${encodeURIComponent(tldsParam)}&count=${BATCH_SIZE}`,
        { signal: controller.signal }
      );
      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          if (chunk.startsWith(":")) continue;

          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(6));

          switch (event.type) {
            case "checking":
              addChecking(event.name);
              setCheckedCount(event.checkedCount);
              break;
            case "taken":
              resolveLog(event.name, "taken");
              setCheckedCount(event.checkedCount);
              break;
            case "unknown":
              resolveLog(event.name, "unknown");
              setCheckedCount(event.checkedCount);
              break;
            case "filtered":
              resolveLog(event.name, "filtered");
              setCheckedCount(event.checkedCount);
              break;
            case "found": {
              // The search keeps going after each find until the batch
              // target is reached (or stopped) — status stays "running".
              setCheckedCount(event.checkedCount);
              setCurrentRunFound(event.foundCount);
              setFoundHistory((prev) => [
                // A random id, not `${domain}-${Date.now()}`: with several
                // concurrent workers, two "found" events can land in the
                // same millisecond, and Date.now() alone isn't fine-grained
                // enough to keep them apart — that previously produced
                // duplicate React keys.
                {
                  id: generateId(),
                  domain: event.domain,
                  meaning: event.meaning,
                  checkedCount: event.checkedCount,
                  runId,
                  instagram: event.instagram,
                },
                ...prev,
              ]);
              resolveLog(event.domain, "available");
              break;
            }
            case "complete":
              setRunStatus("found");
              setCheckedCount(event.checkedCount);
              setCurrentRunFound(event.foundCount);
              break;
            case "stopped":
              setRunStatus("stopped");
              break;
            case "error":
              setErrorMessage(event.message);
              break;
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setRunStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Stream error");
      }
    } finally {
      abortRef.current = null;
    }
  }, [addChecking, resolveLog, langsParam, maxLength, keywordParam, tldsParam]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunStatus("stopped");
  }, []);

  const searchDomain = useCallback((entry: FoundEntry) => {
    // Search the bare name, not the TLD (e.g. "swiftfox", not "swiftfox.com") —
    // domain here is always name + "." + tld, no subdomains, so splitting on
    // the first "." reliably strips it.
    const name = entry.domain.split(".")[0];
    const url = `https://www.google.com/search?q=${encodeURIComponent(name)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const toggleFavorite = useCallback((entry: FoundEntry) => {
    setFavorites((prev) =>
      prev.some((f) => f.domain === entry.domain)
        ? prev.filter((f) => f.domain !== entry.domain)
        : [entry, ...prev]
    );
  }, []);

  const exportBackup = useCallback(() => {
    const payload = { exportedAt: new Date().toISOString(), favorites, foundHistory };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `domain-finder-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [favorites, foundHistory]);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const importBackup = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const importedFavorites: FoundEntry[] = Array.isArray(parsed.favorites) ? parsed.favorites : [];
        const importedHistory: FoundEntry[] = Array.isArray(parsed.foundHistory) ? parsed.foundHistory : [];

        setFavorites((prev) => {
          const seen = new Set(prev.map((f) => f.domain));
          const additions = importedFavorites.filter(
            (e) => e?.domain && typeof e.domain === "string" && !seen.has(e.domain)
          );
          return [...prev, ...additions];
        });
        setFoundHistory((prev) => {
          const seen = new Set(prev.map((f) => f.id));
          const additions = importedHistory.filter((e) => e?.id && !seen.has(e.id));
          return [...prev, ...additions];
        });

        setImportMessage(
          `Imported ${importedFavorites.length} favorite(s) and ${importedHistory.length} result(s) (duplicates skipped).`
        );
      } catch {
        setImportMessage("Couldn't read that file — make sure it's a Domain Finder backup export.");
      }
      setTimeout(() => setImportMessage(null), 4000);
    };
    reader.readAsText(file);
  }, []);

  const isRunning = runStatus === "running";
  const primaryLabel = isRunning
    ? `Searching… (${currentRunFound}/${BATCH_SIZE})`
    : runStatus === "idle"
      ? "Start discovery"
      : "Search again";
  // foundHistory is stored newest-first (new finds are prepended, so
  // Favorites/Previous-results archives read newest-first). But within the
  // *current* run's grid, that ordering made each new find jump to the
  // front and push earlier ones down/right. Reverse just this slice so
  // finds render in discovery order — first found stays put, each new one
  // appends after it — instead of reshuffling the whole grid every find.
  const currentRunResults = foundHistory.filter((e) => e.runId === activeRunId).slice().reverse();
  const previousResults = foundHistory.filter((e) => e.runId !== activeRunId);
  const favoriteDomains = useMemo(() => new Set(favorites.map((f) => f.domain)), [favorites]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Top app bar */}
      <header className="shrink-0 border-b border-black/15 bg-background/80 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 backdrop-blur-md dark:border-white/15">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">Domain Finder</h1>
            <p className="truncate text-xs text-black/65 dark:text-white/65">
              Dictionary word combos · {selectedTlds.map((t) => `.${t}`).join(" ")}
            </p>
          </div>
          <div className="ml-auto shrink-0">
            <StatusBadge status={runStatus} />
          </div>
        </div>
      </header>

      {/* Scrollable content */}
      <main
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
          {/* 1. SEARCH CONFIGURATION — the primary, most-used control
              surface, grouped as one cohesive card instead of loose
              independently-bordered widgets. Just the English dictionary
              now (Latin/Esperanto/French/Spanish were dropped — no
              WordNet-equivalent lexicon existed for them), so there's
              nothing to pick between; the pool size is shown as a plain
              stat rather than a now-pointless single-item toggle. */}
          {!stats && (
            <section className="flex flex-col gap-3 rounded-2xl border border-black/15 p-4 dark:border-white/15" aria-hidden="true">
              <div className="h-4 w-32 animate-pulse rounded bg-black/5 dark:bg-white/5" />
              <div className="h-11 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
              <div className="h-11 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
            </section>
          )}
          {stats && (
            <section className="flex flex-col gap-3 rounded-2xl border border-black/15 p-4 dark:border-white/15">
              <p className="text-xs text-black/55 dark:text-white/55">
                <span className="font-semibold tabular-nums text-black/80 dark:text-white/80">
                  {formatNumber(stats.combinedUnique)}
                </span>{" "}
                English dictionary words in the pool
              </p>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-black/55 dark:text-white/55">
                  <span>Max combination length</span>
                  <span className="font-semibold tabular-nums text-black/80 dark:text-white/80">
                    {maxLength} characters
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_COMBINED_LENGTH}
                  max={MAX_COMBINED_LENGTH}
                  step={1}
                  value={maxLength}
                  onChange={(e) => setMaxLength(Number(e.target.value))}
                  aria-label="Maximum combined result length"
                  className={`h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-emerald-600 dark:bg-white/10 dark:accent-emerald-500 ${FOCUS_RING}`}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="relative">
                  <input
                    type="text"
                    inputMode="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    placeholder="Include a word (optional), e.g. nova"
                    maxLength={20}
                    className={`min-h-11 w-full rounded-xl border border-black/15 bg-transparent px-3.5 text-sm outline-none transition-colors placeholder:text-black/45 focus:border-emerald-500/50 dark:border-white/15 dark:placeholder:text-white/45 ${FOCUS_RING}`}
                  />
                  {keywordInput && (
                    <button
                      type="button"
                      onClick={() => setKeywordInput("")}
                      aria-label="Clear keyword"
                      className={`absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-black/55 transition-colors hover:bg-black/5 dark:text-white/55 dark:hover:bg-white/10 ${FOCUS_RING}`}
                    >
                      ×
                    </button>
                  )}
                </div>
                {keywordParam && (
                  <p className="text-xs text-black/55 dark:text-white/55">
                    Every result will include &ldquo;{keywordParam}&rdquo;.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {visibleTlds.map((tld) => (
                  <button
                    key={tld}
                    type="button"
                    onClick={() => toggleTld(tld)}
                    aria-pressed={enabledTlds[tld]}
                    className={`min-h-10 rounded-full border px-3.5 text-xs font-medium transition-all active:scale-95 ${FOCUS_RING} ${
                      enabledTlds[tld]
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-black/20 text-black/65 hover:bg-black/5 dark:border-white/20 dark:text-white/65 dark:hover:bg-white/10"
                    }`}
                  >
                    .{tld}
                  </button>
                ))}
                {TLDS.length > PRIMARY_TLD_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShowMoreTlds((v) => !v)}
                    className={`min-h-10 rounded-full border border-dashed border-black/25 px-3.5 text-xs font-medium text-black/65 transition-all active:scale-95 hover:bg-black/5 dark:border-white/25 dark:text-white/65 dark:hover:bg-white/10 ${FOCUS_RING}`}
                  >
                    {effectiveShowMoreTlds ? "Less ▲" : `More ▾`}
                  </button>
                )}
              </div>
            </section>
          )}

          {errorMessage && (
            <p className="animate-fade-in-up rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              {errorMessage}
            </p>
          )}

          {/* 2. RESULTS — the output of the primary task, in order of
              immediacy: what this run just found, your persistent curated
              picks, then the archive of everything earlier. */}

          {/* Results grid — only the current run, so the screen doesn't
              accumulate clutter across repeated searches. Older finds move
              into the collapsed "Previous results" section below. */}
          {(currentRunResults.length > 0 || isRunning) && (
            <section className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wide text-black/65 dark:text-white/65">
                  Available domains
                </h2>
                {isRunning && (
                  <span className="text-xs tabular-nums text-black/55 dark:text-white/55">
                    {currentRunFound}/{BATCH_SIZE}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {currentRunResults.map((entry) => (
                  <ResultCard
                    key={entry.id}
                    entry={entry}
                    favorited={favoriteDomains.has(entry.domain)}
                    onSearch={() => searchDomain(entry)}
                    onToggleFavorite={() => toggleFavorite(entry)}
                  />
                ))}
                {isRunning &&
                  Array.from({ length: Math.max(0, BATCH_SIZE - currentRunResults.length) }).map((_, i) => (
                    <div
                      key={`pending-${i}`}
                      className="h-[76px] animate-pulse rounded-xl border border-dashed border-black/15 bg-black/[0.02] dark:border-white/15 dark:bg-white/[0.02]"
                    />
                  ))}
              </div>
            </section>
          )}

          {/* Favorites */}
          {favorites.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-black/65 dark:text-white/65">
                Favorites
              </h2>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {favorites.map((entry) => (
                  <ResultCard
                    key={entry.id}
                    entry={entry}
                    favorited
                    onSearch={() => searchDomain(entry)}
                    onToggleFavorite={() => toggleFavorite(entry)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Previous results — collapsed by default, same pattern as the
              "More TLDs" toggle, so old finds stay reachable without
              cluttering the default view. */}
          {previousResults.length > 0 && (
            <section className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowPreviousResults((v) => !v)}
                className={`flex min-h-10 items-center justify-between rounded-xl border border-dashed border-black/25 px-3.5 text-xs font-medium text-black/65 transition-all active:scale-[0.99] hover:bg-black/5 dark:border-white/25 dark:text-white/65 dark:hover:bg-white/10 ${FOCUS_RING}`}
              >
                <span>Previous results ({previousResults.length})</span>
                <span>{showPreviousResults ? "▲" : "▾"}</span>
              </button>
              {showPreviousResults && (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {previousResults.map((entry) => (
                    <ResultCard
                      key={entry.id}
                      entry={entry}
                      favorited={favoriteDomains.has(entry.domain)}
                      onSearch={() => searchDomain(entry)}
                        onToggleFavorite={() => toggleFavorite(entry)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 3. PROCESS DETAIL — how the search is going, useful while
              running but secondary to the results themselves. */}
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-black/65 dark:text-white/65">
              Live log
            </h2>
            <div
              ref={logBoxRef}
              className="thin-scrollbar min-h-[160px] max-h-[45vh] overflow-y-auto rounded-xl border border-black/15 p-3 font-mono text-sm dark:border-white/15"
              aria-live="polite"
            >
              {log.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-black/55 dark:text-white/55">
                  <SearchIcon />
                  <p>Press &ldquo;{primaryLabel}&rdquo; to begin checking domains.</p>
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {log.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-2 animate-fade-in-up">
                      <LogDot status={entry.status} />
                      <span className="text-black/90 dark:text-white/90">{entry.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* 4. UTILITY — lowest-frequency action, operating on the data
              above rather than the search itself, so it belongs last. */}
          <section className="flex flex-col items-center gap-1.5 border-t border-black/10 pt-4 dark:border-white/10">
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={exportBackup}
                className={`text-black/65 underline decoration-black/30 underline-offset-2 transition-colors hover:text-black/85 dark:text-white/65 dark:decoration-white/30 dark:hover:text-white/85 ${FOCUS_RING}`}
              >
                Export backup
              </button>
              <span className="text-black/30 dark:text-white/30">·</span>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className={`text-black/65 underline decoration-black/30 underline-offset-2 transition-colors hover:text-black/85 dark:text-white/65 dark:decoration-white/30 dark:hover:text-white/85 ${FOCUS_RING}`}
              >
                Import backup
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importBackup(file);
                  e.target.value = "";
                }}
              />
            </div>
            {importMessage && (
              <p className="animate-fade-in-up text-xs text-black/65 dark:text-white/65">{importMessage}</p>
            )}
          </section>
        </div>
      </main>

      {/* Bottom action bar */}
      <footer className="shrink-0 border-t border-black/15 bg-background/80 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-md dark:border-white/15">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {isRunning ? (
            <button
              onClick={stop}
              className={`min-h-12 w-full rounded-full border border-black/25 text-base font-semibold transition-transform active:scale-[0.98] hover:bg-black/5 dark:border-white/30 dark:hover:bg-white/10 ${FOCUS_RING}`}
            >
              Stop
            </button>
          ) : (
            <button
              onClick={start}
              className={`min-h-12 w-full rounded-full bg-foreground text-base font-semibold text-background transition-transform active:scale-[0.98] hover:opacity-90 ${FOCUS_RING}`}
            >
              {primaryLabel}
            </button>
          )}
          <div className="flex items-center justify-center text-xs tabular-nums text-black/65 dark:text-white/65">
            {formatNumber(checkedCount)} checked this search
          </div>
        </div>
      </footer>
    </div>
  );
}

function ResultCard({
  entry,
  favorited,
  onSearch,
  onToggleFavorite,
}: {
  entry: FoundEntry;
  favorited: boolean;
  onSearch: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="animate-fade-in-up flex flex-col gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 transition-colors hover:border-emerald-500/50">
      <div className="flex items-start justify-between gap-1.5">
        <span className="truncate font-mono text-sm font-semibold text-emerald-800 dark:text-emerald-300">
          {entry.domain}
        </span>
        <button
          onClick={onToggleFavorite}
          aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorited}
          className={`shrink-0 rounded text-base leading-none transition-transform active:scale-90 ${FOCUS_RING} ${
            favorited ? "text-amber-500" : "text-black/35 hover:text-black/55 dark:text-white/35 dark:hover:text-white/55"
          }`}
        >
          {favorited ? "★" : "☆"}
        </button>
      </div>
      <span className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70">{entry.meaning}</span>
      <InstagramBadge status={entry.instagram} />
      <button
        onClick={onSearch}
        className={`flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-emerald-600/30 text-xs font-medium text-emerald-700 transition-all active:scale-95 hover:bg-emerald-500/10 dark:text-emerald-300 ${FOCUS_RING}`}
      >
        <SearchIcon size={12} />
        Search
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, { label: string; dot: string }> = {
    idle: { label: "Idle", dot: "bg-black/35 dark:bg-white/35" },
    running: { label: "Running", dot: "bg-blue-500 animate-pulse" },
    stopped: { label: "Stopped", dot: "bg-black/35 dark:bg-white/35" },
    found: { label: "Found", dot: "bg-emerald-500" },
    error: { label: "Error", dot: "bg-red-500" },
  };
  const { label, dot } = map[status];
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-black/70 dark:text-white/70">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function LogDot({ status }: { status: LogStatus }) {
  const className =
    status === "checking"
      ? "bg-blue-500 animate-pulse"
      : status === "taken"
        ? "bg-black/30 dark:bg-white/30"
        : status === "available"
          ? "bg-emerald-500"
          : status === "filtered"
            ? "bg-violet-500"
            : "bg-amber-500";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />;
}

// "unknown" (Instagram's response was inconclusive, e.g. rate-limited) or
// no field at all (an entry persisted before this existed) both render
// nothing — there's nothing useful to tell the user in either case, and the
// "Instagram" button below still works either way.
function InstagramBadge({ status }: { status: InstagramStatus | undefined }) {
  if (!status || status === "unknown") return null;
  return (
    <span
      className={`text-[10px] font-medium ${
        status === "available" ? "text-emerald-600 dark:text-emerald-400" : "text-black/40 dark:text-white/40"
      }`}
    >
      {status === "available" ? "◇ Instagram available" : "◆ Instagram taken"}
    </span>
  );
}

function SearchIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

