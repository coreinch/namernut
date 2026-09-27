const VOWELS = new Set(["a", "e", "i", "o", "u"]);

// Reject 4+ consecutive consonants, 3+ consecutive vowels, or the same
// letter 3+ times in a row — a cheap heuristic bias toward names that
// actually read as brandable words rather than arbitrary letter strings.
// This runs before any network request, so rejected candidates cost
// nothing (no RDAP call, no delay) — just skipped in place.
const MAX_CONSONANT_RUN = 3;
const MAX_VOWEL_RUN = 2;
const MAX_SAME_LETTER_RUN = 2;

/**
 * "y" is a semivowel: it reads as a consonant next to a true vowel (the
 * "y" in "yellow", "boy") but as the syllable's vowel when it's not (the
 * "y" in "glyph", "rhythm") — without this, real, easily-pronounceable
 * words like those get rejected as unpronounceable for having 4 "consonants"
 * in a row.
 */
function isVowelAt(chars: string[], i: number): boolean {
  const ch = chars[i];
  if (VOWELS.has(ch)) return true;
  if (ch !== "y") return false;
  return !VOWELS.has(chars[i - 1]) && !VOWELS.has(chars[i + 1]);
}

export function isPronounceable(name: string): boolean {
  const chars = [...name];
  let consonantRun = 0;
  let vowelRun = 0;
  let sameLetterRun = 1;
  let prevChar = "";

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (isVowelAt(chars, i)) {
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
