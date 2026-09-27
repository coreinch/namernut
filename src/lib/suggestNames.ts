import { completeChat } from "@/lib/kilocode";
import { MAX_SYNONYMS } from "@/lib/synonyms";
import { BATCH_SIZE } from "@/lib/inventedNames";

function parseWords(section: string | undefined, minLen: number, maxLen: number, exclude?: string): string[] {
  const words = (section ?? "")
    .split("\n")
    .map((line) => line.trim().toLowerCase().replace(/[^a-z]/g, ""))
    .filter((word) => word.length >= minLen && word.length <= maxLen && word !== exclude);
  return [...new Set(words)];
}

/**
 * Combines suggestKeywordSynonyms and suggestInventedNames into a single
 * completeChat call, for the common case where a search wants both (see
 * route.ts) — halving the LLM round-trips (and the latency/cost that comes
 * with each) whenever a keyword is typed and both AI toggles are on. Kept
 * as a third function rather than folding into either existing one so both
 * suggestKeywordSynonyms and suggestInventedNames still work standalone for
 * the partial-toggle cases (only one enabled, or no keyword at all — the
 * synonym half needs a keyword, but invented names don't).
 *
 * Parses the response by section header rather than a fixed line count, so
 * a malformed or reordered response degrades to partial results (e.g. only
 * synonyms) instead of misattributing invented words as synonyms or vice
 * versa.
 */
export async function suggestSynonymsAndInvented(
  keyword: string,
  signal?: AbortSignal
): Promise<{ synonyms: string[]; invented: string[] }> {
  const empty = { synonyms: [], invented: [] };
  if (!process.env.KILOCODE_API_KEY) return empty;

  const prompt = `You're brainstorming words for a startup/domain name generator themed around "${keyword}". Do two separate tasks and label each section exactly as shown.

SYNONYMS:
Give ${MAX_SYNONYMS} short, single-word synonyms or closely related concepts for "${keyword}" that would each work well as half of a brandable startup/domain name — think thesaurus, not dictionary definition (e.g. for "fast": quick, rapid, swift, blaze, dash, zoom).

INVENTED:
Invent ${BATCH_SIZE} short, brandable, made-up words clearly evoking the idea of "${keyword}" (its meaning, sound, or vibe — not necessarily containing the letters of "${keyword}" itself) suitable as a startup or domain name — coined words with no real dictionary meaning, in the style of "Zuvio", "Fovixia", "Devosix", "Nexbara". Each one should be easy to pronounce and spell, 4-10 letters.

Respond with exactly this structure and nothing else — no extra commentary, one lowercase word per line within each section, no numbering, no punctuation:
SYNONYMS:
<words>
INVENTED:
<words>`;

  try {
    const raw = await completeChat(prompt, signal);
    const synonymsSection = raw.match(/SYNONYMS:([\s\S]*?)(?:INVENTED:|$)/i)?.[1];
    const inventedSection = raw.match(/INVENTED:([\s\S]*)/i)?.[1];
    const synonyms = parseWords(synonymsSection, 2, 15, keyword.toLowerCase()).slice(0, MAX_SYNONYMS);
    const invented = parseWords(inventedSection, 3, 20).slice(0, BATCH_SIZE);
    return { synonyms, invented };
  } catch (err) {
    console.error(`suggestSynonymsAndInvented: Kilo Gateway call failed for "${keyword}"`, err);
    return empty;
  }
}
