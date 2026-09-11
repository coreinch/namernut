const VOWELS = new Set(["a", "e", "i", "o", "u"]);

// Reject 4+ consecutive consonants, 3+ consecutive vowels, or the same
// letter 3+ times in a row — a cheap heuristic bias toward names that
// actually read as brandable words rather than arbitrary letter strings.
// This runs before any network request, so rejected candidates cost
// nothing (no RDAP call, no delay) — just skipped in place.
const MAX_CONSONANT_RUN = 3;
const MAX_VOWEL_RUN = 2;
const MAX_SAME_LETTER_RUN = 2;

export function isPronounceable(name: string): boolean {
  let consonantRun = 0;
  let vowelRun = 0;
  let sameLetterRun = 1;
  let prevChar = "";

  for (const ch of name) {
    if (VOWELS.has(ch)) {
      vowelRun++;
      consonantRun = 0;
      if (vowelRun > MAX_VOWEL_RUN) return false;
    } else {
      consonantRun++;
      vowelRun = 0;
      if (consonantRun > MAX_CONSONANT_RUN) return false;
    }

    if (ch === prevChar) {
      sameLetterRun++;
      if (sameLetterRun > MAX_SAME_LETTER_RUN) return false;
    } else {
      sameLetterRun = 1;
    }
    prevChar = ch;
  }

  return true;
}
