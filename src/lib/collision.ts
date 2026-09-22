import { serperSearch, type SerperResult } from "@/lib/serperSearch";
import { completeChat } from "@/lib/kilocode";
import { getWordPool } from "@/lib/dictionary";

export interface CollisionResult {
  name: string;
  /**
   * 0-100. 0 means essentially impossible to ever rank for — as saturated
   * as a name gets, the reference point being "Google" itself: an
   * unimaginably dominant, ubiquitous term nothing could realistically
   * outrank. 100 means wide open — the reference point being a long random
   * string with zero real-world usage anywhere, nothing to compete with at
   * all.
   */
  rankabilityScore: number;
  summary: string;
  unquotedResultCount: number;
  /** The two dictionary words the name was split into, e.g. "even chad" for
   * "evenchad" — present only when such a split exists — and the unquoted
   * result count for searching that phrase. See splitIntoWords: this is
   * what caught real two-word collisions by hand that the concatenated
   * search above misses entirely (e.g. "evenchad" reads clean until you
   * search "even chad" and find it's a real person). */
  twoWordSplit?: string;
  twoWordResultCount?: number;
  /** The two-word split results if there were any, else the unquoted-name
   * ones — the split takes priority since a match there is a stronger
   * collision signal (see heuristicScore) and previously got silently
   * hidden behind unquoted results whenever both existed. */
  topResults: SerperResult[];
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

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Stands in whenever there's no KILOCODE_API_KEY, or the LLM call itself
 * fails — a crude but dependency-free signal beats no signal at all. Pure
 * result-count penalty, unquoted broad-match hits only (see checkCollision
 * for why there's no quoted search): the exact string search that used to
 * run alongside this one only ever hid real collisions rather than adding
 * any (e.g. the quoted search for "oddago" looked clean, but the unquoted
 * one immediately surfaced the real company "Oddogo" one letter away). A
 * two-word split hit is weighted higher than a plain broad-match hit — a
 * result for "even chad" means Google resolves the name to a genuine
 * two-word phrase (a name, a place, a real phrase), which is a much more
 * reliable collision signal than a broad-match hit on the raw concatenated
 * string, which is often just fuzzy/incidental matching. Zero hits on both
 * is the one case this heuristic can be fully confident about, so it's the
 * only score that reaches the true endpoints.
 */
function heuristicScore(
  unquotedCount: number,
  twoWordSplit: string | null,
  twoWordCount: number,
  reason: "no_key" | "rate_limited" | "other_error"
): { rankabilityScore: number; summary: string } {
  const reasonNote =
    reason === "no_key"
      ? "Set KILOCODE_API_KEY for a real verdict instead of this count-based estimate."
      : reason === "rate_limited"
        ? "Kilo Gateway's free-tier daily request limit is exhausted — this is a count-based estimate until it resets."
        : "Kilo Gateway didn't return a usable verdict — this is a count-based estimate instead.";
  if (unquotedCount === 0 && twoWordCount === 0) {
    return {
      rankabilityScore: 100,
      summary: `No results at all under either search — nothing to compete with. ${reasonNote}`,
    };
  }
  const penalty = unquotedCount * 4 + twoWordCount * 8;
  const twoWordNote = twoWordSplit ? ` and ${twoWordCount} result(s) for "${twoWordSplit}"` : "";
  return {
    rankabilityScore: clampScore(100 - penalty),
    summary: `${unquotedCount} broad-match result(s) found${twoWordNote}. ${reasonNote}`,
  };
}

function formatResultsForPrompt(results: SerperResult[]): string {
  if (results.length === 0) return "(no results)";
  return results
    .slice(0, 10)
    .map((r) => `- ${r.title} | ${r.description} | ${r.url}`)
    .join("\n");
}

function buildPrompt(
  name: string,
  unquoted: SerperResult[],
  twoWordSplit: string | null,
  twoWord: SerperResult[]
): string {
  const twoWordSection = twoWordSplit
    ? `

SEPARATE-WORDS (unquoted) search results for "${twoWordSplit}" — "${name}" also reads as
these two real dictionary words, so check whether that phrase names something
real (a person, place, or brand) even if the concatenated form looks clean.
Weight a genuine hit here MORE heavily than a broad-match hit above: a
result for "${twoWordSplit}" means the name resolves to an actual two-word
phrase, which is a stronger, more reliable collision than fuzzy/incidental
matching on the raw concatenated string:
${formatResultsForPrompt(twoWord)}`
    : "";

  return `You are scoring how easy it would be to rank #1 in Google search for the
exact name "${name}" if someone registered it today as a new brand/domain.

Give a rankability score from 0 to 100:
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

BROAD-MATCH (unquoted) search results for ${name}:
${formatResultsForPrompt(unquoted)}${twoWordSection}

Respond in exactly this format, nothing else:
SCORE: <integer 0-100>
SUMMARY: <one or two sentences on the single biggest real collision found, or say it's clean>`;
}

function parseLlmResponse(raw: string): { rankabilityScore: number; summary: string } | null {
  const scoreMatch = raw.match(/SCORE:\s*(\d{1,3})/i);
  const summaryMatch = raw.match(/SUMMARY:\s*([\s\S]+)/i);
  if (!scoreMatch || !summaryMatch) return null;
  const score = parseInt(scoreMatch[1], 10);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return { rankabilityScore: score, summary: summaryMatch[1].trim() };
}

/**
 * Runs the collision/rankability check for one candidate name: an unquoted
 * broad-match search (what does a search engine resolve it to, including
 * near-miss real brands? — see the "oddago"/"Oddogo" case in
 * heuristicScore above), and — when the name splits into two words (see
 * validateParts and splitIntoWords) — an unquoted search for that
 * two-word phrase, since a concatenated name can look entirely clean while
 * reading it as two words surfaces a real person, place, or brand. No
 * quoted exact-match search: it only ever hid real collisions (a quoted
 * search finds literal reuse of the string, but a search engine's own
 * near-miss interpretation of it — the actual risk — only shows up
 * unquoted), so it's not run. If KILOCODE_API_KEY is set, an LLM turns
 * those results into a 0-100 rankability score; otherwise heuristicScore
 * stands in. Called once per found candidate, after its domain (and, if
 * enabled, Instagram) availability is already confirmed — see
 * checkRankabilityOne in discovery.ts — never against every candidate a
 * search merely examines, since Serper.dev's free tier is a low monthly quota.
 */
export async function checkCollision(
  name: string,
  parts?: [string, string],
  signal?: AbortSignal
): Promise<CollisionResult> {
  const twoWordSplit = validateParts(name, parts) ?? splitIntoWords(name);
  const [unquoted, twoWord] = await Promise.all([
    serperSearch(name, signal),
    twoWordSplit ? serperSearch(twoWordSplit.join(" "), signal) : Promise.resolve<SerperResult[]>([]),
  ]);
  const twoWordSplitStr = twoWordSplit ? twoWordSplit.join(" ") : null;

  let rankabilityScore: number;
  let summary: string;

  if (process.env.KILOCODE_API_KEY) {
    try {
      const parsed = parseLlmResponse(
        await completeChat(buildPrompt(name, unquoted, twoWordSplitStr, twoWord), signal)
      );
      if (parsed) {
        ({ rankabilityScore, summary } = parsed);
      } else {
        ({ rankabilityScore, summary } = heuristicScore(unquoted.length, twoWordSplitStr, twoWord.length, "other_error"));
      }
    } catch (err) {
      // LLM call failed (rate limited, network error, malformed response,
      // etc.) — fall back rather than losing the check entirely. Logged
      // (not swallowed silently) since a bad default model or a dead key
      // otherwise degrades to the heuristic on every single check without
      // any visible sign that something's wrong.
      console.error(`checkCollision: Kilo Gateway call failed for "${name}", using heuristic instead`, err);
      const reason = err instanceof Error && err.name === "RateLimitError" ? "rate_limited" : "other_error";
      ({ rankabilityScore, summary } = heuristicScore(unquoted.length, twoWordSplitStr, twoWord.length, reason));
    }
  } else {
    ({ rankabilityScore, summary } = heuristicScore(unquoted.length, twoWordSplitStr, twoWord.length, "no_key"));
  }

  return {
    name,
    rankabilityScore,
    summary,
    unquotedResultCount: unquoted.length,
    ...(twoWordSplitStr ? { twoWordSplit: twoWordSplitStr, twoWordResultCount: twoWord.length } : {}),
    topResults: twoWord.length > 0 ? twoWord.slice(0, 5) : unquoted.slice(0, 5),
  };
}
