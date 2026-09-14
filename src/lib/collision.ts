import { braveSearch, type BraveResult } from "@/lib/braveSearch";
import { completeChat } from "@/lib/openrouter";
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
  quotedResultCount: number;
  unquotedResultCount: number;
  /** The two dictionary words the name was split into, e.g. "even chad" for
   * "evenchad" — present only when such a split exists — and the unquoted
   * result count for searching that phrase. See splitIntoWords: this is
   * what caught real two-word collisions by hand that the concatenated
   * searches above miss entirely (e.g. "evenchad" reads clean until you
   * search "even chad" and find it's a real person). */
  twoWordSplit?: string;
  twoWordResultCount?: number;
  /** Quoted-match results if there were any, else the top unquoted ones —
   * whichever set actually explains the score. */
  topResults: BraveResult[];
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

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Stands in whenever there's no OPENROUTER_API_KEY, or the LLM call itself
 * fails — a crude but dependency-free signal beats no signal at all. Pure
 * result-count penalty: each exact-quote hit costs more than each broad-
 * match hit, since that's what repeatedly caught the worst real collisions
 * by hand (e.g. the quoted search for "oddago" looked clean, but the
 * unquoted one immediately surfaced the real company "Oddogo" one letter
 * away — a broad-match hit still matters, just less than a literal one).
 * Zero hits on both is the one case this heuristic can be fully confident
 * about, so it's the only score that reaches the true endpoints.
 */
function heuristicScore(
  quotedCount: number,
  unquotedCount: number,
  twoWordSplit: string | null,
  twoWordCount: number
): { rankabilityScore: number; summary: string } {
  if (quotedCount === 0 && unquotedCount === 0 && twoWordCount === 0) {
    return {
      rankabilityScore: 100,
      summary: "No results at all under either search — nothing to compete with.",
    };
  }
  const penalty = quotedCount * 7 + unquotedCount * 3 + twoWordCount * 5;
  const twoWordNote = twoWordSplit ? ` and ${twoWordCount} result(s) for "${twoWordSplit}"` : "";
  return {
    rankabilityScore: clampScore(100 - penalty),
    summary: `${quotedCount} exact-match and ${unquotedCount} broad-match result(s) found${twoWordNote}. Set OPENROUTER_API_KEY for a real verdict instead of this count-based estimate.`,
  };
}

function formatResultsForPrompt(results: BraveResult[]): string {
  if (results.length === 0) return "(no results)";
  return results
    .slice(0, 10)
    .map((r) => `- ${r.title} | ${r.description} | ${r.url}`)
    .join("\n");
}

function buildPrompt(
  name: string,
  quoted: BraveResult[],
  unquoted: BraveResult[],
  twoWordSplit: string | null,
  twoWord: BraveResult[]
): string {
  const twoWordSection = twoWordSplit
    ? `

SEPARATE-WORDS (unquoted) search results for "${twoWordSplit}" — "${name}" also reads as
these two real dictionary words, so check whether that phrase names something
real (a person, place, or brand) even if the concatenated form looks clean:
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

EXACT-MATCH (quoted) search results for "${name}":
${formatResultsForPrompt(quoted)}

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
 * Runs the collision/rankability check for one candidate name: an exact-
 * quote Brave search (does anything actually use this literal string?), an
 * unquoted broad-match search (what does a search engine resolve it to,
 * including near-miss real brands? — see the "oddago"/"Oddogo" case in
 * heuristicScore above), and — when the name itself splits into two real
 * dictionary words (see splitIntoWords) — an unquoted search for that
 * two-word phrase, since a concatenated name can look entirely clean while
 * reading it as two words surfaces a real person, place, or brand. If
 * OPENROUTER_API_KEY is set, an LLM turns those results into a 0-100
 * rankability score; otherwise heuristicScore stands in. Called once per
 * found candidate, after its domain (and, if enabled, Instagram)
 * availability is already confirmed — see checkRankabilityOne in
 * discovery.ts — never against every candidate a search merely examines,
 * since Brave's free tier is a low monthly quota.
 */
export async function checkCollision(name: string, signal?: AbortSignal): Promise<CollisionResult> {
  const twoWordSplit = splitIntoWords(name);
  const [quoted, unquoted, twoWord] = await Promise.all([
    braveSearch(`"${name}"`, signal),
    braveSearch(name, signal),
    twoWordSplit ? braveSearch(twoWordSplit.join(" "), signal) : Promise.resolve<BraveResult[]>([]),
  ]);
  const twoWordSplitStr = twoWordSplit ? twoWordSplit.join(" ") : null;

  let rankabilityScore: number;
  let summary: string;

  if (process.env.OPENROUTER_API_KEY) {
    try {
      const parsed = parseLlmResponse(
        await completeChat(buildPrompt(name, quoted, unquoted, twoWordSplitStr, twoWord), signal)
      );
      if (parsed) {
        ({ rankabilityScore, summary } = parsed);
      } else {
        ({ rankabilityScore, summary } = heuristicScore(quoted.length, unquoted.length, twoWordSplitStr, twoWord.length));
      }
    } catch (err) {
      // LLM call failed (rate limited, network error, malformed response,
      // etc.) — fall back rather than losing the check entirely. Logged
      // (not swallowed silently) since a bad default model or a dead key
      // otherwise degrades to the heuristic on every single check without
      // any visible sign that something's wrong.
      console.error(`checkCollision: OpenRouter call failed for "${name}", using heuristic instead`, err);
      ({ rankabilityScore, summary } = heuristicScore(quoted.length, unquoted.length, twoWordSplitStr, twoWord.length));
    }
  } else {
    ({ rankabilityScore, summary } = heuristicScore(quoted.length, unquoted.length, twoWordSplitStr, twoWord.length));
  }

  return {
    name,
    rankabilityScore,
    summary,
    quotedResultCount: quoted.length,
    unquotedResultCount: unquoted.length,
    ...(twoWordSplitStr ? { twoWordSplit: twoWordSplitStr, twoWordResultCount: twoWord.length } : {}),
    topResults: quoted.length > 0 ? quoted.slice(0, 5) : unquoted.slice(0, 5),
  };
}
