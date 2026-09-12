#!/usr/bin/env node
// Builds src/data/dictionaries.json directly from Open English Wordnet
// 2025's noun and adjective files (index.noun/data.noun, index.adj/data.adj,
// classic Princeton WNDB format), vendored locally in scripts/oewn-2025/
// (see the README there for provenance/license). That dictionary itself is
// the source here, not a cross-check against some other word list. Nothing
// in this script touches the network; re-run it any time (e.g. after
// updating the vendored files) to refresh the bundled word list.
//
// Previously used WordNet 3.1 (Princeton, last updated ~2011) via the
// wordnet-db npm package. Switched to Open English Wordnet — an actively
// maintained continuation of the same lexicon in the same file format, so
// no parsing changes were needed — since it picks up newer vocabulary
// (e.g. "vape", "vlog", "smol", "weeb") that predates-WordNet-3.1's cutoff.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "src", "data", "dictionaries.json");
const WORDNET_DIR = path.join(__dirname, "oewn-2025");

// Matches any valid Roman numeral (1-3999) spelled with standard
// subtractive notation, e.g. "xiv", "lxvi", "mmxi" — WordNet's indexes
// include these as valid "words" (they're indexed as numeral entries).
const ROMAN_NUMERAL_RE = /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

// A real word always contains a vowel, so requiring one is a cheap filter
// for the rare unit-symbol-like WordNet entry. Also reject words that are
// just one letter repeated and words that are entirely valid Roman
// numerals.
function isValidWord(word) {
  if (!/^[a-z]{3,4}$/.test(word)) return false;
  if (!/[aeiouy]/.test(word)) return false;
  if (/^(.)\1*$/.test(word)) return false;
  if (ROMAN_NUMERAL_RE.test(word)) return false;
  return true;
}

// Profanity, slurs, and a few ethnicity/religion group-names unsuitable as
// generated-brand-name fodder — not structurally distinguishable from
// ordinary common words the way abbreviations/proper nouns are (see
// isJunkByCasing below), so this still needs an explicit list.
const SAFETY_DENYLIST = new Set([
  "fuck", "cunt", "cock", "twat", "tits", "piss", "shag", "slut", "turd",
  "porn", "orgy", "poof", "nip", "meth", "pimp", "arse", "butt", "boob",
  "fags", "gays", "wank", "smut", "putz", "anal",
  "jap", "klan", "gook", "nig", "spic", "wog", "wop", "dink", "mong", "gyp", "mick",
  "jew", "jews", "turk", "arab", "huns", "gay",
  "nazi", "mdma", "cum", "perv", "weeb",
]);

// WordNet's index.adj follows an older grammatical scheme that files
// determiners/quantifiers under "adjective" synsets (e.g. "any", "some").
// These are real WordNet adjective entries, not junk, but they're function
// words rather than descriptive adjectives, so they read badly as a
// generated brand-name modifier (e.g. "somecat.com"). Excluded here as a
// correction to the POS category itself, not a taste judgment on the
// (much larger) set of genuine adjectives WordNet returns.
const MODIFIER_STOPWORDS = new Set([
  "all", "any", "both", "few", "less", "more", "most", "much", "only", "own",
  "some", "such", "very", "away", "nigh", "well", "then",
]);

// index.noun/index.adj list every lemma WordNet knows for that part of
// speech (one per line, "<lemma> <pos> ..."), always lowercased regardless
// of how the word is actually written.
async function loadWordNetIndex(pos) {
  const raw = await readFile(path.join(WORDNET_DIR, `index.${pos}`), "utf8");
  const lemmas = new Set();
  for (const line of raw.split("\n")) {
    // The file opens with ~29 lines of copyright header, each indented
    // with two spaces before a line number; real entries start at column 0.
    if (!line || line.startsWith("  ")) continue;
    const lemma = line.split(" ")[0];
    if (lemma) lemmas.add(lemma);
  }
  return lemmas;
}

// data.noun/data.adj list every synset WordNet knows for that part of
// speech, one per line: synset_offset, lex_filenum, ss_type, word_count
// (hex), then that many (word, lex_id) pairs — and unlike the index files,
// these preserve the word's real casing (data.noun literally contains the
// entry "09609728 18 n 01 Adam 0 ..."). That's a structural, WordNet-native
// signal for exactly the junk index.noun/index.adj otherwise let through:
// abbreviations are always ALL-CAPS ("AARP", "ADHD") and proper nouns are
// always Title-case ("Adam", "Agra"), while a genuine common word always
// has at least one all-lowercase occurrence across its senses (even a word
// like "cat" that also happens to be an acronym in one rare sense). This
// builds a lemma -> "has a lowercase sense" map from one data file.
// Returns both the aggregate hasLowercaseSense map (does this lemma have
// ANY lowercase sense at all) and, per lemma, exactly WHICH synset offsets
// used a lowercase form — needed later to pick a definition, since a word
// like "gore" has both a common-noun sense (lowercase, "an unpleasant
// application of violence") and a proper-noun sense (capitalized, the
// politician "Gore") and only the former should ever be shown as its
// definition, even though the word as a whole correctly counts as real.
async function loadCasingMap(pos) {
  const raw = await readFile(path.join(WORDNET_DIR, `data.${pos}`), "utf8");
  const hasLowercaseSense = new Map();
  const lowercaseOffsets = new Map();
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const parts = line.split(" ");
    const offset = parts[0];
    const wordCount = parseInt(parts[3], 16);
    if (!Number.isFinite(wordCount)) continue;
    for (let i = 0; i < wordCount; i++) {
      const word = parts[4 + i * 2];
      if (!word) continue;
      const lemma = word.toLowerCase().replace(/_/g, "");
      const isLowercase = word === word.toLowerCase();
      hasLowercaseSense.set(lemma, isLowercase || (hasLowercaseSense.get(lemma) ?? false));
      if (isLowercase) {
        if (!lowercaseOffsets.has(lemma)) lowercaseOffsets.set(lemma, new Set());
        lowercaseOffsets.get(lemma).add(offset);
      }
    }
  }
  return { hasLowercaseSense, lowercaseOffsets };
}

// Same index.noun/index.adj files as loadWordNetIndex, but keeping each
// lemma's synset offsets (the last synset_cnt whitespace-separated tokens
// on its line) instead of just recording that the lemma exists — needed to
// look up that lemma's gloss (definition) in data.noun/data.adj below.
// Uses trim()+split(/\s+/) rather than split(" ") specifically so a
// trailing space before the newline (present on every line in these files)
// doesn't become a bogus empty last token that'd throw off "last N tokens
// are the offsets".
async function loadWordNetOffsets(pos) {
  const raw = await readFile(path.join(WORDNET_DIR, `index.${pos}`), "utf8");
  const offsetsByLemma = new Map();
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const parts = line.trim().split(/\s+/);
    const synsetCount = parseInt(parts[2], 10);
    offsetsByLemma.set(parts[0], parts.slice(-synsetCount));
  }
  return offsetsByLemma;
}

// data.noun/data.adj list each synset's gloss (definition, plus usually
// quoted usage examples) after a "| " on the same line as its offset and
// word list.
async function loadGlossesByOffset(pos) {
  const raw = await readFile(path.join(WORDNET_DIR, `data.${pos}`), "utf8");
  const glossByOffset = new Map();
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const gloss = line.split("| ")[1];
    if (gloss) glossByOffset.set(line.slice(0, 8), gloss.trim());
  }
  return glossByOffset;
}

// WordNet glosses are "definition; "example one"; "example two"" — this
// keeps just the definition, for use as a short one-line UI subtitle.
function shortenGloss(gloss) {
  return gloss.split(/;\s*"/)[0].replace(/;\s*$/, "").trim();
}

async function main() {
  console.log("Loading WordNet noun/adjective data...");
  const [nouns, adjectives, nounCasing, adjCasing] = await Promise.all([
    loadWordNetIndex("noun"),
    loadWordNetIndex("adj"),
    loadCasingMap("noun"),
    loadCasingMap("adj"),
  ]);

  // A lemma is junk (an abbreviation or a proper noun/demonym, e.g. "AARP",
  // "Adam", "American") if every synset it appears in — across both noun
  // and adjective senses — used a capitalized form. A word with even one
  // genuine lowercase sense (like "cat", which has both common and acronym
  // senses) is kept.
  const hasLowercaseSense = (lemma) =>
    (nounCasing.hasLowercaseSense.get(lemma) ?? false) || (adjCasing.hasLowercaseSense.get(lemma) ?? false);

  const allLemmas = new Set([...nouns, ...adjectives]);
  const english = new Set(
    [...allLemmas].filter(
      (w) => isValidWord(w) && !SAFETY_DENYLIST.has(w) && hasLowercaseSense(w)
    )
  );
  console.log(`  -> ${english.size} words (3-4 letters)`);

  const englishModifiers = new Set(
    [...english].filter((w) => adjectives.has(w) && !MODIFIER_STOPWORDS.has(w))
  );
  console.log(`  -> ${englishModifiers.size} of ${english.size} words have an adjective sense (tagged as modifiers)`);

  console.log("Extracting definitions...");
  const [nounOffsets, adjOffsets, nounGlosses, adjGlosses] = await Promise.all([
    loadWordNetOffsets("noun"),
    loadWordNetOffsets("adj"),
    loadGlossesByOffset("noun"),
    loadGlossesByOffset("adj"),
  ]);
  // Picks the definition for word `w` from a specific POS's offsets/glosses/
  // lowercase-offsets, preferring the first sense that's genuinely lowercase
  // (skipping any that are only proper-noun/capitalized senses of that same
  // word, e.g. "gore" the substance vs. "Gore" the politician) — falling
  // back to the first sense at all only if somehow none qualify.
  function definitionFor(w, offsets, glosses, lowercaseOffsetSet) {
    const wordOffsets = offsets.get(w);
    if (!wordOffsets) return undefined;
    const offset = wordOffsets.find((o) => lowercaseOffsetSet.has(o)) ?? wordOffsets[0];
    return glosses.get(offset);
  }

  // A word tagged as a modifier is shown as an adjective in the UI, so its
  // definition should come from its adjective sense if it has one; every
  // other word is shown as the "core" (noun) half of a pairing, so its noun
  // sense is what's relevant — falling back to whichever sense actually
  // exists, since a word doesn't have to have both.
  const englishDefinitions = Object.fromEntries(
    [...english].map((w) => {
      const isModifierWord = englishModifiers.has(w);
      const gloss = isModifierWord
        ? (definitionFor(w, adjOffsets, adjGlosses, adjCasing.lowercaseOffsets.get(w) ?? new Set()) ??
          definitionFor(w, nounOffsets, nounGlosses, nounCasing.lowercaseOffsets.get(w) ?? new Set()))
        : (definitionFor(w, nounOffsets, nounGlosses, nounCasing.lowercaseOffsets.get(w) ?? new Set()) ??
          definitionFor(w, adjOffsets, adjGlosses, adjCasing.lowercaseOffsets.get(w) ?? new Set()));
      return [w, gloss ? shortenGloss(gloss) : ""];
    })
  );

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "WordNet 3.1 (via the wordnet-db package), index.noun/adj + data.noun/adj — no external fetch",
        english: [...english].sort(),
        // Subset of `english` that WordNet's index.adj lists as having an
        // adjective sense — used to bias candidate generation toward
        // modifier+noun pairs (see src/lib/modifiers.ts and candidates.ts)
        // instead of two arbitrary nouns jammed together.
        englishModifiers: [...englishModifiers].sort(),
        // word -> short WordNet gloss (first relevant sense's definition,
        // usage examples stripped). Shown in the UI under each result
        // instead of the (now pointless, English-only) "English + English"
        // origin label. See src/lib/definitions.ts.
        englishDefinitions,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
