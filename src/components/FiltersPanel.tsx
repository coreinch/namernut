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

function BookIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.6L19.5 9l-5.7 1.4L12 16l-1.8-5.6L4.5 9l5.7-1.4L12 2z" />
    </svg>
  );
}

function DiceIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SpellIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20l4-10 4 10M6 16h4" />
      <path d="M14 20l4-14M14 12h4" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** One always-on-or-toggleable pill describing a name-generation mechanism — the merged replacement for three separate switches-with-paragraphs, following the same "style chip" pattern comparable name generators (e.g. Namelix) use for this exact kind of choice. `active` (not `disabled`) renders the always-on "Dictionary" chip, which has no click handler at all. */
function StyleChip({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const inert = !onClick;
  const Tag = inert ? "span" : "button";
  return (
    <Tag
      type={inert ? undefined : "button"}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={inert ? undefined : active}
      className={`flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-all ${
        inert ? "" : "active:scale-95"
      } ${FOCUS_RING} ${
        disabled
          ? "cursor-not-allowed border border-dashed border-black/15 text-black/35 dark:border-white/15 dark:text-white/35"
          : active
            ? "bg-accent-2 text-white"
            : "border border-black/15 text-black/55 hover:bg-black/5 dark:border-white/15 dark:text-white/55 dark:hover:bg-white/10"
      }`}
    >
      {icon}
      {label}
    </Tag>
  );
}

/**
 * The search hero + advanced filters. Every toggle that widens which
 * candidate names get searched now lives in one "Style" chip row —
 * "Dictionary" is always on and unclickable (dictionary pairing on the
 * literal word always runs either way), while "AI synonyms"/"AI-invented"/
 * "Alt-spellings" toggle useAiSynonyms/useAiInvented/useAltSpellings.
 * Everything that only narrows the search (TLDs, quality gates, length/
 * count sliders, auto-rank) sits behind the collapsed "Advanced filters"
 * link — narrowing controls are opt-in to look at, generation controls are
 * always visible, matching the Namecheap Beast Mode split between
 * "Transform" and "Filtering" controls. Takes every value it renders and
 * every setter it calls as props rather than owning any state itself —
 * page.tsx remains the single source of truth (and the thing that persists
 * it all).
 */
export function FiltersPanel({
  showAdvanced,
  onToggleShowAdvanced,
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
  isRunning,
  primaryLabel,
  onStart,
  onStop,
}: {
  showAdvanced: boolean;
  onToggleShowAdvanced: () => void;
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
  isRunning: boolean;
  primaryLabel: string;
  onStart: () => void;
  onStop: () => void;
}) {
  const activeGateCount = Object.values(gates).filter(Boolean).length + (autoRank ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-display text-2xl font-semibold leading-tight sm:text-3xl">
        What&rsquo;s your idea?
      </h1>

      <div className="flex items-center gap-1.5 rounded-full bg-card p-1.5 shadow-[0_2px_10px_rgba(27,21,51,0.08)] dark:shadow-none">
        <input
          type="text"
          inputMode="text"
          value={keywordInput}
          onChange={(e) => onKeywordInputChange(e.target.value)}
          placeholder="Include a word (optional), e.g. nova"
          maxLength={20}
          className={`min-h-11 min-w-0 flex-1 rounded-full bg-transparent px-4 text-base outline-none placeholder:text-black/40 dark:placeholder:text-white/40 ${FOCUS_RING}`}
        />
        <button
          type="button"
          onClick={isRunning ? onStop : onStart}
          className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-5 text-sm font-semibold text-white transition-all active:scale-95 ${
            isRunning ? "bg-black/70 hover:bg-black/80 dark:bg-white/25 dark:hover:bg-white/35" : "bg-accent hover:opacity-90"
          } ${FOCUS_RING}`}
        >
          {isRunning ? "Stop" : primaryLabel}
        </button>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <StyleChip icon={<BookIcon />} label="Dictionary" active />
        <StyleChip
          icon={<SparkleIcon />}
          label="AI synonyms"
          active={useAiSynonyms}
          disabled={!keywordParam}
          onClick={() => onUseAiSynonymsChange(!useAiSynonyms)}
        />
        <StyleChip
          icon={<DiceIcon />}
          label="AI-invented"
          active={useAiInvented}
          onClick={() => onUseAiInventedChange(!useAiInvented)}
        />
        <StyleChip
          icon={<SpellIcon />}
          label="Alt-spellings"
          active={useAltSpellings}
          disabled={!keywordParam}
          onClick={() => onUseAltSpellingsChange(!useAltSpellings)}
        />
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={onToggleShowAdvanced}
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted underline decoration-black/25 underline-offset-4 transition-colors hover:text-foreground dark:decoration-white/25 ${FOCUS_RING}`}
        >
          Advanced filters ({activeGateCount} active)
          <ChevronIcon open={showAdvanced} />
        </button>
      </div>

      {showAdvanced && (
        <section className="flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-[0_2px_10px_rgba(27,21,51,0.06)] dark:shadow-none">
          {keywordParam && (
            <p className="text-xs text-muted">Every result will include &ldquo;{keywordParam}&rdquo;.</p>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Max combination length</span>
              <span className="font-semibold tabular-nums text-foreground">{maxLength} characters</span>
            </div>
            <input
              type="range"
              min={MIN_COMBINED_LENGTH}
              max={MAX_COMBINED_LENGTH}
              step={1}
              value={maxLength}
              onChange={(e) => onMaxLengthChange(Number(e.target.value))}
              aria-label="Maximum combined result length"
              className={`h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-accent dark:bg-white/10 ${FOCUS_RING}`}
            />
            {stats && (
              <p className="text-xs text-muted">
                <span className="font-semibold tabular-nums text-foreground">
                  {formatNumber(stats.totalCombinations)}
                </span>{" "}
                possible combinations at this length
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Results to find</span>
              <span className="font-semibold tabular-nums text-foreground">{resultCount}</span>
            </div>
            <input
              type="range"
              min={MIN_RESULT_COUNT}
              max={MAX_RESULT_COUNT}
              step={1}
              value={resultCount}
              onChange={(e) => onResultCountChange(Number(e.target.value))}
              aria-label="Number of available results to find"
              className={`h-2 w-full cursor-pointer appearance-none rounded-full bg-black/10 accent-accent dark:bg-white/10 ${FOCUS_RING}`}
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Extensions</span>
            <div className="flex flex-wrap gap-2">
              {visibleTlds.map((tld) => (
                <button
                  key={tld}
                  type="button"
                  onClick={() => onToggleTld(tld)}
                  aria-pressed={enabledTlds[tld]}
                  className={`min-h-9 rounded-full border px-3.5 text-xs transition-all active:scale-95 ${FOCUS_RING} ${
                    enabledTlds[tld]
                      ? "border-accent-2/40 bg-accent-2/10 font-medium text-accent-2"
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
                  className={`min-h-9 rounded-full border border-dashed border-black/20 px-3.5 text-xs text-muted transition-all active:scale-95 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10 ${FOCUS_RING}`}
                >
                  {effectiveShowMoreTlds ? "Less ▲" : "More ▾"}
                </button>
              )}
            </div>
            {selectedTlds.length === 0 && <p className="text-xs text-muted">Select at least one extension.</p>}
          </div>

          <div className="flex flex-col gap-1 border-t border-black/10 pt-3 dark:border-white/10">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Quality gates</span>
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
            <p className="text-xs text-muted">
              Runs the paid AI rankability check on every result found, not just the ones you pick — off by default
              to avoid the extra cost.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
