// App-level search configuration — constants and their derived types, kept
// as plain client-side literals (not imported from the server-side libs
// under src/lib/*.ts that actually enforce them, e.g. candidates.ts's
// parseTlds/parseCount or dictionary.ts's parseMaxLength) so this client
// bundle doesn't pull in the ~3MB dictionary data file those modules load
// at import time. Each constant here is a documented duplicate of its
// server-side counterpart — see the comment on each below for exactly
// which one it must stay in sync with.

// English only — Latin/Esperanto/French/Spanish were dropped (no
// WordNet-equivalent lexicon source existed for them). Kept as a Lang
// union/array of one, matching the shape src/lib/dictionary.ts and
// src/lib/modifiers.ts use, rather than special-casing a bare string.
export type Lang = "english";
export const LANGS: Lang[] = ["english"];

// Ordered by real-world popularity — must stay in sync with SUPPORTED_TLDS
// in src/lib/candidates.ts. The first PRIMARY_TLD_COUNT show by default;
// the rest fold behind a "More" toggle.
export const TLDS = [
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
export type Tld = (typeof TLDS)[number];
export const PRIMARY_TLD_COUNT = 6;

// Must stay in sync with MIN/MAX/DEFAULT_COMBINED_LENGTH in
// src/lib/dictionary.ts. The max accounts for the keyword path (a 15-char
// keyword plus an 8-letter word, rounded up to 24); the min and default
// favor output quality over the shortest theoretically possible pairing.
export const MIN_COMBINED_LENGTH = 5;
export const MAX_COMBINED_LENGTH = 24;
export const DEFAULT_COMBINED_LENGTH = 8;

// Must stay in sync with parseCount's own clamp in src/lib/candidates.ts.
export const MIN_RESULT_COUNT = 1;
export const MAX_RESULT_COUNT = 30;
export const DEFAULT_RESULT_COUNT = 12;

export interface DictionaryStats {
  english: number;
  combinedUnique: number;
  totalCombinations: number;
}

// Must stay in sync with REGIONS/DEFAULT_REGION in src/lib/brandability.ts —
// the brandability check runs against exactly one of these at a time (see the
// region dropdown in FiltersPanel.tsx), picked here and sent as the
// `region` query param to /api/brandability.
export const REGION_OPTIONS = [
  { value: "us", label: "United States" },
  { value: "gb", label: "United Kingdom" },
  { value: "au", label: "Australia" },
  { value: "ca", label: "Canada" },
  { value: "ie", label: "Ireland" },
  { value: "gr", label: "Greece" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "it", label: "Italy" },
  { value: "es", label: "Spain" },
] as const;
export type RegionOption = (typeof REGION_OPTIONS)[number]["value"];
export const DEFAULT_REGION: RegionOption = "us";

// Must stay in sync with PROVIDERS/DEFAULT_PROVIDER in
// src/lib/searchProvider.ts — the brandability check runs against exactly
// one of these at a time (see the provider dropdown in FiltersPanel.tsx),
// picked here and sent as the `provider` query param to /api/brandability.
// The two have very different operating profiles, confirmed directly: Serper
// is fast with a high concurrency limit and a 2,500/month free quota, which
// is what makes automatic per-result checking (see autoCheck in page.tsx)
// viable at all; apiserpent.com is slower and its concurrency limit is tied
// to account balance (see https://apiserpent.com/faq), which is exactly why
// autoCheck is unavailable whenever it's selected — but it's demonstrated
// actually reproducing Google's real silent query-override behavior in
// testing (see REGIONS above), which Serper never has.
export const PROVIDER_OPTIONS = [
  { value: "serpent", label: "apiserpent.com (thorough, slower)" },
  { value: "serper", label: "Serper.dev (fast, enables auto-check)" },
] as const;
export type ProviderOption = (typeof PROVIDER_OPTIONS)[number]["value"];
export const DEFAULT_PROVIDER: ProviderOption = "serpent";
