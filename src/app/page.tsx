"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiscoveryGates } from "@/lib/discovery";
import type { FoundEntry, LogEntry, LogStatus, RunStatus } from "@/lib/types";
import {
  DEFAULT_COMBINED_LENGTH,
  DEFAULT_REGION,
  DEFAULT_RESULT_COUNT,
  LANGS,
  MAX_COMBINED_LENGTH,
  MAX_RESULT_COUNT,
  MIN_COMBINED_LENGTH,
  MIN_RESULT_COUNT,
  PRIMARY_TLD_COUNT,
  REGION_OPTIONS,
  TLDS,
  type DictionaryStats,
  type Lang,
  type RegionOption,
  type Tld,
} from "@/lib/searchConfig";
import { CONTENT_WIDTH, FOCUS_RING } from "@/components/constants";
import { Header, tabButtonId, tabPanelId, type ResultsTab } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { FiltersPanel } from "@/components/FiltersPanel";
import { ResultsGrid } from "@/components/ResultsGrid";
import { LiveLogSection } from "@/components/LiveLogSection";

interface PersistedState {
  foundHistory: FoundEntry[];
  favorites: FoundEntry[];
  enabledLangs: Record<Lang, boolean>;
  enabledTlds: Record<Tld, boolean>;
  maxLength: number;
  resultCount: number;
  keywordInput: string;
  gates: DiscoveryGates;
  region: RegionOption;
  useAiSynonyms: boolean;
  useAiInvented: boolean;
  useAltSpellings: boolean;
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

const MAX_LOG_ENTRIES = 200;

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
// one already carries a brandability score over an unscored duplicate. Used
// to clean up persisted state from before the "found" handler started
// guarding against this (see start() below) — a re-run of discovery, with
// no exclusion of domains an earlier run already found, could legitimately
// rediscover the same available domain and add a second entry for it,
// which then rendered as a duplicate card in Previous results. Keeps the
// original relative order (by first occurrence) rather than reshuffling.
// Maps a persisted FoundEntry still using the pre-rename field names
// (rankabilityScore/collisionSummary, from before "collision"/"rank"
// terminology became "brandability") onto the current ones, so existing
// users don't silently lose previously-computed scores just because the
// field was renamed. A no-op for any entry that already has the new field.
function migrateLegacyEntry(entry: FoundEntry): FoundEntry {
  const legacy = entry as FoundEntry & { rankabilityScore?: number; collisionSummary?: string };
  if (entry.brandabilityScore !== undefined || legacy.rankabilityScore === undefined) return entry;
  return { ...entry, brandabilityScore: legacy.rankabilityScore, brandabilitySummary: legacy.collisionSummary };
}

function dedupeByDomain(entries: FoundEntry[]): FoundEntry[] {
  const bestByDomain = new Map<string, FoundEntry>();
  for (const entry of entries) {
    const existing = bestByDomain.get(entry.domain);
    if (!existing || (existing.brandabilityScore === undefined && entry.brandabilityScore !== undefined)) {
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
  const [region, setRegion] = useState<RegionOption>(DEFAULT_REGION);
  // On by default: this is one LLM call per search start (not per found
  // result), and it's purely additive on top of the dictionary pairing that
  // always runs anyway — see suggestKeywordSynonyms in lib/synonyms.ts and
  // selectTierSpecs in lib/candidates.ts. Only ever meaningful when a
  // keyword is actually typed.
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
  // Off by default — opposite polarity from the two AI toggles above. Not
  // because it costs anything (it's a deterministic regex respelling of
  // the keyword, see lib/alternateSpelling.ts, no LLM call at all) but
  // because it's a newer, less-proven candidate source that can produce
  // odd-looking names (e.g. "kool" for "cool"), and its candidates skip
  // the "Pronounceable only" gate entirely (see altSpellingSet in
  // runDiscovery) — a respelling like "lyft" would otherwise almost always
  // get rejected by that check, so this generator bypasses it on purpose.
  // Opt-in rather than assumed wanted. Only ever meaningful when a keyword
  // is typed.
  const [useAltSpellings, setUseAltSpellings] = useState(false);
  const [altSpellingWords, setAltSpellingWords] = useState<string[]>([]);
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Which of the three result sections is on screen — replaces the old
  // always-stacked current run / top ranked / favorites / previous results
  // sections with one switch (see Header's tab control). Not persisted:
  // reloading the page is a fresh look at the app, and "Current" is always
  // the most relevant place to land.
  const [activeTab, setActiveTab] = useState<ResultsTab>("current");

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
      if (parsed.foundHistory) setFoundHistory(dedupeByDomain(parsed.foundHistory.map(migrateLegacyEntry)));
      if (parsed.favorites) setFavorites(parsed.favorites.map(migrateLegacyEntry));
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
      if (REGION_OPTIONS.some((opt) => opt.value === parsed.region)) setRegion(parsed.region as RegionOption);
      if (typeof parsed.useAiSynonyms === "boolean") setUseAiSynonyms(parsed.useAiSynonyms);
      if (typeof parsed.useAiInvented === "boolean") setUseAiInvented(parsed.useAiInvented);
      if (typeof parsed.useAltSpellings === "boolean") setUseAltSpellings(parsed.useAltSpellings);
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
        region,
        useAiSynonyms,
        useAiInvented,
        useAltSpellings,
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
    region,
    useAiSynonyms,
    useAiInvented,
    useAltSpellings,
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

  // On-demand only, via the "Brandability" button/BrandabilityBadge — see
  // checkBrandabilityFor below. Declared before start() since it's a
  // dependency of that callback. Neither of these two bits of state is
  // persisted — a stuck "loading" badge or stale error message shouldn't
  // survive a reload.
  const [checkingBrandabilityNames, setCheckingBrandabilityNames] = useState<Set<string>>(new Set());
  const [brandabilityErrors, setBrandabilityErrors] = useState<Record<string, string>>({});

  const checkBrandabilityFor = useCallback((name: string, parts: [string, string] | undefined) => {
    setCheckingBrandabilityNames((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
    setBrandabilityErrors((prev) => {
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
        const res = await fetch(
          `/api/brandability?name=${encodeURIComponent(name)}${partsParam}&region=${encodeURIComponent(region)}`
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        const { brandabilityScore, summary } = body as { brandabilityScore: number; summary: string };
        // Keyed by bare name (not domain — a result found under several
        // TLDs shares one score), so every matching entry across both
        // arrays gets updated, not just the one card that was clicked.
        const applyScore = (entry: FoundEntry): FoundEntry =>
          entry.domain.split(".")[0] === name
            ? { ...entry, brandabilityScore, brandabilitySummary: summary }
            : entry;
        setFoundHistory((prev) => prev.map(applyScore));
        setFavorites((prev) => prev.map(applyScore));
      } catch (err) {
        setBrandabilityErrors((prev) => ({
          ...prev,
          [name]: err instanceof Error ? err.message : "Check failed",
        }));
      } finally {
        setCheckingBrandabilityNames((prev) => {
          if (!prev.has(name)) return prev;
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    })();
  }, [region]);

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
    setAltSpellingWords([]);
    setGettingIdeas(false);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `/api/discover?langs=${encodeURIComponent(langsParam)}&maxLength=${maxLength}&keyword=${encodeURIComponent(keywordParam)}&tlds=${encodeURIComponent(tldsParam)}&count=${resultCount}` +
          `&requireInstagram=${gates.requireInstagram}&filterPronounceable=${gates.filterPronounceable}` +
          `&filterTypos=${gates.filterTypos}&filterNiceness=${gates.filterNiceness}` +
          `&aiSynonyms=${useAiSynonyms}&aiInvented=${useAiInvented}&altSpellings=${useAltSpellings}`,
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
            case "altSpellings":
              setAltSpellingWords(event.words);
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
                // already carry a brandability score from being checked
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
                    source: event.source,
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
    useAiSynonyms,
    useAiInvented,
    useAltSpellings,
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
  // Favorites/Archive read newest-first). But within the *current* run's
  // list, that ordering made each new find jump to the front and push
  // earlier ones down. Reverse just this slice so finds render in discovery
  // order — first found stays put, each new one appends after it — instead
  // of reshuffling the whole list every find.
  const currentRunResults = foundHistory.filter((e) => e.runId === activeRunId).slice().reverse();
  // Everything not from the active run, ranked best-first (highest
  // brandabilityScore — easiest to actually rank #1 for — at the top): once
  // a result has aged out of the current run, how promising it is matters
  // more than when it happened to turn up. Entries with no score yet
  // (never checked — see FoundEntry) sort last, via the ?? -1 fallback,
  // rather than being scattered among real 0-100 scores. Always reachable
  // via the Archive tab (see Header) — there's no separate "top ranked"
  // slot to fill an idle screen anymore, since the tab itself is always on
  // screen.
  const archiveResults = foundHistory
    .filter((e) => e.runId !== activeRunId)
    .slice()
    .sort((a, b) => (b.brandabilityScore ?? -1) - (a.brandabilityScore ?? -1));
  const favoriteDomains = useMemo(() => new Set(favorites.map((f) => f.domain)), [favorites]);
  const statusText = gettingIdeas ? "Getting AI ideas…" : `${formatNumber(checkedCount)} checked this search`;
  const tabCounts: Record<ResultsTab, number> = {
    current: currentRunResults.length,
    favorites: favorites.length,
    archive: archiveResults.length,
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Header status={runStatus} activeTab={activeTab} onTabChange={setActiveTab} counts={tabCounts} />

      <main className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">
        <div className={`mx-auto flex w-full flex-col gap-5 ${CONTENT_WIDTH}`}>
          <FiltersPanel
            showAdvanced={showAdvanced}
            onToggleShowAdvanced={() => setShowAdvanced((v) => !v)}
            stats={stats}
            keywordInput={keywordInput}
            onKeywordInputChange={setKeywordInput}
            keywordParam={keywordParam}
            useAiSynonyms={useAiSynonyms}
            onUseAiSynonymsChange={setUseAiSynonyms}
            useAiInvented={useAiInvented}
            onUseAiInventedChange={setUseAiInvented}
            useAltSpellings={useAltSpellings}
            onUseAltSpellingsChange={setUseAltSpellings}
            maxLength={maxLength}
            onMaxLengthChange={setMaxLength}
            resultCount={resultCount}
            onResultCountChange={setResultCount}
            selectedTlds={selectedTlds}
            visibleTlds={visibleTlds}
            enabledTlds={enabledTlds}
            onToggleTld={toggleTld}
            effectiveShowMoreTlds={effectiveShowMoreTlds}
            onToggleShowMoreTlds={() => setShowMoreTlds((v) => !v)}
            gates={gates}
            onGatesChange={setGates}
            region={region}
            onRegionChange={setRegion}
            isRunning={isRunning}
            primaryLabel={primaryLabel}
            onStart={start}
            onStop={stop}
          />

          {errorMessage && (
            <p className="animate-fade-in-up rounded-2xl bg-red-500/10 px-3.5 py-3 text-sm text-red-700 dark:text-red-400">
              {errorMessage}
            </p>
          )}

          {activeTab === "current" && (
            <section
              role="tabpanel"
              id={tabPanelId("current")}
              aria-labelledby={tabButtonId("current")}
              tabIndex={0}
              className={`flex flex-col gap-2 ${FOCUS_RING}`}
            >
              {isRunning && (
                <div className="flex items-center justify-end">
                  <span className="text-xs tabular-nums text-muted">
                    {currentRunFound}/{resultCount}
                  </span>
                </div>
              )}
              {gettingIdeas && (
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-black/40 dark:bg-white/40" />
                  Getting AI ideas before this search starts checking domains…
                </p>
              )}
              {aiSynonymWords.length > 0 && (
                <p className="text-xs text-muted">
                  Also searching AI synonym{aiSynonymWords.length === 1 ? "" : "s"}: {aiSynonymWords.join(", ")}
                </p>
              )}
              {aiInventedWords.length > 0 && (
                <p className="text-xs text-muted">
                  Also searching AI-invented name{aiInventedWords.length === 1 ? "" : "s"}:{" "}
                  {aiInventedWords.join(", ")}
                </p>
              )}
              {altSpellingWords.length > 0 && (
                <p className="text-xs text-muted">
                  Also searching alt spelling{altSpellingWords.length === 1 ? "" : "s"}: {altSpellingWords.join(", ")}
                  {gates.filterPronounceable &&
                    // Only worth saying while the gate is actually on —
                    // with it off there's nothing being skipped to call
                    // out. Surfaced here (not just in the collapsed
                    // Advanced filters panel) since this is the live,
                    // no-need-to-expand-anything view of what a run is
                    // actually doing.
                    ' — these skip the "Pronounceable only" filter below.'}
                </p>
              )}
              {currentRunResults.length === 0 && !isRunning ? (
                <p className="py-8 text-center text-sm text-muted">
                  Type an idea above and hit Generate to see results here.
                </p>
              ) : (
                <ResultsGrid
                  entries={currentRunResults}
                  favoriteDomains={favoriteDomains}
                  checkingBrandabilityNames={checkingBrandabilityNames}
                  brandabilityErrors={brandabilityErrors}
                  onSearch={searchDomain}
                  onToggleFavorite={toggleFavorite}
                  onCheckBrandability={checkBrandabilityFor}
                  onRegister={registerDomain}
                  pendingCount={isRunning ? Math.max(0, resultCount - currentRunResults.length) : 0}
                />
              )}
              <LiveLogSection log={log} logBoxRef={logBoxRef} />
            </section>
          )}

          {activeTab === "favorites" && (
            <section
              role="tabpanel"
              id={tabPanelId("favorites")}
              aria-labelledby={tabButtonId("favorites")}
              tabIndex={0}
              className={`flex flex-col gap-2 ${FOCUS_RING}`}
            >
              {favorites.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  Tap the star on a result to save it here.
                </p>
              ) : (
                <ResultsGrid
                  entries={favorites}
                  favoriteDomains={favoriteDomains}
                  checkingBrandabilityNames={checkingBrandabilityNames}
                  brandabilityErrors={brandabilityErrors}
                  onSearch={searchDomain}
                  onToggleFavorite={toggleFavorite}
                  onCheckBrandability={checkBrandabilityFor}
                  onRegister={registerDomain}
                />
              )}
            </section>
          )}

          {activeTab === "archive" && (
            <section
              role="tabpanel"
              id={tabPanelId("archive")}
              aria-labelledby={tabButtonId("archive")}
              tabIndex={0}
              className={`flex flex-col gap-2 ${FOCUS_RING}`}
            >
              {archiveResults.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  Past searches will collect here once you run more than one.
                </p>
              ) : (
                <ResultsGrid
                  entries={archiveResults}
                  favoriteDomains={favoriteDomains}
                  checkingBrandabilityNames={checkingBrandabilityNames}
                  brandabilityErrors={brandabilityErrors}
                  onSearch={searchDomain}
                  onToggleFavorite={toggleFavorite}
                  onCheckBrandability={checkBrandabilityFor}
                  onRegister={registerDomain}
                />
              )}
            </section>
          )}
        </div>
      </main>

      <Footer isRunning={isRunning} statusText={statusText} onStop={stop} />
    </div>
  );
}
