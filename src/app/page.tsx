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

// Must stay in sync with MIN/MAX/DEFAULT_COMBINED_LENGTH in
// src/lib/dictionary.ts (same reasoning as TLDS above: duplicated locally
// rather than imported, so this client bundle doesn't pull in the
// dictionary data file). The max accounts for the keyword path (a 15-char
// keyword plus an 8-letter word, rounded up to 24); the min and default
// favor output quality over the shortest theoretically possible pairing.
const MIN_COMBINED_LENGTH = 5;
const MAX_COMBINED_LENGTH = 24;
const DEFAULT_COMBINED_LENGTH = 8;

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
  // The two literal strings domain's name was concatenated from — see
  // Candidate.parts in lib/candidates.ts — passed to checkCollisionFor so
  // it can search the name as two separate words. Optional so entries
  // persisted before this field existed still hydrate fine; absent means
  // checkCollisionFor falls back to collision.ts's own dictionary-based
  // guess (splitIntoWords) instead.
  parts?: [string, string];
  checkedCount: number;
  runId: string;
  // Optional so entries persisted before this field existed still hydrate
  // fine — treated as "unknown" wherever it's read (see InstagramBadge).
  instagram?: InstagramStatus;
  // Populated on demand via checkCollisionFor (the "Check collisions"
  // button in CollisionBadge) — absent until checked, or if the check
  // failed. 0 = as unrankable as "Google" itself; 100 = a long random
  // string with no real-world usage anywhere to compete with.
  rankabilityScore?: number;
  collisionSummary?: string;
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

// Collapses entries that share a domain down to one, preferring whichever
// one already carries a collision score over an unscored duplicate. Used
// to clean up persisted state from before the "found" handler started
// guarding against this (see start() below) — a re-run of discovery, with
// no exclusion of domains an earlier run already found, could legitimately
// rediscover the same available domain and add a second entry for it,
// which then rendered as a duplicate card in Previous results. Keeps the
// original relative order (by first occurrence) rather than reshuffling.
function dedupeByDomain(entries: FoundEntry[]): FoundEntry[] {
  const bestByDomain = new Map<string, FoundEntry>();
  for (const entry of entries) {
    const existing = bestByDomain.get(entry.domain);
    if (!existing || (existing.rankabilityScore === undefined && entry.rankabilityScore !== undefined)) {
      bestByDomain.set(entry.domain, entry);
    }
  }
  const seenDomains = new Set<string>();
  const result: FoundEntry[] = [];
  for (const entry of entries) {
    if (seenDomains.has(entry.domain)) continue;
    seenDomains.add(entry.domain);
    result.push(bestByDomain.get(entry.domain)!);
  }
  return result;
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
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [enabledLangs, setEnabledLangs] = useState<Record<Lang, boolean>>(() =>
    Object.fromEntries(LANGS.map((l) => [l, true])) as Record<Lang, boolean>
  );
  const [enabledTlds, setEnabledTlds] = useState<Record<Tld, boolean>>(() =>
    Object.fromEntries(TLDS.map((t) => [t, t === "com"])) as Record<Tld, boolean>
  );
  const [maxLength, setMaxLength] = useState(DEFAULT_COMBINED_LENGTH);
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
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: Partial<PersistedState> = raw ? JSON.parse(raw) : {};
      if (parsed.foundHistory) setFoundHistory(dedupeByDomain(parsed.foundHistory));
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
              setFoundHistory((prev) => {
                // Each search is independently reseeded with no exclusion
                // of domains a previous run already found (see start()
                // above), so re-running discovery (or clicking "Search
                // again") can legitimately rediscover the same available
                // domain — without this guard that added a second
                // FoundEntry for it, showing as a duplicate card in
                // Previous results. Keep the existing entry (it may
                // already carry a collision score from being checked
                // earlier) rather than replacing it with an unscored one.
                if (prev.some((e) => e.domain === event.domain)) return prev;
                return [
                  // A random id, not `${domain}-${Date.now()}`: with
                  // several concurrent workers, two "found" events can
                  // land in the same millisecond, and Date.now() alone
                  // isn't fine-grained enough to keep them apart — that
                  // previously produced duplicate React keys.
                  {
                    id: generateId(),
                    domain: event.domain,
                    meaning: event.meaning,
                    parts: event.parts,
                    checkedCount: event.checkedCount,
                    runId,
                    instagram: event.instagram,
                  },
                  ...prev,
                ];
              });
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

  // On-demand only — see CollisionBadge/"Check collisions" and "Rescore".
  // Neither of these two bits of state is persisted — a stuck "loading"
  // badge or stale error message shouldn't survive a reload.
  const [checkingCollisionNames, setCheckingCollisionNames] = useState<Set<string>>(new Set());
  const [collisionErrors, setCollisionErrors] = useState<Record<string, string>>({});

  const checkCollisionFor = useCallback((name: string, parts: [string, string] | undefined) => {
    setCheckingCollisionNames((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
    setCollisionErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
    (async () => {
      try {
        const partsParam = parts
          ? `&word1=${encodeURIComponent(parts[0])}&word2=${encodeURIComponent(parts[1])}`
          : "";
        const res = await fetch(`/api/collision?name=${encodeURIComponent(name)}${partsParam}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        const { rankabilityScore, summary } = body as { rankabilityScore: number; summary: string };
        // Keyed by bare name (not domain — a result found under several
        // TLDs shares one score), so every matching entry across both
        // arrays gets updated, not just the one card that was clicked.
        const applyScore = (entry: FoundEntry): FoundEntry =>
          entry.domain.split(".")[0] === name
            ? { ...entry, rankabilityScore, collisionSummary: summary }
            : entry;
        setFoundHistory((prev) => prev.map(applyScore));
        setFavorites((prev) => prev.map(applyScore));
      } catch (err) {
        setCollisionErrors((prev) => ({
          ...prev,
          [name]: err instanceof Error ? err.message : "Check failed",
        }));
      } finally {
        setCheckingCollisionNames((prev) => {
          if (!prev.has(name)) return prev;
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    })();
  }, []);

  const toggleFavorite = useCallback((entry: FoundEntry) => {
    setFavorites((prev) =>
      prev.some((f) => f.domain === entry.domain)
        ? prev.filter((f) => f.domain !== entry.domain)
        : [entry, ...prev]
    );
  }, []);

  const copyNames = useCallback(async (entries: FoundEntry[]) => {
    // Bare names only, one per line — domain here is always name + "." +
    // tld (no subdomains), so splitting on the first "." reliably strips
    // it, same as searchDomain above.
    const names = entries.map((entry) => entry.domain.split(".")[0]).join("\n");
    try {
      await navigator.clipboard.writeText(names);
      setCopyMessage(`Copied ${entries.length} name${entries.length === 1 ? "" : "s"}.`);
    } catch {
      setCopyMessage("Couldn't copy — check clipboard permissions.");
    }
    setTimeout(() => setCopyMessage(null), 2500);
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
          const seen = new Set(prev.map((f) => f.domain));
          const additions = importedHistory.filter(
            (e) => e?.domain && typeof e.domain === "string" && !seen.has(e.domain)
          );
          return dedupeByDomain([...prev, ...additions]);
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
  // Ranked best-first (highest rankabilityScore — easiest to actually rank
  // #1 for — at the top), unlike currentRunResults above which preserves
  // discovery order: once a result has aged into history, how promising it
  // is matters more than when it happened to turn up. Entries with no
  // score yet (never checked — see FoundEntry) sort last, via the ?? -1
  // fallback, rather than being scattered among real 0-100 scores.
  const previousResults = foundHistory
    .filter((e) => e.runId !== activeRunId)
    .slice()
    .sort((a, b) => (b.rankabilityScore ?? -1) - (a.rankabilityScore ?? -1));
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
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-black/65 dark:text-white/65">
                  Available domains
                </h2>
                <div className="flex items-baseline gap-2">
                  {copyMessage && (
                    <span className="animate-fade-in-up text-xs text-black/55 dark:text-white/55">
                      {copyMessage}
                    </span>
                  )}
                  {currentRunResults.length > 0 && (
                    <button
                      type="button"
                      onClick={() => copyNames(currentRunResults)}
                      className={`text-xs text-black/65 underline decoration-black/30 underline-offset-2 transition-colors hover:text-black/85 dark:text-white/65 dark:decoration-white/30 dark:hover:text-white/85 ${FOCUS_RING}`}
                    >
                      Copy names
                    </button>
                  )}
                  {isRunning && (
                    <span className="text-xs tabular-nums text-black/55 dark:text-white/55">
                      {currentRunFound}/{BATCH_SIZE}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {currentRunResults.map((entry) => (
                  <ResultCard
                    key={entry.id}
                    entry={entry}
                    favorited={favoriteDomains.has(entry.domain)}
                    collision={{
                      score: entry.rankabilityScore,
                      summary: entry.collisionSummary,
                      loading: checkingCollisionNames.has(entry.domain.split(".")[0]),
                      error: collisionErrors[entry.domain.split(".")[0]],
                    }}
                    onSearch={() => searchDomain(entry)}
                    onToggleFavorite={() => toggleFavorite(entry)}
                    onCheckCollision={() => checkCollisionFor(entry.domain.split(".")[0], entry.parts)}
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
                    collision={{
                      score: entry.rankabilityScore,
                      summary: entry.collisionSummary,
                      loading: checkingCollisionNames.has(entry.domain.split(".")[0]),
                      error: collisionErrors[entry.domain.split(".")[0]],
                    }}
                    onSearch={() => searchDomain(entry)}
                    onToggleFavorite={() => toggleFavorite(entry)}
                    onCheckCollision={() => checkCollisionFor(entry.domain.split(".")[0], entry.parts)}
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
                      collision={{
                      score: entry.rankabilityScore,
                      summary: entry.collisionSummary,
                      loading: checkingCollisionNames.has(entry.domain.split(".")[0]),
                      error: collisionErrors[entry.domain.split(".")[0]],
                    }}
                      onSearch={() => searchDomain(entry)}
                      onToggleFavorite={() => toggleFavorite(entry)}
                      onCheckCollision={() => checkCollisionFor(entry.domain.split(".")[0], entry.parts)}
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
  collision,
  onSearch,
  onToggleFavorite,
  onCheckCollision,
}: {
  entry: FoundEntry;
  favorited: boolean;
  collision: CollisionDisplay;
  onSearch: () => void;
  onToggleFavorite: () => void;
  onCheckCollision: () => void;
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
      <CollisionBadge collision={collision} onCheck={onCheckCollision} />
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

// Domain/Instagram availability (see above) says nothing about whether a
// name already means something real in the world — see lib/collision.ts.
// score is 0-100: 0 as unrankable as "Google" itself, 100 as wide open as a
// long random string with no real-world usage anywhere. undefined until
// checked on demand via the "Check collisions" button below; once scored,
// "Rescore" re-runs the same check (search results change over time, and
// so does the checker's own logic).
interface CollisionDisplay {
  score: number | undefined;
  summary: string | undefined;
  loading: boolean;
  error: string | undefined;
}

/** Emerald at 100 down to red at 0, passing through the same lime → amber →
 * orange progression a traffic-light-style meter would use. */
function scoreColorClass(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-lime-600 dark:text-lime-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  if (score >= 20) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function CollisionBadge({ collision, onCheck }: { collision: CollisionDisplay; onCheck: () => void }) {
  if (collision.loading) {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-black/45 dark:text-white/45">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
        Checking…
      </span>
    );
  }
  if (collision.error) {
    return (
      <button
        type="button"
        onClick={onCheck}
        className={`self-start text-[10px] font-medium text-amber-600 underline decoration-amber-600/40 underline-offset-2 transition-colors hover:text-amber-700 dark:text-amber-400 dark:decoration-amber-400/40 dark:hover:text-amber-300 ${FOCUS_RING}`}
        title={collision.error}
      >
        Check failed — retry
      </button>
    );
  }
  if (collision.score === undefined) {
    return (
      <button
        type="button"
        onClick={onCheck}
        className={`self-start text-[10px] font-medium text-black/45 underline decoration-black/25 underline-offset-2 transition-colors hover:text-black/65 dark:text-white/45 dark:decoration-white/25 dark:hover:text-white/65 ${FOCUS_RING}`}
      >
        Check collisions
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-semibold tabular-nums ${scoreColorClass(collision.score)}`}>
          {collision.score}% rankable
        </span>
        <button
          type="button"
          onClick={onCheck}
          className={`text-[10px] font-medium text-black/45 underline decoration-black/25 underline-offset-2 transition-colors hover:text-black/65 dark:text-white/45 dark:decoration-white/25 dark:hover:text-white/65 ${FOCUS_RING}`}
        >
          Rescore
        </button>
      </div>
      {collision.summary && (
        <span className="text-[10px] leading-snug text-black/55 dark:text-white/55">{collision.summary}</span>
      )}
    </div>
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

