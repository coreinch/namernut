import type { DiscoveryGates } from "@/lib/discovery";
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

/**
 * Every control that shapes what gets searched: "Generation style" (four
 * GateToggle switches — Dictionary always on and grayed out; AI synonyms/
 * AI-invented/Alt-spellings toggle useAiSynonyms/useAiInvented/
 * useAltSpellings) plus TLDs, quality gates, length/count sliders, and
 * brandability check region — all always visible, no collapsed "Advanced
 * filters" step in front of them (there used to be one; once this was
 * reachable only via an explicit "Customize" action or a permanent desktop
 * rail — see page.tsx — hiding filters a second time, behind their own
 * toggle, just added a click for no benefit). Deliberately no open/close
 * chrome of its own otherwise: page.tsx renders this either inside
 * SettingsDrawer (mobile/`<lg`, an explicit "Customize" action) or as an
 * always-visible desktop rail (`lg:` and up) — this component doesn't know
 * or care which.
 */
export function SettingsPanel({
  stats,
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
}: {
  stats: DictionaryStats | null;
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
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Generation style</span>
        <GateToggle
          label="Dictionary pairing"
          checked
          disabled
          disabledReason="always on"
          onChange={() => {}}
        />
        <GateToggle
          label="AI synonyms"
          checked={useAiSynonyms}
          onChange={onUseAiSynonymsChange}
          disabled={!keywordParam}
          disabledReason="type a keyword above to enable"
        />
        <GateToggle label="AI-invented names" checked={useAiInvented} onChange={onUseAiInventedChange} />
        <GateToggle
          label="Alt-spellings"
          checked={useAltSpellings}
          onChange={onUseAltSpellingsChange}
          disabled={!keywordParam}
          disabledReason="type a keyword above to enable"
        />
      </div>

      <div className="flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-[0_2px_10px_rgba(27,21,51,0.06)] dark:shadow-none">
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
            {visibleTlds.map((tld) => {
              // toggleTld silently refuses to turn off the last remaining
              // selected TLD (at least one must stay selected) — without
              // this, that click looked identical to any other but did
              // nothing, with no way to tell why.
              const isOnlyOne = enabledTlds[tld] && selectedTlds.length <= 1;
              return (
                <button
                  key={tld}
                  type="button"
                  onClick={() => onToggleTld(tld)}
                  disabled={isOnlyOne}
                  aria-pressed={enabledTlds[tld]}
                  aria-label={isOnlyOne ? `.${tld} — at least one extension must stay selected` : undefined}
                  title={isOnlyOne ? "At least one extension must stay selected" : undefined}
                  className={`min-h-9 rounded-full border px-3.5 text-xs transition-all ${FOCUS_RING} ${
                    isOnlyOne
                      ? "cursor-not-allowed border-accent-2/40 bg-accent-2/10 font-medium text-accent-2 opacity-60"
                      : enabledTlds[tld]
                        ? "border-accent-2/40 bg-accent-2/10 font-medium text-accent-2 active:scale-95"
                        : "border-black/15 font-normal text-black/55 hover:bg-black/5 active:scale-95 dark:border-white/15 dark:text-white/55 dark:hover:bg-white/10"
                  }`}
                >
                  .{tld}
                </button>
              );
            })}
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
          {selectedTlds.length <= 1 && (
            <p className="text-xs text-muted">At least one extension must stay selected.</p>
          )}
        </div>

        <div className="flex flex-col gap-1 border-t border-black/10 pt-3 dark:border-white/10">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Quality gates</span>
          <GateToggle
            label="Require Instagram handle"
            checked={gates.requireInstagram}
            onChange={(v) => onGatesChange((g) => ({ ...g, requireInstagram: v }))}
          />
          <GateToggle
            label="Require GitHub username"
            checked={gates.requireGithub}
            onChange={(v) => onGatesChange((g) => ({ ...g, requireGithub: v }))}
            hint="Off by default — GitHub allows only 60 unauthenticated requests/hour per IP, so this can rate-limit a whole search."
          />
          <GateToggle
            label="Require TikTok handle"
            checked={gates.requireTiktok}
            onChange={(v) => onGatesChange((g) => ({ ...g, requireTiktok: v }))}
          />
          <GateToggle
            label="Require npm package name"
            checked={gates.requireNpm}
            onChange={(v) => onGatesChange((g) => ({ ...g, requireNpm: v }))}
          />
          <GateToggle
            label="Require YouTube handle"
            checked={gates.requireYoutube}
            onChange={(v) => onGatesChange((g) => ({ ...g, requireYoutube: v }))}
          />
          <GateToggle
            label="Require X (Twitter) handle"
            checked={gates.requireTwitter}
            onChange={(v) => onGatesChange((g) => ({ ...g, requireTwitter: v }))}
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
            className={`min-h-9 w-full rounded-full border border-black/15 bg-transparent px-3 text-sm text-foreground dark:border-white/15 ${FOCUS_RING}`}
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
      </div>
    </div>
  );
}
