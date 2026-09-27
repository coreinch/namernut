import { useCallback, useEffect, useRef, useState } from "react";
import type { DiscoveryGates } from "@/lib/discovery";
import type { FoundEntry, LogEntry, LogStatus, RunStatus } from "@/lib/types";
import { DEFAULT_RESULT_COUNT, type RegionOption } from "@/lib/searchConfig";
import { MAX_FOUND_HISTORY } from "./usePersistedAppState";

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

// Mirrors parseKeyword in src/lib/candidates.ts — digits are kept
// (domains can legally contain them), only letters/digits survive.
// Exported since page.tsx needs the same sanitization to derive its
// keywordParam (passed into this hook) from the raw keyword input.
export function sanitizeKeyword(raw: string) {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
}

interface UseDiscoveryRunParams {
  langsParam: string;
  maxLength: number;
  keywordParam: string;
  tldsParam: string;
  gates: DiscoveryGates;
  region: RegionOption;
  useAiSynonyms: boolean;
  useAiInvented: boolean;
  useAltSpellings: boolean;
  foundDomainsRef: React.RefObject<Set<string>>;
  scoredNamesRef: React.RefObject<Map<string, { brandabilityScore: number; brandabilitySummary?: string }>>;
  setFoundHistory: React.Dispatch<React.SetStateAction<FoundEntry[]>>;
  setFavorites: React.Dispatch<React.SetStateAction<FoundEntry[]>>;
}

// Owns one live discovery run end to end: kicking off the /api/discover SSE
// stream, parsing its events into log/result state, and the on-demand
// brandability re-check triggered per result. Entirely independent of
// usePersistedAppState beyond the handful of refs/setters it's handed —
// this hook never reads localStorage itself, it only ever appends into the
// history/favorites state that hook owns.
export function useDiscoveryRun({
  langsParam,
  maxLength,
  keywordParam,
  tldsParam,
  gates,
  region,
  useAiSynonyms,
  useAiInvented,
  useAltSpellings,
  foundDomainsRef,
  scoredNamesRef,
  setFoundHistory,
  setFavorites,
}: UseDiscoveryRunParams) {
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [checkedCount, setCheckedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // On by default: this is one LLM call per search start (not per found
  // result), and it's purely additive on top of the dictionary pairing that
  // always runs anyway — see suggestKeywordSynonyms in lib/synonyms.ts and
  // selectTierSpecs in lib/candidates.ts. Only ever meaningful when a
  // keyword is actually typed. Populated once per search from the
  // "synonyms" SSE event — not persisted, purely a live display of what the
  // current/last run actually searched, the same as `log`.
  const [aiSynonymWords, setAiSynonymWords] = useState<string[]>([]);
  const [aiInventedWords, setAiInventedWords] = useState<string[]>([]);
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
  // Only the user-triggered Stop button (below) called abortRef.current's
  // abort() otherwise — an unmount mid-search (React Strict Mode's dev-only
  // double-invoke today; a future route change away from "/" tomorrow)
  // left the /api/discover stream fetch running and its setState calls
  // firing against an unmounted component instead.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

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
  // start() below. Neither of these two bits of state is persisted — a
  // stuck "loading" badge or stale error message shouldn't survive a
  // reload.
  const [checkingBrandabilityNames, setCheckingBrandabilityNames] = useState<Set<string>>(new Set());
  const [brandabilityErrors, setBrandabilityErrors] = useState<Record<string, string>>({});

  const checkBrandabilityFor = useCallback((name: string, parts: [string, string] | undefined) => {
    // A name found under several selected TLDs fires one "found" event per
    // TLD, each independently calling this — without this guard every one
    // of them fired its own real, metered /api/brandability request (a
    // paid search + LLM call) for the identical name.
    let alreadyChecking = false;
    setCheckingBrandabilityNames((prev) => {
      if (prev.has(name)) {
        alreadyChecking = true;
        return prev;
      }
      return new Set(prev).add(name);
    });
    if (alreadyChecking) return;
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
        // No provider param — which search provider actually runs is
        // decided and, on failure, retried with the other one entirely
        // server-side now (see searchWithFallback in brandability.ts).
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
        // See scoredNamesRef's declaration — lets a later "found" event for
        // this same name (a different TLD, or a later run) reuse this score
        // instead of firing another metered check.
        scoredNamesRef.current.set(name, { brandabilityScore, brandabilitySummary: summary });
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
  }, [region, setFoundHistory, setFavorites, scoredNamesRef]);

  // Which search provider actually backs a given check is no longer
  // something the client knows or controls at all (see checkBrandabilityFor
  // and /api/brandability's route — the server picks and falls back on its
  // own now, see searchWithFallback in brandability.ts). Fires the paid,
  // metered brandability check on every found result rather than only the
  // ones a user picks via "Brandability".
  const autoCheck = true;

  // overrideKeyword lets a caller (see page.tsx's tryExample) run a search
  // with a specific keyword in the same click that sets it, rather than
  // calling setKeywordInput and start() back to back — React doesn't apply
  // a setState call before the rest of the same event handler runs, so
  // start() would otherwise still see the *previous* keywordInput/
  // keywordParam value (a stale closure over pre-update state) for that
  // one run.
  const start = useCallback(async (overrideKeyword?: string) => {
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

    const effectiveKeywordParam = overrideKeyword !== undefined ? sanitizeKeyword(overrideKeyword) : keywordParam;

    try {
      const res = await fetch(
        `/api/discover?langs=${encodeURIComponent(langsParam)}&maxLength=${maxLength}&keyword=${encodeURIComponent(effectiveKeywordParam)}&tlds=${encodeURIComponent(tldsParam)}&count=${DEFAULT_RESULT_COUNT}` +
          `&requireInstagram=${gates.requireInstagram}&requireGithub=${gates.requireGithub}&requireTiktok=${gates.requireTiktok}` +
          `&requireNpm=${gates.requireNpm}&requireYoutube=${gates.requireYoutube}&requireTwitter=${gates.requireTwitter}` +
          `&filterPronounceable=${gates.filterPronounceable}` +
          `&filterTypos=${gates.filterTypos}&filterNiceness=${gates.filterNiceness}` +
          `&aiSynonyms=${useAiSynonyms}&aiInvented=${useAiInvented}&altSpellings=${useAltSpellings}`,
        { signal: controller.signal }
      );
      // A non-2xx response (e.g. the rate limit in /api/discover) is a
      // plain JSON error body, not an SSE stream — has to be checked
      // before the read loop below, which otherwise has no way to tell
      // "an error event arrived" apart from "this isn't SSE at all".
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
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
              // Each search is independently reseeded with no exclusion of
              // domains a previous run already found (see start() above),
              // so re-running discovery (or clicking "Search again") can
              // legitimately rediscover the same available domain. Checked
              // synchronously against foundDomainsRef rather than inside
              // setFoundHistory's updater — React doesn't guarantee that
              // updater runs before this handler returns, so it can't be
              // used to gate the checkBrandabilityFor call below.
              const isNewFind = !foundDomainsRef.current.has(event.domain);
              const bareName = event.domain.split(".")[0];
              // See scoredNamesRef's declaration — a name already scored
              // under a different TLD (or in an earlier run) shares that
              // score here too, rather than paying for another check.
              const cachedScore = scoredNamesRef.current.get(bareName);
              if (isNewFind) {
                foundDomainsRef.current.add(event.domain);
                setFoundHistory((prev) => {
                  const next = [
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
                      github: event.github,
                      tiktok: event.tiktok,
                      npm: event.npm,
                      youtube: event.youtube,
                      twitter: event.twitter,
                      source: event.source,
                      ...(cachedScore
                        ? {
                            brandabilityScore: cachedScore.brandabilityScore,
                            brandabilitySummary: cachedScore.brandabilitySummary,
                          }
                        : {}),
                    },
                    ...prev,
                  ];
                  // See MAX_FOUND_HISTORY's declaration — bounds unbounded
                  // localStorage growth. Newest-first, so this drops the
                  // oldest entries once the cap is exceeded.
                  return next.length > MAX_FOUND_HISTORY ? next.slice(0, MAX_FOUND_HISTORY) : next;
                });
              }
              resolveLog(event.domain, "available");
              // autoCheck is always true now — see its declaration above.
              // Skipped when this exact domain was already found
              // (isNewFind false) or its bare name already has a resolved
              // score (cachedScore) — either would just burn another
              // metered Serper/Kilocode call and the brandability rate
              // limit for a result we already have. A check still in
              // flight for this name is handled by checkBrandabilityFor's
              // own checkingBrandabilityNames guard, not here.
              if (autoCheck && isNewFind && !cachedScore) checkBrandabilityFor(bareName, event.parts);
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
    keywordParam,
    tldsParam,
    gates,
    autoCheck,
    checkBrandabilityFor,
    useAiSynonyms,
    useAiInvented,
    useAltSpellings,
    foundDomainsRef,
    scoredNamesRef,
    setFoundHistory,
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

  return {
    runStatus,
    log,
    checkedCount,
    currentRunFound,
    activeRunId,
    gettingIdeas,
    aiSynonymWords,
    aiInventedWords,
    altSpellingWords,
    errorMessage,
    logBoxRef,
    checkingBrandabilityNames,
    brandabilityErrors,
    start,
    stop,
    checkBrandabilityFor,
  };
}
