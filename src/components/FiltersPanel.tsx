import type { DiscoveryGates } from "@/lib/discovery";
import {
  MAX_COMBINED_LENGTH,
  MAX_RESULT_COUNT,
  MIN_COMBINED_LENGTH,
  MIN_RESULT_COUNT,
  PRIMARY_TLD_COUNT,
  TLDS,
  type DictionaryStats,
  type Tld,
} from "@/lib/searchConfig";
import { FOCUS_RING } from "./constants";
import { GateToggle } from "./GateToggle";

function formatNumber(n: number) {
  return n.toLocaleString("en-US");
}

/**
 * The collapsible "Filters" card — collapsed by default (the defaults are
 * good enough that most searches never need to touch this), with the
 * closed toggle summarizing every setting actually in effect so nothing is
 * hidden without a trace. Takes every value it renders and every setter it
 * calls as props rather than owning any state itself — page.tsx remains
 * the single source of truth (and the thing that persists it all).
 */
export function FiltersPanel({
  showFilters,
  onToggleShowFilters,
  stats,
  keywordInput,
  onKeywordInputChange,
  keywordParam,
  useAiSynonyms,
  onUseAiSynonymsChange,
  useAiInvented,
  onUseAiInventedChange,
  useAltSpellings,
  onUseAltSpellingsChange,
  maxLength,
  onMaxLengthChange,
  resultCount,
  onResultCountChange,
  selectedTlds,
  visibleTlds,
  enabledTlds,
  onToggleTld,
  effectiveShowMoreTlds,
  onToggleShowMoreTlds,
  gates,
  onGatesChange,
  autoRank,
  onAutoRankChange,
}: {
  showFilters: boolean;
  onToggleShowFilters: () => void;
  stats: DictionaryStats | null;
  keywordInput: string;
  onKeywordInputChange: (value: string) => void;
  keywordParam: string;
  useAiSynonyms: boolean;
  onUseAiSynonymsChange: (value: boolean) => void;
  useAiInvented: boolean;
  onUseAiInventedChange: (value: boolean) => void;
  useAltSpellings: boolean;
  onUseAltSpellingsChange: (value: boolean) => void;
  maxLength: number;
  onMaxLengthChange: (value: number) => void;
  resultCount: number;
  onResultCountChange: (value: number) => void;
  selectedTlds: Tld[];
  visibleTlds: readonly Tld[];
  enabledTlds: Record<Tld, boolean>;
  onToggleTld: (tld: Tld) => void;
  effectiveShowMoreTlds: boolean;
  onToggleShowMoreTlds: () => void;
  gates: DiscoveryGates;
  onGatesChange: (updater: (gates: DiscoveryGates) => DiscoveryGates) => void;
  autoRank: boolean;
  onAutoRankChange: (value: boolean) => void;
}) {
  return (
    <>
      {/* 1. SEARCH CONFIGURATION — collapsed by default (same pattern as
          "Previous results"/"More TLDs" below). */}
      <button
        type="button"
        onClick={onToggleShowFilters}
        className={`flex min-h-11 items-start gap-2 rounded-xl border border-dashed border-black/20 px-3.5 py-2.5 text-left text-xs text-black/55 transition-all active:scale-[0.99] hover:bg-black/5 dark:border-white/20 dark:text-white/55 dark:hover:bg-white/10 ${FOCUS_RING}`}
      >
        {/* Wraps rather than truncating — on a narrow screen with a keyword
            set, a single-line ellipsis was cutting off whichever settings
            came last (often the keyword itself), hiding them with no way
            to see them without opening the whole panel. */}
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
                onChange={(e) => onKeywordInputChange(e.target.value)}
                placeholder="Include a word (optional), e.g. nova"
                maxLength={20}
                className={`min-h-12 w-full rounded-xl border border-black/15 bg-transparent px-4 text-base outline-none transition-colors placeholder:text-black/45 focus:border-emerald-500/50 dark:border-white/15 dark:placeholder:text-white/45 ${FOCUS_RING}`}
              />
              {keywordInput && (
                <button
                  type="button"
                  onClick={() => onKeywordInputChange("")}
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

          {/* AI generation — two independent, always-visible toggles (never
              one hiding in place of the other): "AI synonyms" expands the
              typed keyword into related words to pair with the dictionary
              (so it's inert with nothing to expand until a keyword exists
              — shown disabled, not hidden, so that's visible rather than
              looking like it vanished); "AI-invented names" is a wholly
              separate mechanism — complete made-up words, no dictionary
              pairing at all — that works with or without a keyword. */}
          <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10">
            <div className="flex flex-col gap-1">
              <GateToggle
                label="AI synonyms"
                checked={useAiSynonyms}
                onChange={onUseAiSynonymsChange}
                disabled={!keywordParam}
              />
              <p className="text-xs text-black/45 dark:text-white/45">
                {keywordParam ? (
                  <>
                    Also pairs the dictionary with AI-suggested synonyms of &ldquo;{keywordParam}&rdquo; (e.g.
                    &ldquo;blaze&rdquo; for &ldquo;fast&rdquo;) — dictionary pairing on the literal word always runs
                    either way, this only adds more to it.
                  </>
                ) : (
                  "Type a keyword above to enable — expands it into related words to pair with the dictionary."
                )}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <GateToggle label="AI-invented names" checked={useAiInvented} onChange={onUseAiInventedChange} />
              <p className="text-xs text-black/45 dark:text-white/45">
                Also searches fully AI-invented brandable words (like &ldquo;Zuvio&rdquo; or &ldquo;Fovixia&rdquo;) —
                not built from any dictionary word.
                {keywordParam && ` Themed around "${keywordParam}" since it's typed above.`}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <GateToggle
                label="Alternate spellings"
                checked={useAltSpellings}
                onChange={onUseAltSpellingsChange}
                disabled={!keywordParam}
              />
              <p className="text-xs text-black/45 dark:text-white/45">
                {keywordParam ? (
                  <>
                    Also pairs the dictionary with respellings of &ldquo;{keywordParam}&rdquo; (e.g. &ldquo;lyft&rdquo;
                    for &ldquo;lift&rdquo;) — a deterministic rule, not AI, so it costs nothing extra to turn on.
                  </>
                ) : (
                  "Type a keyword above to enable — respells it (e.g. “lyft” for “lift”), no AI involved."
                )}
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
              onChange={(e) => onMaxLengthChange(Number(e.target.value))}
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
              onChange={(e) => onResultCountChange(Number(e.target.value))}
              aria-label="Number of available results to find"
              className={`h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-emerald-600 dark:bg-white/10 dark:accent-emerald-500 ${FOCUS_RING}`}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {visibleTlds.map((tld) => (
              <button
                key={tld}
                type="button"
                onClick={() => onToggleTld(tld)}
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
                onClick={onToggleShowMoreTlds}
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
              onChange={(v) => onGatesChange((g) => ({ ...g, requireInstagram: v }))}
            />
            <GateToggle
              label="Pronounceable only"
              checked={gates.filterPronounceable}
              onChange={(v) => onGatesChange((g) => ({ ...g, filterPronounceable: v }))}
            />
            <GateToggle
              label="Skip typo-like names"
              checked={gates.filterTypos}
              onChange={(v) => onGatesChange((g) => ({ ...g, filterTypos: v }))}
            />
            <GateToggle
              label="Skip awkward names"
              checked={gates.filterNiceness}
              onChange={(v) => onGatesChange((g) => ({ ...g, filterNiceness: v }))}
            />
          </div>

          <div className="flex flex-col gap-1 border-t border-black/10 pt-3 dark:border-white/10">
            <GateToggle label="Auto-check rankability" checked={autoRank} onChange={onAutoRankChange} />
            <p className="text-xs text-black/45 dark:text-white/45">
              Runs the paid AI rankability check on every result found, not just the ones you pick — off by default
              to avoid the extra cost.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
