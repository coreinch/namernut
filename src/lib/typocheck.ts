// Flags a candidate name that's suspiciously close (one character
// substituted, inserted, or deleted) to an unrelated, much more common
// English word — the kind of thing that reads as an obvious typo rather
// than an intentional invented name. This is a local, free approximation
// of what a search engine's "Showing results for X" spelling correction
// would catch: there's no live equivalent available to build against —
// Google's Custom Search JSON API (the official way to get that signal) is
// closed to new customers, and scraping Google's own search results page
// directly is against its Terms of Service (and actively litigated, e.g.
// Google v. SerpApi) — so this checks against the dictionary's own
// frequency-tagged "common" word list instead of a live search index. It
// won't catch a collision with a brand name or anything outside this
// dictionary, but needs no external service, no signup, and no cost.
//
// Runs before any network request (see discovery.ts), like
// isPronounceable — a rejected candidate costs nothing.

/** True if `a` and `b` differ by at most one character substitution, insertion, or deletion. */
function isEditDistanceAtMostOne(a: string, b: string): boolean {
  const lenDiff = a.length - b.length;
  if (Math.abs(lenDiff) > 1) return false;

  if (lenDiff === 0) {
    let mismatches = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i] && ++mismatches > 1) return false;
    }
    return true;
  }

  // Off by exactly one character in length: walk both strings together,
  // allowing exactly one skip in the longer one (an insertion relative to
  // the shorter string, i.e. a deletion relative to the longer one).
  const longer = lenDiff > 0 ? a : b;
  const shorter = lenDiff > 0 ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      i++;
    }
  }
  return true;
}

export interface TypoIndex {
  /** Returns the common word `name` looks like a typo of, or null if it doesn't look like one. */
  findMatch(name: string): string | null;
}

/**
 * Builds a lookup over `commonWords`, bucketed by length so a check only
 * compares against words that could possibly be within edit distance 1
 * (same length, or one shorter/longer) instead of the whole list every
 * time.
 */
export function buildTypoIndex(commonWords: string[]): TypoIndex {
  const byLength = new Map<number, string[]>();
  for (const word of commonWords) {
    const bucket = byLength.get(word.length);
    if (bucket) bucket.push(word);
    else byLength.set(word.length, [word]);
  }

  return {
    findMatch(name) {
      for (const len of [name.length - 1, name.length, name.length + 1]) {
        const bucket = byLength.get(len);
        if (!bucket) continue;
        for (const word of bucket) {
          // An exact match means the candidate simply *is* that word, not
          // a typo of it — nothing to flag.
          if (word !== name && isEditDistanceAtMostOne(name, word)) return word;
        }
      }
      return null;
    },
  };
}
