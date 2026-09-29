"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DEFAULT_RESULT_COUNT,
  PRIMARY_TLD_COUNT,
  TLDS,
  type Lang,
  type Tld,
} from "@/lib/searchConfig";
import { CONTENT_WIDTH, FOCUS_RING, PAGE_WIDTH } from "@/components/constants";
import { Header, tabButtonId, tabPanelId, type ResultsTab } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SearchBar } from "@/components/SearchBar";
import { ExampleResults } from "@/components/ExampleResults";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { ResultsGrid } from "@/components/ResultsGrid";
import { LiveLogSection } from "@/components/LiveLogSection";
import { FilterSummary } from "@/components/FilterSummary";
import { usePersistedAppState } from "@/hooks/usePersistedAppState";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import { useDictionaryStats } from "@/hooks/useDictionaryStats";
import { useFocusHandoff } from "@/hooks/useFocusHandoff";
import { useResultActions } from "@/hooks/useResultActions";
import { useResultLists } from "@/hooks/useResultLists";
import { useDiscoveryRun, sanitizeKeyword } from "@/hooks/useDiscoveryRun";

// Fed to tryExample below (the example-keyword chips) — each was verified
// directly (live, against the real production API) to produce real, varied
// output (dictionary pairings plus AI synonyms/invented names) rather than
// being picked for looks alone. "studio" briefly got swapped for "craft"
// after a live check found 39/39 literal "studio"+word candidates already
// domain-taken (studiola.com, nostudio.com, etc. — "studio" is simply a
// heavily-squatted .com term) — but a follow-up investigation found the
// real bug wasn't "studio" itself: completeChat (kilocode.ts) had no retry
// on its own documented kilo-auto/free hang, so a keyword whose LITERAL
// pairing space is thin (like "studio") swung between finding a full batch
// (AI synonyms/invented names succeeded) and "No matches found" (that one
// LLM call silently timed out, degrading to literal-only) from one run to
// the next. Fixed at the root (completeChat now retries once specifically
// on that timeout) rather than just avoiding the symptom, so "studio" is
// back — re-verified live, repeatedly, after the fix. Kept alongside
// "coffee" and "nova" to span different business categories (food,
// creative services, tech), so a first-time visitor is more likely to see
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


  const stats = useDictionaryStats(langsParam, maxLength, keywordParam);

  const {
    runStatus,
    log,
    checkedCount,
    currentRunFound,
    activeRunId,
    filterCounts,
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


  const { searchDomain, registerDomain, toggleFavorite, removeEntry } = useResultActions({
    setFavorites,
    setFoundHistory,
    foundDomainsRef,
  });

  const isRunning = runStatus === "running";
  useAutoUpdate(isRunning);


  // Only ever rendered while !isRunning (see the footer below, which shows
  // a fixed "Stop" button instead while a search is active) — no
  // "Searching…" branch needed here.
  const primaryLabel = runStatus === "idle" ? "Generate" : "Search again";
  const { currentRunResults, archiveResults, filteredArchiveResults, favoriteDomains } = useResultLists({
    foundHistory,
    favorites,
    activeRunId,
    archiveFilter,
  });
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
  useFocusHandoff(isRunning, isFirstVisit);


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
    // Already computed above via sanitizeKeyword — passed through rather
    // than re-derived in SearchBar so the two can never disagree on what
    // "the keyword" actually is. SearchBar's only use for it is detecting
    // when it's empty despite keywordInput not being (see its own comment).
    keywordParam,
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

      <main className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {isFirstVisit ? (
          // The entire first-ever screen: hero copy + keyword field +
          // example chips, vertically centered, nothing else — see
          // isFirstVisit's own comment above for why every other section
          // (tabs, style chips, advanced filters, results, log) is left out
          // rather than rendered empty.
          <div className={`mx-auto flex min-h-full w-full flex-col justify-start gap-5 pt-2 sm:justify-center sm:pt-0 ${CONTENT_WIDTH}`}>
            <SearchBar mode="hero" {...searchBarProps} />
            {!isRunning && <ExampleResults />}
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
                  {!isRunning && <FilterSummary counts={filterCounts} />}
                  <LiveLogSection log={log} logBoxRef={logBoxRef} isRunning={isRunning} />
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
                        // role="status" (not "alert" — this isn't an error,
                        // just informational, the same distinction the real
                        // error banner above already draws) so a screen
                        // reader user typing into the filter input actually
                        // hears that their filter matched nothing, instead
                        // of having to tab away from the input to discover
                        // it — the same dynamic-content-update problem
                        // Footer's own aria-live span exists to solve for
                        // the run's status line.
                        <p role="status" className="py-8 text-center text-sm text-muted">
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
