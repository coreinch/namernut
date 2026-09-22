import { completeChat } from "@/lib/kilocode";

const MAX_SYNONYMS = 6;

/**
 * Asks the LLM for a handful of short, single-word synonyms/related
 * concepts for a user-typed keyword, so a keyword search can pair a
 * dictionary word with an idea related to what the keyword *means* — not
 * just its literal spelling. See selectTierSpecs in candidates.ts, which
 * turns each returned word into its own keyword-shaped tier alongside the
 * literal keyword itself: this is purely additive, the same way Namelix's
 * "Brandable"/"Evocative" styles draw on a keyword's synonyms rather than
 * only concatenating it verbatim, layered onto Namernut's existing
 * dictionary-pairing search instead of replacing it.
 *
 * Returns [] (never throws) on any failure — no KILOCODE_API_KEY set, rate
 * limited, malformed response — so a keyword search always still works
 * with just the literal keyword if this doesn't pan out; it's a bonus on
 * top of existing behavior, never a requirement for it.
 */
export async function suggestKeywordSynonyms(keyword: string, signal?: AbortSignal): Promise<string[]> {
  if (!process.env.KILOCODE_API_KEY) return [];

  const prompt = `Give ${MAX_SYNONYMS} short, single-word synonyms or closely related concepts for "${keyword}" that would each work well as half of a brandable startup/domain name — think thesaurus, not dictionary definition (e.g. for "fast": quick, rapid, swift, blaze, dash, zoom).

Respond with exactly one lowercase word per line, nothing else — no numbering, no punctuation, no explanation.`;

  try {
    const raw = await completeChat(prompt, signal);
    const words = raw
      .split("\n")
      .map((line) => line.trim().toLowerCase().replace(/[^a-z]/g, ""))
      .filter((word) => word.length >= 2 && word.length <= 15 && word !== keyword.toLowerCase());
    return [...new Set(words)].slice(0, MAX_SYNONYMS);
  } catch (err) {
    // Same posture as checkBrandability in brandability.ts: log rather than
    // swallow silently, so a dead key or a bad default model doesn't
    // degrade every keyword search with no visible sign anything's wrong —
    // but still fall back (to literal-keyword-only) rather than failing
    // the search itself over what's meant to be a bonus.
    console.error(`suggestKeywordSynonyms: Kilo Gateway call failed for "${keyword}"`, err);
    return [];
  }
}
