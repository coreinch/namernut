import type { DiscoveryGates } from "@/lib/discovery";
import { DESCRIPTION } from "@/lib/copy";
import {
  MAX_COMBINED_LENGTH,
  MIN_COMBINED_LENGTH,
  PRIMARY_TLD_COUNT,
  REGION_OPTIONS,
  TLDS,
  type DictionaryStats,
  type RegionOption,
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
  disabledReason,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
  /** Announced (via aria-label) and shown as a tooltip when disabled — a
   * disabled control with no stated reason is a dead end for a
   * screen-reader user, who can't see the dashed border sighted users use
   * to infer "type a keyword first". */
  disabledReason?: string;
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
      aria-label={disabled && disabledReason ? `${label} — ${disabledReason}` : inert ? `${label} (always on)` : undefined}
      title={disabled ? disabledReason : undefined}
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
 * count sliders, brandability check region) sits behind the collapsed "Advanced filters"
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
  selectedTlds,
  visibleTlds,
  enabledTlds,
  onToggleTld,
  effectiveShowMoreTlds,
  onToggleShowMoreTlds,
  gates,
  onGatesChange,
  region,
  onRegionChange,
  isRunning,
  primaryLabel,
  onStart,
  onStop,
  onTryExample,
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
  selectedTlds: Tld[];
  visibleTlds: readonly Tld[];
  enabledTlds: Record<Tld, boolean>;
  onToggleTld: (tld: Tld) => void;
  effectiveShowMoreTlds: boolean;
  onToggleShowMoreTlds: () => void;
  gates: DiscoveryGates;
  onGatesChange: (updater: (gates: DiscoveryGates) => DiscoveryGates) => void;
  region: RegionOption;
  onRegionChange: (value: RegionOption) => void;
  isRunning: boolean;
  primaryLabel: string;
  onStart: () => void;
  onStop: () => void;
  onTryExample: () => void;
}) {
  const activeGateCount = Object.values(gates).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-display text-2xl font-semibold leading-tight sm:text-3xl">
        What&rsquo;s your idea?
      </h1>
      {/* The value prop used to live only in <meta description> — real
          visitors never saw it, just the h1 above, which reads fine once
          you already know what the tool does but says nothing to a
          first-time visitor deciding whether to type anything at all.
          Shares its text with lib/copy.ts's DESCRIPTION (also used for
          <meta>, the OG image, and the PWA manifest) rather than its own
          paraphrase, so this — the one spot an actual visitor reads it —
          can't quietly drift from what everywhere else claims. */}
      <p className="text-center text-sm text-muted sm:text-base">{DESCRIPTION}</p>

      <div className="flex items-center gap-1.5 rounded-full bg-card p-1.5 shadow-[0_2px_10px_rgba(27,21,51,0.08)] dark:shadow-none">
        <input
          type="text"
          inputMode="text"
          aria-label="Keyword to include (optional)"
          value={keywordInput}
          onChange={(e) => onKeywordInputChange(e.target.value)}
          // An example, not just a label — "Keyword (optional)" told a
          // visitor a field existed without telling them what belongs in
          // it. Still short on purpose (see the mobile-width comment this
          // replaced): this pill also holds the Generate/Stop button, so
          // there's only ~150-200px for the placeholder on a narrow phone.
          // A real word/short phrase, not a full sentence — this field
          // pairs one dictionary or AI-suggested word onto exactly what's
          // typed here (see sanitizeKeyword below and parseKeyword in
          // lib/candidates.ts), so an example implying it interprets a
          // whole pitch would set the wrong expectation.
          placeholder="e.g. glow, coffee"
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

      {/* Lets a first-time visitor see real output (names, live
          availability, an AI score once auto-check resolves) with zero
          typing, before deciding whether their own idea is worth trying.
          Hidden mid-search rather than left as a dead click — there's
          nothing useful for it to do while a run is already going. */}
      {!isRunning && (
        <div className="-mt-2 text-center">
          <button
            type="button"
            onClick={onTryExample}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted underline decoration-black/25 underline-offset-4 transition-colors hover:text-foreground dark:decoration-white/25 ${FOCUS_RING}`}
          >
            Try an example
          </button>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <StyleChip icon={<BookIcon />} label="Dictionary" active />
        <StyleChip
          icon={<SparkleIcon />}
          label="AI synonyms"
          active={useAiSynonyms}
          disabled={!keywordParam}
          disabledReason="type a keyword above to enable"
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
          disabledReason="type a keyword above to enable"
          onClick={() => onUseAltSpellingsChange(!useAltSpellings)}
        />
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={onToggleShowAdvanced}
          aria-expanded={showAdvanced}
          aria-controls="advanced-filters-panel"
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted underline decoration-black/25 underline-offset-4 transition-colors hover:text-foreground dark:decoration-white/25 ${FOCUS_RING}`}
        >
          Advanced filters ({activeGateCount} active)
          <ChevronIcon open={showAdvanced} />
        </button>
      </div>

      {showAdvanced && (
        <section
          id="advanced-filters-panel"
          className="flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-[0_2px_10px_rgba(27,21,51,0.06)] dark:shadow-none"
        >
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

          <div className="flex flex-col gap-1.5 border-t border-black/10 pt-3 dark:border-white/10">
            <label htmlFor="brandability-region" className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Brandability check region
            </label>
            <select
              id="brandability-region"
              value={region}
              onChange={(e) => onRegionChange(e.target.value as RegionOption)}
              // The native dropdown popup ignores the page's dark theme and
              // always renders with its own (usually light) chrome. Forcing
              // light color-scheme keeps that popup predictable, but Chrome
              // still lets each <option>'s inherited `color` (text-foreground
              // below, near-white in dark mode — see --foreground in
              // globals.css) carry into the popup's own always-light
              // background, reading as near-invisible white-on-white. Each
              // <option> gets an explicit, theme-independent dark color
              // below to break that inheritance — one of the few style
              // properties Chromium actually respects inside the native
              // listbox — while text-foreground here still governs the
              // select's own closed-box appearance, which does follow the
              // page theme correctly.
              style={{ colorScheme: "light" }}
              className={`min-h-9 w-full rounded-lg border border-black/15 bg-transparent px-3 text-sm text-foreground dark:border-white/15 ${FOCUS_RING}`}
            >
              {REGION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="text-black">
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
              Google&rsquo;s results (including whether it silently reinterprets a name as something else) vary by
              region — the brandability check searches from this one.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
