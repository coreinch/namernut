"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FoundEntry } from "@/lib/types";
import {
  DEFAULT_RESULT_COUNT,
  PRIMARY_TLD_COUNT,
  TLDS,
  type DictionaryStats,
  type Lang,
  type Tld,
} from "@/lib/searchConfig";
import { CONTENT_WIDTH, FOCUS_RING, PAGE_WIDTH } from "@/components/constants";
import { Header, tabButtonId, tabPanelId, type ResultsTab } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SearchBar } from "@/components/SearchBar";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { ResultsGrid } from "@/components/ResultsGrid";
import { LiveLogSection } from "@/components/LiveLogSection";
import { usePersistedAppState } from "@/hooks/usePersistedAppState";
import { useDiscoveryRun, sanitizeKeyword } from "@/hooks/useDiscoveryRun";

// Fed to tryExample below (the example-keyword chips) — "glow" was
// verified directly to produce real, varied output (dictionary pairings
// plus AI synonyms/invented names) rather than a picked-for-looks string
// that might not actually demonstrate the product; the rest are plain
// dictionary words chosen to span different business categories (food,
// creative services, tech) so a first-time visitor is more likely to see
// one land near their own idea than with a single fixed example. Each is
// deliberately a single plain word, same reasoning as before: the keyword
// field only ever pairs one dictionary/AI word onto this literal string
// (see sanitizeKeyword in hooks/useDiscoveryRun.ts and parseKeyword in
// lib/candidates.ts, which strips anything past 15 characters and
// non-alphanumerics) — it was never a "describe your idea" field, so the
// examples have to be honest about that rather than modeling a longer
// pitch a first-time visitor might reasonably try typing themselves.
const EXAMPLE_KEYWORDS = ["glow", "coffee", "studio", "nova"];

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
  const {
    foundHistory,
    setFoundHistory,
    favorites,
    setFavorites,
    enabledLangs,
    enabledTlds,
    setEnabledTlds,
    maxLength,
    setMaxLength,
    keywordInput,
    setKeywordInput,
    gates,
    setGates,
    region,
    setRegion,
    useAiSynonyms,
    setUseAiSynonyms,
    useAiInvented,
    setUseAiInvented,
    useAltSpellings,
    setUseAltSpellings,
    foundDomainsRef,
    scoredNamesRef,
  } = usePersistedAppState();

  const [stats, setStats] = useState<DictionaryStats | null>(null);
  const [showMoreTlds, setShowMoreTlds] = useState(false);
  // Mobile/`<lg` only (see SettingsDrawer) — on `lg:` screens SettingsPanel
  // renders inline as a permanent rail instead, so this stays false there
  // regardless of what triggered a stray `true` (e.g. a resize while open).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which of the three result sections is on screen — replaces the old
  // always-stacked current run / top ranked / favorites / previous results
  // sections with one switch (see Header's tab control). Not persisted:
  // reloading the page is a fresh look at the app, and "Current" is always
  // the most relevant place to land.
  const [activeTab, setActiveTab] = useState<ResultsTab>("current");
  // Archive accumulates every past search's results (see archiveResults
  // below) with no cap — a returning user can easily have hundreds of
  // entries there and no way to jump to the one they remember, hence the
  // filter box rendered alongside it.
  const [archiveFilter, setArchiveFilter] = useState("");

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
  }, [setEnabledTlds]);

  useEffect(() => {
    // Abort the previous in-flight request on every re-run (including on
    // unmount): without this, the very first fetch — dispatched on mount
    // with the default all-languages selection, before localStorage
    // hydration restores the real one a moment later — can resolve *after*
    // the second, correct-filters request and silently overwrite it with
    // the stale, unfiltered pool size. Aborting means only the latest
    // request's response can ever reach setStats.
    const controller = new AbortController();
    // keywordParam changes on every keystroke in the keyword field — debounce
    // so typing doesn't fire a request per character.
    const id = setTimeout(() => {
      fetch(
        `/api/stats?langs=${encodeURIComponent(langsParam)}&maxLength=${maxLength}&keyword=${encodeURIComponent(keywordParam)}`,
        { signal: controller.signal }
      )
        // A non-2xx response (e.g. STATS_RATE_LIMIT hit) is a plain
        // {error: "..."} JSON body, not a DictionaryStats shape — passing
        // it straight to setStats crashed SettingsPanel's
        // formatNumber(stats.totalCombinations) on the resulting
        // `undefined`. Match the res.ok guard already used by the
        // discover/brandability fetches below.
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) setStats(data);
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [langsParam, maxLength, keywordParam]);

  const {
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
  } = useDiscoveryRun({
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
  });

  // Example-keyword chips — fill the input and run a real search in one
  // click, with zero typing, so a first-time visitor sees actual output
  // (names, live domain/Instagram availability, and a brandability score
  // once auto-check resolves) before deciding whether to try their own
  // idea. setKeywordInput keeps the input box visibly in sync with
  // whichever example was clicked; start(keyword) is what makes the run
  // itself use it immediately rather than the pre-click (likely empty)
  // keywordInput — see start's own comment on overrideKeyword for why
  // passing it directly is necessary here.
  const tryExample = useCallback((keyword: string) => {
    setKeywordInput(keyword);
    start(keyword);
  }, [start, setKeywordInput]);

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
  }, [setFavorites]);

  // Only ever wired to the Current/Archive tabs (see ResultCard's own
  // comment on why Favorites omits this) — doesn't touch `favorites`,
  // which is intentionally a separate, durable copy (see toggleFavorite
  // above) rather than a reference into foundHistory. Also drops the
  // domain from foundDomainsRef: without this, a later run that
  // legitimately rediscovers the same available domain would have its
  // "found" handler see isNewFind === false (see useDiscoveryRun's start())
  // and silently skip re-adding it — removal would look like it worked
  // once, then quietly made that domain unreachable forever.
  const removeEntry = useCallback((entry: FoundEntry) => {
    setFoundHistory((prev) => prev.filter((e) => e.id !== entry.id));
    foundDomainsRef.current.delete(entry.domain);
  }, [setFoundHistory, foundDomainsRef]);

  const isRunning = runStatus === "running";

  // The Footer (see below) only renders while isRunning — its own "Stop"
  // button unmounts the instant a run ends, whether from actually finishing
  // or from that same button being clicked. A mouse user never notices
  // (there's nothing left to click there anyway), but a keyboard/screen-
  // reader user who had focus on it gets silently dropped to <body> — the
  // same failure mode ResultCard's onRemove and SettingsDrawer's onClose
  // both hand focus off explicitly to avoid. Unlike those two, there's no
  // single natural "next" element already in hand here, so this checks
  // whether focus actually landed on <body> (the one-node signature of an
  // unmounted-out-from-under-you focus loss) before redirecting it — never
  // steals focus from something the user is legitimately doing elsewhere.
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && document.activeElement === document.body) {
      document.getElementById("primary-search-action")?.focus();
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  // Only ever rendered while !isRunning (see the footer below, which shows
  // a fixed "Stop" button instead while a search is active) — no
  // "Searching…" branch needed here.
  const primaryLabel = runStatus === "idle" ? "Generate" : "Search again";
  // foundHistory is stored newest-first (new finds are prepended, so
  // Favorites/Archive read newest-first). Reverse just this slice first so
  // ties (equal score, or both still unscored) fall back to discovery
  // order — first found stays earlier, each new one appends after it —
  // rather than reshuffling on every find. Then rank by brandabilityScore,
  // highest first, same as the Archive tab below: since autoCheck fires a
  // brandability check as soon as a result is found, scores stream in
  // asynchronously and the list re-sorts as they land. Entries with no
  // score yet sort last via the ?? -1 fallback.
  const currentRunResults = useMemo(
    () =>
      foundHistory
        .filter((e) => e.runId === activeRunId)
        .slice()
        .reverse()
        .sort((a, b) => (b.brandabilityScore ?? -1) - (a.brandabilityScore ?? -1)),
    [foundHistory, activeRunId]
  );
  // Everything not from the active run, ranked best-first (highest
  // brandabilityScore — easiest to actually rank #1 for — at the top): once
  // a result has aged out of the current run, how promising it is matters
  // more than when it happened to turn up. Entries with no score yet
  // (never checked — see FoundEntry) sort last, via the ?? -1 fallback,
  // rather than being scattered among real 0-100 scores. Always reachable
  // via the Archive tab (see Header) — there's no separate "top ranked"
  // slot to fill an idle screen anymore, since the tab itself is always on
  // screen.
  const archiveResults = useMemo(
    () =>
      foundHistory
        .filter((e) => e.runId !== activeRunId)
        .slice()
        .sort((a, b) => (b.brandabilityScore ?? -1) - (a.brandabilityScore ?? -1)),
    [foundHistory, activeRunId]
  );
  // Matches on the domain only (not `meaning`'s free-text description) —
  // the filter box exists to jump back to a specific name someone
  // remembers, not to full-text search every dictionary-pairing blurb.
  const trimmedArchiveFilter = archiveFilter.trim().toLowerCase();
  const filteredArchiveResults = useMemo(
    () =>
      trimmedArchiveFilter
        ? archiveResults.filter((e) => e.domain.toLowerCase().includes(trimmedArchiveFilter))
        : archiveResults,
    [archiveResults, trimmedArchiveFilter]
  );
  const favoriteDomains = useMemo(() => new Set(favorites.map((f) => f.domain)), [favorites]);
  const statusText = gettingIdeas ? "Getting AI ideas…" : `${formatNumber(checkedCount)} checked this search`;
  const tabCounts: Record<ResultsTab, number> = {
    current: currentRunResults.length,
    favorites: favorites.length,
    archive: archiveResults.length,
  };
  // True only on a genuinely first-ever look at the page: nothing has run
  // this session (runStatus) and nothing survived from a previous one
  // (foundHistory/favorites, restored by the hydration effect above — see
  // its own comment on why this can't be computed before hasHydrated
  // settles). Drives which of the two page layouts below renders: a
  // full-screen hero with nothing but the keyword field for a first-time
  // visitor (no tab bar, no settings panel, no results section to be empty
  // at all), versus the compact search bar + tabs +
  // results layout everyone else gets, including a returning visitor whose
  // *current* run happens to be empty (e.g. right after reload, before
  // they've searched again this session) — that's a real "Current" tab
  // state, not the first-visit case, so it still gets the full layout.
  const isFirstVisit = runStatus === "idle" && foundHistory.length === 0 && favorites.length === 0;
  // Shared by both places SettingsPanel renders (the desktop rail and the
  // mobile SettingsDrawer) so the two can never drift out of sync with each
  // other's props.
  const settingsPanelProps = {
    stats,
    keywordParam,
    useAiSynonyms,
    onUseAiSynonymsChange: setUseAiSynonyms,
    useAiInvented,
    onUseAiInventedChange: setUseAiInvented,
    useAltSpellings,
    onUseAltSpellingsChange: setUseAltSpellings,
    maxLength,
    onMaxLengthChange: setMaxLength,
    selectedTlds,
    visibleTlds,
    enabledTlds,
    onToggleTld: toggleTld,
    effectiveShowMoreTlds,
    onToggleShowMoreTlds: () => setShowMoreTlds((v) => !v),
    gates,
    onGatesChange: setGates,
    region,
    onRegionChange: setRegion,
  };
  const searchBarProps = {
    keywordInput,
    onKeywordInputChange: setKeywordInput,
    isRunning,
    primaryLabel,
    // Wrapped, not passed directly: start() takes an optional
    // overrideKeyword (see tryExample above), and a DOM onClick would
    // otherwise pass its SyntheticEvent through as that argument.
    onStart: () => start(),
    onStop: stop,
    exampleKeywords: EXAMPLE_KEYWORDS,
    onTryExample: tryExample,
    settingsOpen,
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Header activeTab={activeTab} onTabChange={setActiveTab} counts={tabCounts} showTabs={!isFirstVisit} />

      <main className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">
        {isFirstVisit ? (
          // The entire first-ever screen: hero copy + keyword field +
          // example chips, vertically centered, nothing else — see
          // isFirstVisit's own comment above for why every other section
          // (tabs, style chips, advanced filters, results, log) is left out
          // rather than rendered empty.
          <div className={`mx-auto flex h-full w-full flex-col justify-center gap-5 ${CONTENT_WIDTH}`}>
            <SearchBar mode="hero" {...searchBarProps} />
          </div>
        ) : (
          <div className={`mx-auto flex w-full flex-col gap-6 lg:grid lg:grid-cols-[300px_1fr] lg:items-start lg:gap-8 ${PAGE_WIDTH}`}>
            {/* Desktop-only persistent rail: SettingsPanel is otherwise
                reached through SettingsDrawer (below), opened from
                SearchBar's "Customize" button — see its own comment on why
                both exist rather than one adapting to fit. */}
            <aside className="hidden lg:sticky lg:top-4 lg:block">
              <SettingsPanel {...settingsPanelProps} />
            </aside>

            <div className={`mx-auto flex w-full flex-col gap-5 ${CONTENT_WIDTH} lg:mx-0`}>
              <SearchBar mode="compact" {...searchBarProps} onOpenSettings={() => setSettingsOpen(true)} />

              {errorMessage && (
                <p
                  role="alert"
                  className="animate-fade-in-up rounded-2xl bg-red-500/10 px-3.5 py-3 text-sm text-red-700 dark:text-red-400"
                >
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
                        {currentRunFound}/{DEFAULT_RESULT_COUNT}
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
                      {isRunning ? "Also searching" : "Also searched"} AI synonym
                      {aiSynonymWords.length === 1 ? "" : "s"}: {aiSynonymWords.join(", ")}
                    </p>
                  )}
                  {aiInventedWords.length > 0 && (
                    <p className="text-xs text-muted">
                      {isRunning ? "Also searching" : "Also searched"} AI-invented name
                      {aiInventedWords.length === 1 ? "" : "s"}: {aiInventedWords.join(", ")}
                    </p>
                  )}
                  {altSpellingWords.length > 0 && (
                    <p className="text-xs text-muted">
                      {isRunning ? "Also searching" : "Also searched"} alt spelling
                      {altSpellingWords.length === 1 ? "" : "s"}: {altSpellingWords.join(", ")}
                      {gates.filterPronounceable &&
                        // Only worth saying while the gate is actually on —
                        // with it off there's nothing being skipped to call
                        // out. Surfaced here too (not just in the settings
                        // panel itself) since this is the live, no-need-to-
                        // go-look-elsewhere view of what a run is actually
                        // doing.
                        ' — these skip the "Pronounceable only" filter below.'}
                    </p>
                  )}
                  {currentRunResults.length === 0 && !isRunning && runStatus !== "error" ? (
                    <p className="py-8 text-center text-sm text-muted">
                      {runStatus === "idle"
                        ? "Type a keyword above and hit Generate to see results here."
                        : "No matches found — try loosening a quality gate or a different keyword."}
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
                      onRemove={removeEntry}
                      pendingCount={isRunning ? Math.max(0, DEFAULT_RESULT_COUNT - currentRunResults.length) : 0}
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
                  className={`flex flex-col gap-3 ${FOCUS_RING}`}
                >
                  {archiveResults.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted">
                      Past searches will collect here once you run more than one.
                    </p>
                  ) : (
                    <>
                      {/* Only worth the extra control once there's enough here
                          that scrolling to find one name stops being quick —
                          below that, the input would just be one more thing to
                          skip past. */}
                      {archiveResults.length > 8 && (
                        <input
                          type="text"
                          inputMode="text"
                          value={archiveFilter}
                          onChange={(e) => setArchiveFilter(e.target.value)}
                          placeholder={`Filter ${formatNumber(archiveResults.length)} archived names…`}
                          aria-label="Filter archived names"
                          className={`min-h-10 w-full rounded-full border border-black/15 bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-black/40 dark:border-white/15 dark:placeholder:text-white/40 ${FOCUS_RING}`}
                        />
                      )}
                      {filteredArchiveResults.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted">
                          No archived names match &ldquo;{archiveFilter.trim()}&rdquo;.
                        </p>
                      ) : (
                        <ResultsGrid
                          entries={filteredArchiveResults}
                          favoriteDomains={favoriteDomains}
                          checkingBrandabilityNames={checkingBrandabilityNames}
                          brandabilityErrors={brandabilityErrors}
                          onSearch={searchDomain}
                          onToggleFavorite={toggleFavorite}
                          onCheckBrandability={checkBrandabilityFor}
                          onRegister={registerDomain}
                          onRemove={removeEntry}
                        />
                      )}
                    </>
                  )}
                </section>
              )}
            </div>
          </div>
        )}
      </main>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsPanel {...settingsPanelProps} />
      </SettingsDrawer>

      <Footer isRunning={isRunning} statusText={statusText} onStop={stop} />
    </div>
  );
}
