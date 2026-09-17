import { completeChat } from "@/lib/kilocode";

const BATCH_SIZE = 20;

/**
 * Asks the LLM to invent a batch of short, coined, brandable words — the
 * Namelix "Brandable"/"Evocative" style (think "Zuvio", "Fovixia"), which
 * is structurally different from everything else Namerag generates: every
 * other candidate is built by pairing two real dictionary (or keyword)
 * strings, but an invented word has no real halves to pair — it's the
 * whole candidate name on its own. See buildInventedTier in candidates.ts,
 * which wraps each returned word as its own one-word candidate.
 *
 * `keyword`, when given, steers the theme of the invented words (e.g.
 * "fast" nudging toward speed-adjacent coinages) — unlike
 * suggestKeywordSynonyms, nothing here is glued onto the keyword itself,
 * so the connection is thematic, not spelled out in the word.
 *
 * Returns [] (never throws) on any failure — no KILOCODE_API_KEY set, rate
 * limited, malformed response — the same fail-safe posture as
 * suggestKeywordSynonyms: this is a bonus candidate source, never a
 * requirement for a search to work.
 */
export async function suggestInventedNames(keyword: string | undefined, signal?: AbortSignal): Promise<string[]> {
  if (!process.env.KILOCODE_API_KEY) return [];

  const theme = keyword
    ? ` clearly evoking the idea of "${keyword}" (its meaning, sound, or vibe — not necessarily containing the letters of "${keyword}" itself)`
    : "";
  const prompt = `Invent ${BATCH_SIZE} short, brandable, made-up words${theme} suitable as a startup or domain name — coined words with no real dictionary meaning, in the style of "Zuvio", "Fovixia", "Devosix", "Nexbara". Each one should be easy to pronounce and spell, 4-10 letters.

Respond with exactly one lowercase word per line, nothing else — no numbering, no punctuation, no explanation.`;

  try {
    const raw = await completeChat(prompt, signal);
    const words = raw
      .split("\n")
      .map((line) => line.trim().toLowerCase().replace(/[^a-z]/g, ""))
      .filter((word) => word.length >= 3 && word.length <= 20);
    return [...new Set(words)].slice(0, BATCH_SIZE);
  } catch (err) {
    console.error("suggestInventedNames: Kilo Gateway call failed", err);
    return [];
  }
}
