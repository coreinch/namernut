import { search, type SearchResult } from "@/lib/searchProvider";
import { completeChat } from "@/lib/kilocode";
import { getWordPool } from "@/lib/dictionary";
import { DEFAULT_REGION, REGION_OPTIONS, type ProviderOption, type RegionOption } from "@/lib/searchConfig";

export type Region = RegionOption;
export type Provider = ProviderOption;
/** No longer a caller-facing choice — see checkBrandability's own doc
 * comment. Primary is tried first; on any failure (including a timeout —
 * see SEARCH_TIMEOUT_MS below), the other is tried once before giving up.
 * apiserpent.com's own concurrency limit is tied to account balance (see
 * https://apiserpent.com/faq), so it's the fallback, not the primary. */
const PRIMARY_PROVIDER: Provider = "serper";
const FALLBACK_PROVIDER: Provider = "serpent";
/**
 * Regions selectable for the brandability check — see the region dropdown in
 * Advanced filters (page.tsx), which owns the canonical list (REGION_OPTIONS
 * in searchConfig.ts) since it's the client-safe constants file; this just
 * derives the plain value list for server-side validation (route.ts) and
 * search calls. A prior version of this checked every region concurrently
 * on every check, since Google's silent query-override behavior is
 * region-dependent (confirmed directly: "fondterm" showed no override under
 * country=us, but silently overrode to a real brand, "Finterm", under
 * country=gr) — but apiserpent.com's concurrent-request rate limit is
 * tied to account balance (see
 * https://apiserpent.com/faq: "Default" tier, balance <$100, allows only
 * 3-20 concurrent requests) and got hit in practice, so the check now runs
 * a single region at a time, user-selected, rather than fanning out
 * automatically.
 */
export const REGIONS: readonly Region[] = REGION_OPTIONS.map((r) => r.value);
export { DEFAULT_REGION };

export interface BrandabilityResult {
  name: string;
  /**
   * 0-100. 0 means essentially impossible to ever rank for — as saturated
   * as a name gets, the reference point being "Google" itself: an
   * unimaginably dominant, ubiquitous term nothing could realistically
   * outrank. 100 means wide open — the reference point being a long random
   * string with zero real-world usage anywhere, nothing to compete with at
   * all.
   */
  brandabilityScore: number;
  summary: string;
  /** Total organic results for the single merged query (see checkBrandability
   * — `name OR (two word split)` when a split exists, else just `name`).
   * No longer separable into "from the name" vs. "from the split": merging
   * the two searches into one OR query (done to halve search-provider API
   * usage per check) means the provider returns one mixed result set with
   * no per-result attribution to which side of the OR matched. */
  resultCount: number;
  /** Which region the search actually ran in — see REGIONS and the region
   * dropdown in Advanced filters (page.tsx). Exposed for transparency,
   * since Google's results (including whether it silently overrides the
   * query) are region-dependent. */
  region: Region;
  /** Which search provider actually ran the check — no longer a caller
   * choice (see checkBrandability), but still exposed for transparency:
   * the two providers have demonstrably different override-detection
   * results for the same name (see searchProvider.ts), and this says
   * which one this particular result came from, including whether a
   * fallback happened. */
  provider: Provider;
  /** The two dictionary words the name was split into, e.g. "even chad" for
   * "evenchad" — present only when such a split exists. See splitIntoWords:
   * this is what caught real two-word collisions by hand that the
   * concatenated name alone misses entirely (e.g. "evenchad" reads clean
   * until you read it as "even chad" and find it's a real person) — folded
   * into the same merged query as an OR term rather than a separate search. */
  twoWordSplit?: string;
  /** Top results from the merged query. */
  topResults: SearchResult[];
}

/**
 * Splits a name into two real dictionary words if any split point makes
 * both halves whole words (e.g. "evenchad" -> ["even", "chad"]), mirroring
 * the manual "two-word check" from vetting names by hand — quoted and
 * unquoted searches on the concatenated string can both look clean while
 * the same name read as two separate words turns out to be a real person,
 * place, or phrase. Prefers a split where both halves are common words
 * (the reading a human would actually default to) over an obscure one;
 * among equally-common splits, picks the first found scanning left to
 * right. Returns null when no such split exists.
 */
export function splitIntoWords(name: string): [string, string] | null {
  const pool = getWordPool();
  const byWord = new Map(pool.map((e) => [e.word, e]));

  let best: [string, string] | null = null;
  let bestCommonCount = -1;
  for (let i = 2; i <= name.length - 2; i++) {
    const first = name.slice(0, i);
    const second = name.slice(i);
    const firstEntry = byWord.get(first);
    const secondEntry = byWord.get(second);
    if (!firstEntry || !secondEntry) continue;
    const commonCount = (firstEntry.common ? 1 : 0) + (secondEntry.common ? 1 : 0);
    if (commonCount > bestCommonCount) {
      best = [first, second];
      bestCommonCount = commonCount;
    }
  }
  return best;
}

/**
 * Validates a candidate's own known split (see Candidate.parts in
 * lib/candidates.ts — the literal two strings name was concatenated from,
 * e.g. ["poet", "apps"] for "poetapps", carried through from generation via
 * DiscoveryEvent's "found" case and FoundEntry rather than re-derived here.
 * Preferred over splitIntoWords whenever given: splitIntoWords only finds
 * splits where BOTH halves are in the WordNet-derived dictionary, which
 * misses splits built from a user's own keyword (e.g. "apps" itself isn't a
 * dictionary word, so "poetapps" was silently never checked as "poet apps"
 * at all, hiding a real Power Apps collision that only shows up once you
 * search the two words separately). Returns null if parts is absent or
 * doesn't actually concatenate to name — this endpoint is public, so a
 * caller-supplied parts value is never trusted to produce a search query
 * without that check.
 */
export function validateParts(name: string, parts: [string, string] | undefined): [string, string] | null {
  if (!parts) return null;
  const [first, second] = parts;
  if (!first || !second || first + second !== name) return null;
  return parts;
}

function formatResultsForPrompt(results: SearchResult[]): string {
  if (results.length === 0) return "(no results)";
  return results
    .slice(0, 10)
    .map((r) => `- ${r.title} | ${r.description} | ${r.url}`)
    .join("\n");
}

function buildPrompt(name: string, results: SearchResult[], twoWordSplit: string | null, region: Region): string {
  // Merged into the query itself as an OR term (see checkBrandability)
  // rather than a second search, so this note replaces what used to be a
  // separately-labeled, separately-weighted SEPARATE-WORDS results
  // section — the results below are now a single mixed list that can
  // contain hits for either reading, with no way to tell which one a
  // given result matched other than reading it.
  const twoWordNote = twoWordSplit
    ? `

Note: "${name}" also reads as the two real dictionary words "${twoWordSplit}"
— the search below is an OR of "${name}" and "${twoWordSplit}", so it can
surface either reading. A genuine hit that's actually about "${twoWordSplit}"
as a real phrase (a person, place, or brand) is a STRONGER, more reliable
collision than a fuzzy/incidental match on the raw concatenated "${name}" —
weight it accordingly wherever you can tell which reading a result is
actually about from its title, snippet, or URL.`
    : "";

  return `You are scoring how brandable the exact name "${name}" is — in
particular, how easy it would be to rank #1 in Google search for it — if
someone registered it today as a new brand/domain.

Give a brandability score from 0 to 100:
- 0 means essentially impossible to ever rank for. Treat "Google" itself as
  the reference point for 0 — an unimaginably dominant, ubiquitous term/brand
  that a new registrant could never realistically outrank or even appear
  near.
- 100 means completely wide open. Treat a long random string of letters
  with zero real-world usage anywhere as the reference point for 100 —
  nothing else could ever compete with it.
- Judge based on REAL collisions only: an existing company, product,
  well-known person, media franchise, dictionary word, or brand using this
  exact name, or that a search engine visibly reinterprets it as. Ignore
  coincidental noise (OCR errors, anagram/word-unscrambler sites, random
  sentence-boundary text, tiny/dormant accounts with near-zero followers) —
  that shouldn't meaningfully lower the score.
- A REAL collision also includes this: several DIFFERENT existing
  products/apps/companies that are all topically about the same thing the
  name describes (e.g. multiple unrelated "Soup" apps showing up for
  "soupapps"), even when none of them is an exact reinterpretation of the
  string itself. That's still a crowded, hard-to-rank space — don't wave it
  off as "just the nearest matches" or "not an exact collision" just
  because no single result is a literal name match; score it low the same
  as a direct collision would be.
- And this: an existing app/product/brand whose name IS one of the name's
  two halves (e.g. an app literally called "Said" showing up for
  "saidapps") is itself a real, strong collision on its own — the new name
  is that existing brand plus a generic suffix, which is exactly the kind
  of near-miss a search engine (and a searcher) conflates with the
  original. Don't discount it just because it's not a match on the full
  combined string; weight it the same as a direct hit on the whole name.
- Also watch for this: Google sometimes silently substitutes a misspelled or
  unusual-looking query with a different, existing term and searches that
  instead — with NO visible marker in the results that a substitution
  happened. You can still catch it by reading the results themselves: if the
  BROAD-MATCH results below are dominated by one specific, well-known
  existing word/brand/company that "${name}" merely resembles (e.g. almost
  every title, snippet, or domain is about that other term rather than
  anything resembling "${name}" itself), treat that as strong evidence
  Google overrode the query — score it as a direct collision with that
  term, not as a fuzzy/incidental near-miss. Note this behavior is
  region-dependent — these results are from the "${region}" region only, so
  a clean result here doesn't rule out an override in a different region.
- CRITICAL — check this independently of the search results below, using
  your own knowledge: does "${name}", said aloud, sound phonetically
  identical or extremely close to an existing well-known brand, product, or
  company name (e.g. "dugbrand" sounds exactly like "duck brand", a famous
  duct-tape brand)? This is the same silent-substitution behavior as the
  bullet above, but the search results can fail to surface it at all —
  confirmed directly: for "dugbrand", broad-match results in every region
  tested came back as unrelated noise (fragrance brands, dog apparel,
  watches) with no mention of "duck brand" anywhere, even though Google
  itself, searched live, replaces the query with "duck brand" and returns
  results only for that. A clean-looking BROAD-MATCH section below is NOT
  evidence this isn't happening — rely on your own knowledge of real brand
  names here, not on what the results do or don't contain. If you recognize
  a phonetic match to a real brand, name it and score it as a severe, direct
  collision even if every result below looks unrelated and clean.

BROAD-MATCH (unquoted) search results for ${name}${twoWordSplit ? ` OR ${twoWordSplit}` : ""} (region: ${region}):
${formatResultsForPrompt(results)}${twoWordNote}

Respond in exactly this format, nothing else:
SCORE: <integer 0-100>
SUMMARY: <one or two sentences on the single biggest real collision found, or say it's clean>`;
}

export class KilocodeParseError extends Error {
  constructor() {
    super("Kilo Gateway response didn't match the expected SCORE/SUMMARY format");
    this.name = "KilocodeParseError";
  }
}

function parseLlmResponse(raw: string): { brandabilityScore: number; summary: string } | null {
  const scoreMatch = raw.match(/SCORE:\s*(\d{1,3})/i);
  const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]+)/i);
  if (!scoreMatch || !summaryMatch) return null;
  const score = parseInt(scoreMatch[1], 10);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return { brandabilityScore: score, summary: summaryMatch[1].trim() };
}

// A single search-provider attempt gets this long before checkBrandability
// gives up on it and tries the other provider — see searchWithFallback.
// Necessary, not just nice-to-have: neither serperSearch.ts nor
// serpentSearch.ts apply any timeout of their own (only the caller's own
// cancellation signal, if any), so without this, a hang on the primary
// provider would never reject at all — the fallback below would simply
// never be reached, the same failure mode kilocode.ts's own timeout was
// added to fix (see its comment). 12s each, plus completeChat's own 30s
// (see kilocode.ts), keeps the worst realistic case (primary times out,
// fallback also times out, then the LLM call) under nginx's 60s default
// proxy_read_timeout for this route (see custom-domain.conf.j2 — no
// override for /api/brandability, unlike /api/discover's SSE stream).
const SEARCH_TIMEOUT_MS = 12000;

/** Tries PRIMARY_PROVIDER first, falls back to FALLBACK_PROVIDER once on
 * any failure — including a timeout (see SEARCH_TIMEOUT_MS) — except when
 * the caller's own `signal` is what aborted: that's a real cancellation
 * (the client disconnected, or checkBrandability's own outer `signal` was
 * aborted for some other reason upstream), not a provider problem, so
 * retrying with a different provider would be pointless and just add
 * latency to a request nobody's waiting on anymore. */
async function searchWithFallback(
  query: string,
  region: Region,
  signal: AbortSignal | undefined
): Promise<{ results: SearchResult[]; provider: Provider }> {
  const withTimeout = (s: AbortSignal | undefined) => {
    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    return s ? AbortSignal.any([s, timeoutSignal]) : timeoutSignal;
  };
  try {
    const results = await search(query, region, withTimeout(signal), PRIMARY_PROVIDER);
    return { results, provider: PRIMARY_PROVIDER };
  } catch (err) {
    if (signal?.aborted) throw err;
    const results = await search(query, region, withTimeout(signal), FALLBACK_PROVIDER);
    return { results, provider: FALLBACK_PROVIDER };
  }
}

/**
 * Runs the brandability check for one candidate name: a single unquoted
 * broad-match search in `region` (default DEFAULT_REGION — what does a
 * search engine resolve it to there, including near-miss real brands and
 * region-specific silent overrides? — see the "oddago"/"Oddogo" case and
 * the override-detection rubric bullet in buildPrompt), against whichever
 * search provider is currently working (see searchWithFallback — no
 * longer a caller choice at all; used to be a `provider` param threaded
 * from a dropdown in Advanced filters, removed in favor of the app just
 * handling it). When the name splits into two words (see validateParts
 * and splitIntoWords), that two-word phrase is folded into the SAME query
 * as an unquoted `OR` term — `name OR (word1 word2)`, parenthesized (not
 * quoted) so Google groups it as one OR operand instead of implicitly
 * AND-ing "word2" onto whatever follows — rather than a second, separate
 * search: halves the search-provider calls this check costs (real
 * money/quota either way, and apiserpent.com's concurrency limit is tied
 * to account balance — see searchProvider.ts) for the cost of losing the
 * ability to tell which side of the OR a given result actually matched;
 * buildPrompt asks the LLM to work that out from each result's own
 * content instead. No quoted exact-match anywhere in the query: it only
 * ever hid real collisions (a quoted search finds literal reuse of the
 * string, but a search engine's own near-miss interpretation of it — the
 * actual risk — only shows up unquoted), so it's not run.
 *
 * An LLM (via completeChat, requires KILOCODE_API_KEY) always turns those
 * results into a 0-100 brandability score — there's no count-based fallback
 * for a missing key or a failed/unparseable call, both of which now reject
 * instead (KilocodeApiKeyMissingError, the underlying fetch error, or
 * KilocodeParseError below). A prior count-based heuristic used to stand in
 * for all three cases, but a plain result count can't read what the results
 * actually say — it can't catch, for instance, Google's silent
 * query-override, where searching a misspelled/unusual name actually
 * returns results for a different, existing term with no marker anywhere
 * that a substitution happened (confirmed directly against the Serper.dev
 * and apiserpent.com APIs: both look identical to a clean search, nothing
 * to key off of programmatically — see searchProvider.ts). Only the LLM can
 * catch that, and buildPrompt gives it two independent ways to: reading the
 * actual result content (the first override-detection rubric bullet), and —
 * confirmed necessary directly, for "dugbrand" silently overridden to "duck
 * brand" by live Google, where broad-match results in every region tested
 * came back as unrelated noise with no trace of "duck brand" at all — its
 * own knowledge of real brand names, checked independently of whatever the
 * results do or don't contain (the second rubric bullet). So a real verdict
 * is required rather than silently degrading to a blind guess. Called
 * both automatically on every found result (checkBrandabilityFor's
 * autoCheck path in page.tsx — always on, no longer gated to a specific
 * provider, since which provider actually runs is now this function's own
 * problem, not something the client needs to reason about) and on-demand
 * via the "Brandability" button, after a candidate's domain (and, if
 * enabled, Instagram) availability is already confirmed.
 */
export async function checkBrandability(
  name: string,
  parts?: [string, string],
  signal?: AbortSignal,
  region: Region = DEFAULT_REGION
): Promise<BrandabilityResult> {
  const twoWordSplit = validateParts(name, parts) ?? splitIntoWords(name);
  const twoWordSplitStr = twoWordSplit ? twoWordSplit.join(" ") : null;
  // Parenthesized, not quoted — see this function's own doc comment above
  // for why both the grouping and the no-quotes-anywhere choice matter.
  const query = twoWordSplitStr ? `${name} OR (${twoWordSplitStr})` : name;
  const { results, provider } = await searchWithFallback(query, region, signal);

  const raw = await completeChat(buildPrompt(name, results, twoWordSplitStr, region), signal);
  const parsed = parseLlmResponse(raw);
  if (!parsed) throw new KilocodeParseError();
  const { brandabilityScore, summary } = parsed;

  return {
    name,
    brandabilityScore,
    summary,
    resultCount: results.length,
    region,
    provider,
    ...(twoWordSplitStr ? { twoWordSplit: twoWordSplitStr } : {}),
    topResults: results.slice(0, 5),
  };
}
