"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveryGates } from "@/lib/discovery";

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
  // Populated on demand via checkCollisionFor (the "Rank" button in
  // CollisionBadge) — absent until checked, or if the check
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
  resultCount: number;
  keywordInput: string;
  gates: DiscoveryGates;
  autoRank: boolean;
  useAiSynonyms: boolean;
  useAiInvented: boolean;
}

// A type-only import, so (unlike TLDS/MIN_COMBINED_LENGTH above) this
// doesn't pull discovery.ts's runtime code — or its dictionary-data
// dependency — into the client bundle; it's erased at compile time. Every
// gate defaults to on (true) — the same behavior the app had before these
// were exposed — so a fresh install, or a persisted state from before this
// existed, comes back unchanged.
const DEFAULT_GATES: DiscoveryGates = {
  requireInstagram: true,
  filterPronounceable: true,
  filterTypos: true,
  filterNiceness: true,
};

const STORAGE_KEY = "namerag:state:v1";
// Pre-rename key — read once as a fallback during hydration (see below) so
// existing users' saved results/favorites/settings survive the rename
// instead of silently becoming unreachable under the new key.
const LEGACY_STORAGE_KEY = "domain-finder:state:v1";

interface DictionaryStats {
  english: number;
  combinedUnique: number;
  totalCombinations: number;
}

type RunStatus = "idle" | "running" | "stopped" | "found" | "error";

const MAX_LOG_ENTRIES = 200;
// Must stay in sync with parseCount's own clamp in src/lib/candidates.ts
// (same duplicate-rather-than-import reasoning as TLDS/MIN_COMBINED_LENGTH
// above).
const MIN_RESULT_COUNT = 1;
const MAX_RESULT_COUNT = 30;
const DEFAULT_RESULT_COUNT = 12;

// Consistent keyboard-focus styling for every interactive element, so tab
// navigation reads as one deliberate system instead of the browser default.
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Shared by the header, main content, and footer's inner wrappers so all
// three stay center-aligned to the same column at every width — grows a
// little on larger screens (rather than staying fixed at max-w-2xl
// forever) so the result-card grid isn't stuck at a mobile-era width on an
// actual desktop monitor, but still caps out well short of full-bleed so
// text never has to stretch across the whole screen to be read.
const CONTENT_WIDTH = "max-w-2xl lg:max-w-3xl xl:max-w-4xl";

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

// TODO(affiliate): once we're signed up with Namecheap's affiliate program,
// tag this URL with whatever tracking it requires. Left as a single named
// spot rather than guessing now, since the exact mechanism (a query param
// appended here vs. wrapping the whole URL in a redirect through the
// affiliate network's own domain, e.g. Awin/CJ) depends on which program we
// actually join.
function namecheapRegisterUrl(domain: string): string {
  return `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}`;
}

export default function Home() {
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [checkedCount, setCheckedCount] = useState(0);
  const [foundHistory, setFoundHistory] = useState<FoundEntry[]>([]);
  const [favorites, setFavorites] = useState<FoundEntry[]>([]);
  const [stats, setStats] = useState<DictionaryStats | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [enabledLangs, setEnabledLangs] = useState<Record<Lang, boolean>>(() =>
    Object.fromEntries(LANGS.map((l) => [l, true])) as Record<Lang, boolean>
  );
  const [enabledTlds, setEnabledTlds] = useState<Record<Tld, boolean>>(() =>
    Object.fromEntries(TLDS.map((t) => [t, t === "com"])) as Record<Tld, boolean>
  );
  const [maxLength, setMaxLength] = useState(DEFAULT_COMBINED_LENGTH);
  const [resultCount, setResultCount] = useState(DEFAULT_RESULT_COUNT);
  const [keywordInput, setKeywordInput] = useState("");
  const [gates, setGates] = useState<DiscoveryGates>(DEFAULT_GATES);
  // Off by default: the rankability check (see checkCollisionFor) hits a
  // paid, metered API (Brave Search + an LLM call) per name, so
  // auto-running it for every found result — rather than only the ones a
  // user picks via "Rank" — is a real cost, not just a convenience switch.
  const [autoRank, setAutoRank] = useState(false);
  // On by default: unlike autoRank, this is one LLM call per search start
  // (not per found result), and it's purely additive on top of the
  // dictionary pairing that always runs anyway — see suggestKeywordSynonyms
  // in lib/synonyms.ts and selectTierSpecs in lib/candidates.ts. Only ever
  // meaningful when a keyword is actually typed.
  const [useAiSynonyms, setUseAiSynonyms] = useState(true);
  // Populated once per search from the "synonyms" SSE event — not
  // persisted, purely a live display of what the current/last run actually
  // searched, the same as `log`.
  const [aiSynonymWords, setAiSynonymWords] = useState<string[]>([]);
  // On by default, same reasoning as useAiSynonyms — one LLM call per
  // search start. Unlike useAiSynonyms this isn't gated on a keyword being
  // typed at all: see suggestInventedNames in lib/inventedNames.ts.
  const [useAiInvented, setUseAiInvented] = useState(true);
  const [aiInventedWords, setAiInventedWords] = useState<string[]>([]);
  // True from the moment the server's "preparing" event arrives (see
  // DiscoveryEvent in lib/discovery.ts) until the first real event —
  // "synonyms"/"invented" or the first "checking" — closes the otherwise
  // real, multi-second silent gap while the server awaits the AI calls
  // with a concrete "Getting AI ideas…" state instead of a run that looks
  // like it hasn't started.
  const [gettingIdeas, setGettingIdeas] = useState(false);
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
  const [showFilters, setShowFilters] = useState(false);

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
    fetch(
      `/api/stats?langs=${encodeURIComponent(langsParam)}&maxLength=${maxLength}&keyword=${encodeURIComponent(keywordParam)}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
    return () => controller.abort();
  }, [langsParam, maxLength, keywordParam]);

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
      // Nothing under the current key yet — fall back to the pre-rename
      // key so an existing user's saved results/favorites/settings still
      // come back after the rename, rather than silently resetting to
      // empty. The write effect below saves under the new key on the very
      // next tick, and once that succeeds there's nothing left reading the
      // legacy key, so it's safe to remove here rather than leave two
      // copies of the same data lying around.
      const legacyRaw = raw ? null : localStorage.getItem(LEGACY_STORAGE_KEY);
      const parsed: Partial<PersistedState> = JSON.parse(raw ?? legacyRaw ?? "{}");
      if (parsed.foundHistory) setFoundHistory(dedupeByDomain(parsed.foundHistory));
      if (parsed.favorites) setFavorites(parsed.favorites);
      if (parsed.enabledLangs) setEnabledLangs(parsed.enabledLangs);
      if (parsed.enabledTlds) setEnabledTlds(parsed.enabledTlds);
      if (typeof parsed.maxLength === "number") {
        setMaxLength(Math.min(MAX_COMBINED_LENGTH, Math.max(MIN_COMBINED_LENGTH, parsed.maxLength)));
      }
      if (typeof parsed.resultCount === "number") {
        setResultCount(Math.min(MAX_RESULT_COUNT, Math.max(MIN_RESULT_COUNT, Math.trunc(parsed.resultCount))));
      }
      if (typeof parsed.keywordInput === "string") setKeywordInput(parsed.keywordInput);
      // Merged over the defaults (rather than replacing wholesale) so a
      // state persisted before a given gate existed — including every
      // state persisted before gates existed at all — still defaults that
      // gate to on, instead of `undefined` silently propagating into a
      // query param and being parsed back as "off".
      if (parsed.gates) setGates((prev) => ({ ...prev, ...parsed.gates }));
      if (typeof parsed.autoRank === "boolean") setAutoRank(parsed.autoRank);
      if (typeof parsed.useAiSynonyms === "boolean") setUseAiSynonyms(parsed.useAiSynonyms);
      if (typeof parsed.useAiInvented === "boolean") setUseAiInvented(parsed.useAiInvented);
      if (legacyRaw !== null) localStorage.removeItem(LEGACY_STORAGE_KEY);
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
        resultCount,
        keywordInput,
        gates,
        autoRank,
        useAiSynonyms,
        useAiInvented,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore write failures — persistence is a nice-to-have
    }
  }, [
    hasHydrated,
    foundHistory,
    favorites,
    enabledLangs,
    enabledTlds,
    maxLength,
    resultCount,
    keywordInput,
    gates,
    autoRank,
    useAiSynonyms,
    useAiInvented,
  ]);

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

  // On-demand (via the "Rank" button/CollisionBadge) or automatically per
  // found result when autoRank is on — see the "found" case in start()
  // below. Declared before start() since it's a dependency of that
  // callback. Neither of these two bits of state is persisted — a stuck
  // "loading" badge or stale error message shouldn't survive a reload.
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
    setAiSynonymWords([]);
    setAiInventedWords([]);
    setGettingIdeas(false);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `/api/discover?langs=${encodeURIComponent(langsParam)}&maxLength=${maxLength}&keyword=${encodeURIComponent(keywordParam)}&tlds=${encodeURIComponent(tldsParam)}&count=${resultCount}` +
          `&requireInstagram=${gates.requireInstagram}&filterPronounceable=${gates.filterPronounceable}` +
          `&filterTypos=${gates.filterTypos}&filterNiceness=${gates.filterNiceness}` +
          `&aiSynonyms=${useAiSynonyms}&aiInvented=${useAiInvented}`,
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

          // Any real event other than "preparing" itself means the wait is
          // over — closes the "Getting AI ideas…" state no matter which
          // event turns out to be the first one to actually arrive.
          setGettingIdeas(event.type === "preparing");

          switch (event.type) {
            case "preparing":
              break;
            case "synonyms":
              setAiSynonymWords(event.words);
              break;
            case "invented":
              setAiInventedWords(event.words);
              break;
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
              if (autoRank) checkCollisionFor(event.domain.split(".")[0], event.parts);
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
      // Covers a genuine error (not just Stop, already handled in stop()
      // itself) arriving during the AI-fetch phase, before any SSE event
      // — otherwise "Getting AI ideas…" would stay stuck in the footer
      // the same way an unhandled Stop-during-that-phase used to.
      setGettingIdeas(false);
    }
  }, [
    addChecking,
    resolveLog,
    langsParam,
    maxLength,
    resultCount,
    keywordParam,
    tldsParam,
    gates,
    autoRank,
    checkCollisionFor,
    useAiSynonyms,
    useAiInvented,
  ]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunStatus("stopped");
    // Aborting during the AI-fetch phase (see gettingIdeas) means no more
    // SSE events ever arrive — the fetch just rejects — so nothing else
    // would ever clear this, leaving "Getting AI ideas…" stuck in the
    // footer indefinitely.
    setGettingIdeas(false);
  }, []);

  const searchDomain = useCallback((entry: FoundEntry) => {
    // Search the bare name, not the TLD (e.g. "swiftfox", not "swiftfox.com") —
    // domain here is always name + "." + tld, no subdomains, so splitting on
    // the first "." reliably strips it.
    const name = entry.domain.split(".")[0];
    const url = `https://www.google.com/search?q=${encodeURIComponent(name)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const registerDomain = useCallback((entry: FoundEntry) => {
    window.open(namecheapRegisterUrl(entry.domain), "_blank", "noopener,noreferrer");
  }, []);

  const toggleFavorite = useCallback((entry: FoundEntry) => {
    setFavorites((prev) =>
      prev.some((f) => f.domain === entry.domain)
        ? prev.filter((f) => f.domain !== entry.domain)
        : [entry, ...prev]
    );
  }, []);

  const isRunning = runStatus === "running";
  // Only ever rendered while !isRunning (see the footer below, which shows
  // a fixed "Stop" button instead while a search is active) — no
  // "Searching…" branch needed here.
  const primaryLabel = runStatus === "idle" ? "Start discovery" : "Search again";
  // foundHistory is stored newest-first (new finds are prepended, so
  // Favorites/Previous-results archives read newest-first). But within the
  // *current* run's grid, that ordering made each new find jump to the
  // front and push earlier ones down/right. Reverse just this slice so
  // finds render in discovery order — first found stays put, each new one
  // appends after it — instead of reshuffling the whole grid every find.
  const currentRunResults = foundHistory.filter((e) => e.runId === activeRunId).slice().reverse();
  // Shown in place of an empty screen on load (see the render below): the
  // best resultCount previously-scored results, so returning to an idle app
  // still has something to look at instead of nothing until you search
  // again. Only counts entries actually scored via "Rank" — an unscored
  // result isn't "top" anything, it's just unmeasured, so this stays empty
  // until at least one result has been ranked.
  const topResults = foundHistory
    .filter((e) => e.runId !== activeRunId && e.rankabilityScore !== undefined)
    .slice()
    .sort((a, b) => (b.rankabilityScore ?? 0) - (a.rankabilityScore ?? 0))
    .slice(0, resultCount);
  const topResultIds = new Set(topResults.map((e) => e.id));
  // Ranked best-first (highest rankabilityScore — easiest to actually rank
  // #1 for — at the top), unlike currentRunResults above which preserves
  // discovery order: once a result has aged into history, how promising it
  // is matters more than when it happened to turn up. Entries with no
  // score yet (never checked — see FoundEntry) sort last, via the ?? -1
  // fallback, rather than being scattered among real 0-100 scores. Excludes
  // whatever's already shown in topResults above so the archive doesn't
  // repeat the same cards.
  const previousResults = foundHistory
    .filter((e) => e.runId !== activeRunId && !topResultIds.has(e.id))
    .slice()
    .sort((a, b) => (b.rankabilityScore ?? -1) - (a.rankabilityScore ?? -1));
  const favoriteDomains = useMemo(() => new Set(favorites.map((f) => f.domain)), [favorites]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Top app bar */}
      <header className="shrink-0 border-b border-black/15 bg-background/80 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 backdrop-blur-md dark:border-white/15">
        <div className={`mx-auto flex w-full items-center gap-3 ${CONTENT_WIDTH}`}>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">Namerag</h1>
            <p className="truncate text-xs text-black/65 dark:text-white/65">
              AI rankability scores · {selectedTlds.map((t) => `.${t}`).join(" ")}
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
        <div className={`mx-auto flex w-full flex-col gap-5 ${CONTENT_WIDTH}`}>
          {/* 1. SEARCH CONFIGURATION — collapsed by default (same pattern
              as "Previous results"/"More TLDs" below): the defaults are
              good enough that most searches never need to touch this, so
              it shouldn't cost a screenful of controls on every load. The
              closed toggle summarizes the settings that are actually in
              effect, so nothing is hidden without a trace. */}
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`flex min-h-11 items-start gap-2 rounded-xl border border-dashed border-black/20 px-3.5 py-2.5 text-left text-xs text-black/55 transition-all active:scale-[0.99] hover:bg-black/5 dark:border-white/20 dark:text-white/55 dark:hover:bg-white/10 ${FOCUS_RING}`}
          >
            {/* Wraps rather than truncating — on a narrow screen with a
                keyword set, a single-line ellipsis was cutting off
                whichever settings came last (often the keyword itself),
                hiding them with no way to see them without opening the
                whole panel. */}
            <span className="min-w-0 flex-1">
              Filters · {resultCount} results · {maxLength} chars ·{" "}
              {selectedTlds.length === 1 ? `.${selectedTlds[0]}` : `${selectedTlds.length} TLDs`}
              {stats && ` · ${formatNumber(stats.totalCombinations)} combinations`}
              {keywordParam && ` · "${keywordParam}"`}
            </span>
            <span className="shrink-0">{showFilters ? "▲" : "▾"}</span>
          </button>
          {showFilters && !stats && (
            <section className="flex flex-col gap-3 rounded-2xl border border-black/15 p-4 dark:border-white/15" aria-hidden="true">
              <div className="h-4 w-32 animate-pulse rounded bg-black/5 dark:bg-white/5" />
              <div className="h-11 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
              <div className="h-11 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
            </section>
          )}
          {showFilters && stats && (
            <section className="flex flex-col gap-3 rounded-2xl border border-black/15 p-4 dark:border-white/15">
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <input
                    type="text"
                    inputMode="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    placeholder="Include a word (optional), e.g. nova"
                    maxLength={20}
                    className={`min-h-12 w-full rounded-xl border border-black/15 bg-transparent px-4 text-base outline-none transition-colors placeholder:text-black/45 focus:border-emerald-500/50 dark:border-white/15 dark:placeholder:text-white/45 ${FOCUS_RING}`}
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

              {/* AI generation — two independent, always-visible toggles
                  (never one hiding in place of the other): "AI synonyms"
                  expands the typed keyword into related words to pair with
                  the dictionary (so it's inert with nothing to expand until
                  a keyword exists — shown disabled, not hidden, so that's
                  visible rather than looking like it vanished); "AI-invented
                  names" is a wholly separate mechanism — complete made-up
                  words, no dictionary pairing at all — that works with or
                  without a keyword. */}
              <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10">
                <div className="flex flex-col gap-1">
                  <GateToggle
                    label="AI synonyms"
                    checked={useAiSynonyms}
                    onChange={setUseAiSynonyms}
                    disabled={!keywordParam}
                  />
                  <p className="text-xs text-black/45 dark:text-white/45">
                    {keywordParam ? (
                      <>
                        Also pairs the dictionary with AI-suggested synonyms of &ldquo;{keywordParam}&rdquo; (e.g.
                        &ldquo;blaze&rdquo; for &ldquo;fast&rdquo;) — dictionary pairing on the literal word always
                        runs either way, this only adds more to it.
                      </>
                    ) : (
                      "Type a keyword above to enable — expands it into related words to pair with the dictionary."
                    )}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <GateToggle label="AI-invented names" checked={useAiInvented} onChange={setUseAiInvented} />
                  <p className="text-xs text-black/45 dark:text-white/45">
                    Also searches fully AI-invented brandable words (like &ldquo;Zuvio&rdquo; or &ldquo;Fovixia&rdquo;)
                    — not built from any dictionary word.
                    {keywordParam && ` Themed around "${keywordParam}" since it's typed above.`}
                  </p>
                </div>
              </div>

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
                <p className="text-xs text-black/55 dark:text-white/55">
                  <span className="font-semibold tabular-nums text-black/80 dark:text-white/80">
                    {formatNumber(stats.totalCombinations)}
                  </span>{" "}
                  possible combinations at this length
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-black/55 dark:text-white/55">
                  <span>Results to find</span>
                  <span className="font-semibold tabular-nums text-black/80 dark:text-white/80">{resultCount}</span>
                </div>
                <input
                  type="range"
                  min={MIN_RESULT_COUNT}
                  max={MAX_RESULT_COUNT}
                  step={1}
                  value={resultCount}
                  onChange={(e) => setResultCount(Number(e.target.value))}
                  aria-label="Number of available results to find"
                  className={`h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-emerald-600 dark:bg-white/10 dark:accent-emerald-500 ${FOCUS_RING}`}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {visibleTlds.map((tld) => (
                  <button
                    key={tld}
                    type="button"
                    onClick={() => toggleTld(tld)}
                    aria-pressed={enabledTlds[tld]}
                    className={`min-h-11 rounded-full border px-3.5 text-xs transition-all active:scale-95 ${FOCUS_RING} ${
                      enabledTlds[tld]
                        ? "border-emerald-500/40 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300"
                        : "border-black/15 font-normal text-black/55 hover:bg-black/5 dark:border-white/15 dark:text-white/55 dark:hover:bg-white/10"
                    }`}
                  >
                    .{tld}
                  </button>
                ))}
                {TLDS.length > PRIMARY_TLD_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShowMoreTlds((v) => !v)}
                    className={`min-h-11 rounded-full border border-dashed border-black/20 px-3.5 text-xs text-black/55 transition-all active:scale-95 hover:bg-black/5 dark:border-white/20 dark:text-white/55 dark:hover:bg-white/10 ${FOCUS_RING}`}
                  >
                    {effectiveShowMoreTlds ? "Less ▲" : `More ▾`}
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1 border-t border-black/10 pt-3 dark:border-white/10">
                <GateToggle
                  label="Require Instagram handle"
                  checked={gates.requireInstagram}
                  onChange={(v) => setGates((g) => ({ ...g, requireInstagram: v }))}
                />
                <GateToggle
                  label="Pronounceable only"
                  checked={gates.filterPronounceable}
                  onChange={(v) => setGates((g) => ({ ...g, filterPronounceable: v }))}
                />
                <GateToggle
                  label="Skip typo-like names"
                  checked={gates.filterTypos}
                  onChange={(v) => setGates((g) => ({ ...g, filterTypos: v }))}
                />
                <GateToggle
                  label="Skip awkward names"
                  checked={gates.filterNiceness}
                  onChange={(v) => setGates((g) => ({ ...g, filterNiceness: v }))}
                />
              </div>

              <div className="flex flex-col gap-1 border-t border-black/10 pt-3 dark:border-white/10">
                <GateToggle label="Auto-check rankability" checked={autoRank} onChange={setAutoRank} />
                <p className="text-xs text-black/45 dark:text-white/45">
                  Runs the paid AI rankability check on every result found, not just the ones you pick — off by
                  default to avoid the extra cost.
                </p>
              </div>
            </section>
          )}

          {errorMessage && (
            <p className="animate-fade-in-up rounded-xl bg-red-500/10 px-3.5 py-3 text-sm text-red-700 dark:text-red-400">
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
                  {isRunning && (
                    <span className="text-xs tabular-nums text-black/55 dark:text-white/55">
                      {currentRunFound}/{resultCount}
                    </span>
                  )}
                </div>
              </div>
              {gettingIdeas && (
                <p className="flex items-center gap-1.5 text-xs text-black/45 dark:text-white/45">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-black/40 dark:bg-white/40" />
                  Getting AI ideas before this search starts checking domains…
                </p>
              )}
              {aiSynonymWords.length > 0 && (
                <p className="text-xs text-black/45 dark:text-white/45">
                  Also searching AI synonym{aiSynonymWords.length === 1 ? "" : "s"}: {aiSynonymWords.join(", ")}
                </p>
              )}
              {aiInventedWords.length > 0 && (
                <p className="text-xs text-black/45 dark:text-white/45">
                  Also searching AI-invented name{aiInventedWords.length === 1 ? "" : "s"}:{" "}
                  {aiInventedWords.join(", ")}
                </p>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
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
                    onRegister={() => registerDomain(entry)}
                  />
                ))}
                {isRunning &&
                  Array.from({ length: Math.max(0, resultCount - currentRunResults.length) }).map((_, i) => (
                    <div
                      key={`pending-${i}`}
                      className="h-[76px] animate-pulse rounded-xl border border-dashed border-black/15 bg-black/[0.02] dark:border-white/15 dark:bg-white/[0.02]"
                    />
                  ))}
              </div>
            </section>
          )}

          {/* Top ranked — fills the same slot as "Available domains" once
              there's no live run to show, so loading the app isn't an
              empty screen until you search again: the best resultCount
              already-scored results from history, ranked best-first. */}
          {currentRunResults.length === 0 && !isRunning && topResults.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-black/65 dark:text-white/65">
                Top ranked
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
                {topResults.map((entry) => (
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
                    onRegister={() => registerDomain(entry)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* PROCESS DETAIL — how the current run is going. Grouped with
              the results above it (not down with Favorites/Previous
              results, which are archival and unrelated to what's actively
              running) since both are "what this run is doing right now".
              Rendered only once there's actually something to show — an
              empty log box with a placeholder illustration was pure filler
              on every load before the first search. */}
          {log.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-black/65 dark:text-white/65">
                Live log
              </h2>
              <div
                ref={logBoxRef}
                className="thin-scrollbar max-h-[45vh] overflow-y-auto rounded-xl border border-black/15 p-3 font-mono text-sm dark:border-white/15"
                aria-live="polite"
              >
                <ul className="space-y-0.5">
                  {log.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-2 animate-fade-in-up">
                      <LogDot status={entry.status} />
                      <span className="truncate text-black/90 dark:text-white/90">{entry.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-black/45 dark:text-white/45">
                        {LOG_STATUS_LABEL[entry.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Favorites */}
          {favorites.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-black/65 dark:text-white/65">
                Favorites
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
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
                    onRegister={() => registerDomain(entry)}
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
                className={`flex min-h-11 items-center justify-between rounded-xl border border-dashed border-black/20 px-3.5 text-xs text-black/55 transition-all active:scale-[0.99] hover:bg-black/5 dark:border-white/20 dark:text-white/55 dark:hover:bg-white/10 ${FOCUS_RING}`}
              >
                <span>Previous results ({previousResults.length})</span>
                <span>{showPreviousResults ? "▲" : "▾"}</span>
              </button>
              {showPreviousResults && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2">
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
                      onRegister={() => registerDomain(entry)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {/* Bottom action bar */}
      <footer className="shrink-0 border-t border-black/15 bg-background/80 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-md dark:border-white/15">
        <div className={`mx-auto flex w-full flex-col gap-2 ${CONTENT_WIDTH}`}>
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
            {gettingIdeas ? "Getting AI ideas…" : `${formatNumber(checkedCount)} checked this search`}
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
  onRegister,
}: {
  entry: FoundEntry;
  favorited: boolean;
  collision: CollisionDisplay;
  onSearch: () => void;
  onToggleFavorite: () => void;
  onCheckCollision: () => void;
  onRegister: () => void;
}) {
  return (
    <div className="animate-fade-in-up flex flex-col gap-2 rounded-xl border border-black/15 p-3 transition-colors hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-sm font-semibold text-emerald-700 md:text-base dark:text-emerald-400">
            {entry.domain}
          </span>
          <InstagramBadge status={entry.instagram} />
        </div>
        <div className="-mr-2 flex shrink-0 items-center">
          <button
            onClick={onSearch}
            aria-label="Open a Google search for this name in a new tab"
            title="Google search"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-black/35 transition-colors hover:text-black/55 dark:text-white/35 dark:hover:text-white/55 ${FOCUS_RING}`}
          >
            <SearchIcon size={14} />
          </button>
          <button
            onClick={onToggleFavorite}
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={favorited}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base leading-none transition-transform active:scale-90 ${FOCUS_RING} ${
              favorited ? "text-emerald-500" : "text-black/35 hover:text-black/55 dark:text-white/35 dark:hover:text-white/55"
            }`}
          >
            {favorited ? "★" : "☆"}
          </button>
        </div>
      </div>
      <span className="text-xs text-black/55 md:text-sm dark:text-white/55">{entry.meaning}</span>
      <CollisionBadge collision={collision} onCheck={onCheckCollision} />
      <button
        onClick={onRegister}
        className={`flex min-h-11 w-full items-center justify-center rounded-lg bg-emerald-600 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-emerald-500 md:text-sm dark:bg-emerald-500 dark:text-black dark:hover:bg-emerald-400 ${FOCUS_RING}`}
      >
        Register on Namecheap
      </button>
    </div>
  );
}

/** A labeled on/off switch for one DiscoveryGates flag — emerald when on, matching the app's one-accent-color convention, with the thumb position (not just color) carrying the state. */
function GateToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Renders the switch inert and dimmed — e.g. "AI synonyms" has nothing to synonym-expand without a keyword typed, but still stays visible (rather than disappearing) so it never reads as if a different toggle took its place. */
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex min-h-9 items-center justify-between gap-3 text-xs text-black/65 dark:text-white/65 ${disabled ? "opacity-40" : ""}`}
    >
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${disabled ? "cursor-not-allowed" : ""} ${FOCUS_RING} ${
          checked ? "bg-emerald-500" : "bg-black/15 dark:bg-white/20"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  // Emerald is reserved for "found" (the one positive outcome) and red for
  // "error" (the one failure state) — every other status is grayscale,
  // told apart by its label and (for "running") motion rather than a
  // third accent color.
  const map: Record<RunStatus, { label: string; dot: string }> = {
    idle: { label: "Idle", dot: "bg-black/35 dark:bg-white/35" },
    running: { label: "Running", dot: "bg-black/50 animate-pulse dark:bg-white/50" },
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

// Emerald marks the one positive outcome ("available"); every other status
// is grayscale, told apart by motion ("checking" pulses, nothing else does)
// and by the status word LOG_STATUS_LABEL prints next to it — never by hue
// alone, so the log stays legible without relying on color perception.
const LOG_STATUS_LABEL: Record<LogStatus, string> = {
  checking: "checking…",
  taken: "taken",
  unknown: "unknown",
  available: "available",
  filtered: "filtered",
};

function LogDot({ status }: { status: LogStatus }) {
  const className =
    status === "checking"
      ? "bg-black/40 animate-pulse dark:bg-white/40"
      : status === "available"
        ? "bg-emerald-500"
        : "bg-black/30 dark:bg-white/30";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />;
}

// "unknown" (Instagram's response was inconclusive, e.g. rate-limited) or
// no field at all (an entry persisted before this existed) both render
// nothing — there's nothing useful to tell the user in either case, and the
// "Instagram" button below still works either way.
// Every result in this list already passed the "domain + Instagram both
// available" gate in runDiscovery (see discovery.ts) — so "available" is
// the expected, unremarkable case for a card that exists at all, and
// saying so on every single card is noise, not information. "taken" only
// happens via the rare fallback where Instagram checking got disabled
// mid-search (see INSTAGRAM_BLOCKED_STREAK_THRESHOLD) and a domain-only
// match started counting — that's the one outcome actually worth flagging,
// so it's the only one rendered here. "unknown" (inconclusive check) is
// unremarkable in the same way "available" is and also renders nothing.
function InstagramBadge({ status }: { status: InstagramStatus | undefined }) {
  if (status !== "taken") return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-black/40 dark:text-white/40"
      title="This name's domain is available, but the matching Instagram handle isn't"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-black/30 dark:bg-white/30" />
      IG taken
    </span>
  );
}

// Domain/Instagram availability (see above) says nothing about whether a
// name already means something real in the world — see lib/collision.ts.
// score is 0-100: 0 as unrankable as "Google" itself, 100 as wide open as a
// long random string with no real-world usage anywhere. undefined until
// checked on demand via the "Rank" button below; once scored,
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
      <span className="flex items-center gap-1.5 text-xs text-black/45 dark:text-white/45">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-black/40 dark:bg-white/40" />
        Checking…
      </span>
    );
  }
  if (collision.error) {
    return (
      <button
        type="button"
        onClick={onCheck}
        className={`self-start text-xs font-medium text-red-600 underline decoration-red-600/40 underline-offset-2 transition-colors hover:text-red-700 dark:text-red-400 dark:decoration-red-400/40 dark:hover:text-red-300 ${FOCUS_RING}`}
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
        className={`flex min-h-11 w-full items-center justify-center rounded-lg border border-emerald-600/30 text-xs font-medium text-emerald-700 transition-all active:scale-95 hover:bg-emerald-500/10 md:text-sm dark:text-emerald-300 ${FOCUS_RING}`}
      >
        Rank
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-semibold tabular-nums md:text-sm ${scoreColorClass(collision.score)}`}>
          {collision.score}% rankable
        </span>
        <button
          type="button"
          onClick={onCheck}
          className={`text-xs font-medium text-black/45 underline decoration-black/25 underline-offset-2 transition-colors hover:text-black/65 md:text-sm dark:text-white/45 dark:decoration-white/25 dark:hover:text-white/65 ${FOCUS_RING}`}
        >
          Rescore
        </button>
      </div>
      {collision.summary && (
        <span className="text-xs leading-snug text-black/55 md:text-sm dark:text-white/55">{collision.summary}</span>
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

