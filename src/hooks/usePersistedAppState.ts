import { useEffect, useRef, useState } from "react";
import type { DiscoveryGates } from "@/lib/discovery";
import type { FoundEntry } from "@/lib/types";
import {
  DEFAULT_COMBINED_LENGTH,
  DEFAULT_REGION,
  LANGS,
  MAX_COMBINED_LENGTH,
  MIN_COMBINED_LENGTH,
  REGION_OPTIONS,
  TLDS,
  type Lang,
  type RegionOption,
  type Tld,
} from "@/lib/searchConfig";

interface PersistedState {
  foundHistory: FoundEntry[];
  favorites: FoundEntry[];
  enabledLangs: Record<Lang, boolean>;
  enabledTlds: Record<Tld, boolean>;
  maxLength: number;
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
// were exposed — EXCEPT requireGithub, which defaults to off (false):
// GitHub is the only platform confirmed to actually hit a real rate limit
// in practice — a 100-request-in-a-row test (2026-09-27, see
// DEFERRED_PLATFORMS in discovery.ts) hit its documented 403 cap exactly
// at request #61, while the same test came back clean for
// Instagram/TikTok/npm/YouTube/X (Instagram's only real failure mode is
// its login wall, sidestepped entirely once INSTAGRAM_SESSION_ID is
// configured) — so requiring GitHub out of the box means most searches
// hit that limit before producing any results, while the rest don't. This
// must stay in sync with parseGates's defaults in discovery.ts, which the
// server falls back to for a request with no gate params at all. A fresh
// install gets these defaults; a persisted state from before this change
// keeps whatever it already had saved.
const DEFAULT_GATES: DiscoveryGates = {
  requireInstagram: true,
  requireGithub: false,
  requireTiktok: true,
  requireNpm: true,
  requireYoutube: true,
  requireTwitter: true,
  filterPronounceable: true,
  filterTypos: true,
  filterNiceness: true,
};

const STORAGE_KEY = "namernut:state:v1";
// Pre-rename keys, newest first — read in order as a fallback during
// hydration (see below) so existing users' saved results/favorites/settings
// survive each rename instead of silently becoming unreachable under a new
// key. "namerag:state:v1" was this app's immediately prior name;
// "domain-finder:state:v1" predates that one.
const LEGACY_STORAGE_KEYS = ["namerag:state:v1", "domain-finder:state:v1"];

// foundHistory persists to localStorage (see the write-back effect below)
// and, before this cap, grew without bound across a browser profile's
// lifetime — every "found" event during every search prepended a new entry,
// and the full array was re-serialized to localStorage on every single one.
// A cap keeps both the per-write JSON.stringify cost and the persisted
// payload size bounded instead of growing forever toward the ~5-10MB
// per-origin quota, where writes silently fail (see the "ignore write
// failures" comment in the persistence effect below). 500 is a round number
// comfortably above what one sitting of searches produces, so normal usage
// never notices entries being dropped; oldest entries (the array is
// newest-first) are the ones trimmed. Exported so useDiscoveryRun can apply
// the same cap when it appends a live "found" event.
export const MAX_FOUND_HISTORY = 500;

// Collapses entries that share a domain down to one, preferring whichever
// one already carries a brandability score over an unscored duplicate. Used
// to clean up persisted state from before the "found" handler started
// guarding against this (see useDiscoveryRun's start()) — a re-run of
// discovery, with no exclusion of domains an earlier run already found,
// could legitimately rediscover the same available domain and add a second
// entry for it, which then rendered as a duplicate card in Previous results.
// Keeps the original relative order (by first occurrence) rather than
// reshuffling.
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

// Owns everything that survives a reload: found/favorited results, the
// filter/gate/toggle settings, and hydration bookkeeping. Restoring this on
// mount, and writing it back on every change, is entirely independent of
// the live SSE discovery run itself (see useDiscoveryRun) — a search
// in-flight never needs to be persisted, only its results do, once they
// land in foundHistory via setFoundHistory.
export function usePersistedAppState() {
  const [foundHistory, setFoundHistory] = useState<FoundEntry[]>([]);
  const [favorites, setFavorites] = useState<FoundEntry[]>([]);
  const [enabledLangs, setEnabledLangs] = useState<Record<Lang, boolean>>(() =>
    Object.fromEntries(LANGS.map((l) => [l, true])) as Record<Lang, boolean>
  );
  const [enabledTlds, setEnabledTlds] = useState<Record<Tld, boolean>>(() =>
    Object.fromEntries(TLDS.map((t) => [t, t === "com"])) as Record<Tld, boolean>
  );
  const [maxLength, setMaxLength] = useState(DEFAULT_COMBINED_LENGTH);
  const [keywordInput, setKeywordInput] = useState("");
  const [gates, setGates] = useState<DiscoveryGates>(DEFAULT_GATES);
  const [region, setRegion] = useState<RegionOption>(DEFAULT_REGION);
  const [useAiSynonyms, setUseAiSynonyms] = useState(true);
  const [useAiInvented, setUseAiInvented] = useState(true);
  const [useAltSpellings, setUseAltSpellings] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  // Mirrors every domain ever added to foundHistory (including ones since
  // trimmed out by MAX_FOUND_HISTORY) so useDiscoveryRun's "found" handler
  // can synchronously tell a genuinely new find from a rediscovery — a
  // functional setFoundHistory updater can't be used for that check, since
  // React doesn't guarantee it runs before that handler returns.
  const foundDomainsRef = useRef<Set<string>>(new Set());
  // Mirrors, by bare name (not full domain), every brandability score ever
  // received — brandability is a property of the name, not the TLD (see
  // checkBrandabilityFor's own applyScore, which already fans a score out
  // to every entry sharing a bare name). Lets the "found" handler give a
  // newly-added entry an already-known score directly instead of firing
  // another metered check when the same name resurfaces under a different
  // TLD, or in a later run, after the original check has already resolved
  // (checkingBrandabilityNames only covers the still-in-flight case).
  const scoredNamesRef = useRef<Map<string, { brandabilityScore: number; brandabilitySummary?: string }>>(new Map());

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
      // Nothing under the current key yet — fall back through the
      // pre-rename keys, newest first, so an existing user's saved
      // results/favorites/settings still come back after the rename,
      // rather than silently resetting to empty. The write effect below
      // saves under the new key on the very next tick, and once that
      // succeeds there's nothing left reading the matched legacy key, so
      // it's safe to remove here rather than leave two copies of the same
      // data lying around.
      let legacyRaw: string | null = null;
      let matchedLegacyKey: string | null = null;
      if (!raw) {
        for (const key of LEGACY_STORAGE_KEYS) {
          const value = localStorage.getItem(key);
          if (value) {
            legacyRaw = value;
            matchedLegacyKey = key;
            break;
          }
        }
      }
      const parsed: Partial<PersistedState> = JSON.parse(raw ?? legacyRaw ?? "{}");
      if (parsed.foundHistory) {
        const deduped = dedupeByDomain(parsed.foundHistory.map(migrateLegacyEntry));
        // .slice(0, MAX_FOUND_HISTORY) trims anyone whose persisted history
        // already exceeds the cap from before it existed (entries are
        // newest-first, so this keeps the most recent ones).
        // Reading an external system (localStorage) once on mount, exactly
        // the pattern the rule's own message carves out; only flagged here
        // (and not for the sibling setFavorites/setEnabledLangs/etc. calls
        // right below) because this setter's other call site now lives in
        // the sibling useDiscoveryRun hook, invisible to this rule's
        // per-function analysis since the page.tsx/hooks split.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFoundHistory(deduped.slice(0, MAX_FOUND_HISTORY));
        // foundDomainsRef tracks every domain ever found, not just the
        // trimmed/visible slice — a domain scrolled out of the cap was
        // still already brandability-checked, so it shouldn't be rechecked.
        for (const entry of deduped) {
          foundDomainsRef.current.add(entry.domain);
          if (entry.brandabilityScore !== undefined) {
            scoredNamesRef.current.set(entry.domain.split(".")[0], {
              brandabilityScore: entry.brandabilityScore,
              brandabilitySummary: entry.brandabilitySummary,
            });
          }
        }
      }
      if (parsed.favorites) setFavorites(parsed.favorites.map(migrateLegacyEntry));
      if (parsed.enabledLangs) setEnabledLangs(parsed.enabledLangs);
      if (parsed.enabledTlds) setEnabledTlds(parsed.enabledTlds);
      if (typeof parsed.maxLength === "number") {
        setMaxLength(Math.min(MAX_COMBINED_LENGTH, Math.max(MIN_COMBINED_LENGTH, parsed.maxLength)));
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
      if (matchedLegacyKey) localStorage.removeItem(matchedLegacyKey);
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
    keywordInput,
    gates,
    region,
    useAiSynonyms,
    useAiInvented,
    useAltSpellings,
  ]);

  return {
    foundHistory,
    setFoundHistory,
    favorites,
    setFavorites,
    enabledLangs,
    setEnabledLangs,
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
  };
}
