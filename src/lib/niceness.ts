// Scores how "English-sounding" a candidate name is, based on how common
// each pair of adjacent letters (a bigram) is across the real English
// dictionary already vendored in this app. isPronounceable already
// rejects extreme cases (four consonants in a row, etc.), but plenty of
// strings pass that and still read as clumsy rather than word-like — e.g.
// "rumwig" has the letter pair "mw", which barely occurs in real English
// words, while "sixivy" is built entirely from pairs ("si", "ix", "xi",
// "iv", "vy") that are all common. The score is the WEAKEST link — the
// least common bigram in the name — not an average across all of them,
// since one awkward pair makes a name feel clumsy no matter how smooth
// the rest is (the same "any violation ruins it" logic isPronounceable
// already uses for consonant/vowel runs).

export interface NicenessIndex {
  /** Fraction (0-1) of all bigrams in the source dictionary that the name's least-common bigram accounts for. Higher = more natural-sounding. */
  score(name: string): number;
}

/** Builds a bigram-frequency table from real dictionary words. */
export function buildNicenessIndex(words: string[]): NicenessIndex {
  const counts = new Map<string, number>();
  let total = 0;
  for (const word of words) {
    for (let i = 0; i < word.length - 1; i++) {
      const bigram = word.slice(i, i + 2);
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
      total++;
    }
  }

  return {
    score(name) {
      if (name.length < 2) return 1;
      let min = Infinity;
      for (let i = 0; i < name.length - 1; i++) {
        const freq = (counts.get(name.slice(i, i + 2)) ?? 0) / total;
        if (freq < min) min = freq;
      }
      return min;
    },
  };
}
