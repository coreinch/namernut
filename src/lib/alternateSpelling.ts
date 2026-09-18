/**
 * Deterministic, rule-based phonetic respellings of a word — the
 * "Alternate spelling" naming style (like "Lyft" for "lift", "Fiverr" for
 * "fiver", "Flickr" for "flicker") without ever calling an LLM: a small,
 * fixed set of substitutions that preserve how a word *sounds* while
 * changing how it's *spelled*, which is exactly what makes a respelled
 * word read as an intentional, ownable brand rather than a typo. Unlike
 * suggestKeywordSynonyms/suggestInventedNames this is pure and synchronous
 * — no network call, no failure mode, no cost — so it can run directly
 * inside buildCandidateSpace instead of being fetched by the API route
 * ahead of time.
 *
 * Each rule is independent and order doesn't matter; a word can match more
 * than one (e.g. "picker" matches both the i->y and the -er->-r rules,
 * yielding "pycker" and "pickr").
 */
export function alternateSpellings(word: string): string[] {
  const results = new Set<string>();

  // "tumbler" -> "tumblr", "flicker" -> "flickr": drop the vowel right
  // before a final -er.
  if (/er$/.test(word)) {
    results.add(word.slice(0, -2) + "r");
  }

  // "lift" -> "lyft": swap the first i for a y — keeps the same sound most
  // English speakers give a short/long i, while reading as a deliberate
  // respelling rather than a typo. Skipped if the word already has a y,
  // to avoid two y's reading as an actual misspelling.
  const iIndex = word.indexOf("i");
  if (iIndex !== -1 && !word.includes("y")) {
    results.add(word.slice(0, iIndex) + "y" + word.slice(iIndex + 1));
  }

  // "cool" -> "kool", "candy" -> "kandy": swap a hard c (followed by
  // a/o/u/l/r, or at the end of the word) for k. Skips a soft c (followed
  // by e/i/y, which sounds like "s") since swapping that to k would change
  // the pronunciation, not just the spelling.
  const hardC = /c(?=[aoulr]|$)/;
  if (hardC.test(word)) {
    results.add(word.replace(hardC, "k"));
  }

  // "fiver" -> "fiverr", "dig" -> "digg": double a single final consonant
  // preceded by a vowel.
  if (/[aeiou][^aeiouwxy]$/.test(word)) {
    results.add(word + word[word.length - 1]);
  }

  results.delete(word);
  return [...results];
}
