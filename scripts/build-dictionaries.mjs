#!/usr/bin/env node
// Builds src/data/dictionaries.json directly from Open English Wordnet
// 2025's noun and adjective files (index.noun/data.noun, index.adj/data.adj,
// classic Princeton WNDB format), vendored locally in scripts/oewn-2025/
// (see the README there for provenance/license). That dictionary itself is
// the source here, not a cross-check against some other word list.
//
// Previously used WordNet 3.1 (Princeton, last updated ~2011) via the
// wordnet-db npm package. Switched to Open English Wordnet — an actively
// maintained continuation of the same lexicon in the same file format, so
// no parsing changes were needed — since it picks up newer vocabulary
// (e.g. "vape", "vlog", "smol", "weeb") that predates-WordNet-3.1's cutoff.
//
// One network fetch: an English word-frequency list, used only to tag
// which dictionary words are common enough to prioritize in search (see
// englishCommon below) — everything else here is fully offline.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "src", "data", "dictionaries.json");
const WORDNET_DIR = path.join(__dirname, "oewn-2025");

// hermitdave/FrequencyWords: English word-frequency list derived from
// OpenSubtitles dialogue — used only to rank words by how commonly they're
// actually used, not as a word source (WordNet is still the dictionary;
// this never adds a word WordNet doesn't already have).
const FREQUENCY_LIST_URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt";

// How far down the frequency list (by rank, 0 = most frequent) a word may
// sit and still count as "common" — i.e. worth prioritizing in search
// results over the long tail of real-but-obscure WordNet entries. Chosen
// empirically: high enough to include everyday adjectives and nouns
// ("blue", "ice"), low enough to exclude rare/technical vocabulary.
const COMMON_WORD_RANK_CUTOFF = 10000;

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "domain-finder-dictionary-builder" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

function loadFrequencyRanks(raw) {
  const rank = new Map();
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const word = lines[i].trim().split(/\s+/)[0]?.toLowerCase();
    if (word && !rank.has(word)) rank.set(word, i);
  }
  return rank;
}

// Matches any valid Roman numeral (1-3999) spelled with standard
// subtractive notation, e.g. "xiv", "lxvi", "mmxi" — WordNet's indexes
// include these as valid "words" (they're indexed as numeral entries).
const ROMAN_NUMERAL_RE = /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

// 2-8 letters — no longer capped at 3-4: since the app now limits the
// combined *output* length via a slider instead of restricting each word's
// own length, the dictionary itself can hold a wider range of word lengths
// (more variety to draw shorter or longer combinations from), down to
// genuine 2-letter words ("ox", "id", "pi"). A real word always contains a
// vowel, so requiring one is a cheap filter for the rare unit-symbol-like
// WordNet entry (this also naturally excludes 2-letter non-words like
// abbreviations with no vowel). Also reject words that are just one letter
// repeated (e.g. "aa") and words that are entirely valid Roman numerals
// (e.g. "ix", "iv" — meaningful at 2 letters too now).
function isValidWord(word) {
  if (!/^[a-z]{2,8}$/.test(word)) return false;
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
  // found while reviewing the newly-allowed 2-letter words: crude slang
  // ("ho"), and a handful of lowercase-cased entries the casing filter
  // can't catch since they're not abbreviations or proper nouns in the
  // ALL-CAPS/Title-case sense — just obscure jargon (measurement units,
  // a chemistry term), foreign-alphabet letter names, or WordNet's
  // number-as-word entries ("ic" = 108, "il" = 49).
  "ho", "ic", "il", "yr", "eq", "at", "ar", "pe", "ki", "he",
  // found via a broad profanity/slur sweep against the built dictionary,
  // prompted by "shit" turning up in a live search sample. Same standard as
  // the entries above: dominant real-world usage is crude/vulgar/a slur, not
  // a word we're excluding just because it *also* has an edgy sense (e.g.
  // "cracker", "slave", "weed", "kill" stay in — their dominant usage is an
  // ordinary common word, unlike these).
  "shit", "shitty", "bastard", "whore", "bitch", "dick", "pussy", "prick",
  "douche", "tit", "ass", "asshole", "hooker",
  "fag", "faggot", "dyke", "retard", "coon", "chink", "kike", "squaw",
  "negro", "negress", "darkie", "darky", "honky", "wetback", "beaner",
  "orgasm", "climax", "erotica", "erotic", "nude", "nudity", "fetish",
  "bondage", "horny",
  "heroin", "cocaine",
  "rape", "rapist", "incest",
  "wanker", "tosser",
  "skank", "slag", "harlot", "strumpet", "wench", "hussy",
  // found via a review of real search output ("divorcedclap.com",
  // "savedsewer.com", "rentalamelia.com") — words that pass every check so
  // far (real dictionary words, pronounceable, phonetically natural) but
  // whose meaning is too heavy, clinical, or unpleasant to read as an
  // intentional brand name. Words kept despite a negative *sense* existing
  // (e.g. "killer", "poison", "insanity", "fever", "immortal", "phoenix",
  // "executed") have a genuinely common positive/neutral/slang everyday
  // use that outweighs it — these don't.
  "divorced", "divorce", "divorcee",
  "amelia", "cripple",
  "autopsy", "burial", "buried", "coffin", "coroner", "doomed", "tomb", "grief",
  "coma", "cough", "coughing", "flu", "hurting", "infected", "plague", "poorly", "seizure",
  "crap", "poop", "sewer",
  // found in the same live-output review: "homo" used bare as a noun
  // label is a slur, the same tier as the already-listed "fag"/"dyke";
  // "goddamn" is WordNet's own definition literally an expletive
  // ("used as expletives"), unlike "damn" which was kept as too
  // mainstream/multi-use to exclude.
  "homo", "goddamn",
  // found via an exhaustive read-through of every common MODIFIER word
  // (the prefix position, so the most visible to a reader) prompted by
  // "ill" slipping through as a modifier (sounds like "I'll" and its own
  // meaning is "sick" anyway) — the same circular-definition blind spot
  // that missed "divorced" applies here too, so this pass read definitions
  // directly rather than keyword-matching them.
  "sick", "crippled", "lunatic", "pathetic", "pitiful", "homeless", "sissy",
  "racist", "murdered", "hideous", "vile", "wretched", "tortured",
  // inflected forms of an already-listed root that slipped through as
  // separate dictionary entries (the denylist matches exact strings, not
  // stems) — found by checking every common suffix (-ed/-ing/-s/-y/-er)
  // against each existing entry above and reviewing the real hits (most
  // matches were unrelated words that just share letters, e.g. "spicy"/
  // "cocky"/"dinky"/"butter" — kept, not related to "spic"/"cock"/"dink"/
  // "butt" at all).
  "fucked", "fucker", "fucking", "pissed", "pisser", "pissing", "retarded",
  "skanky", "wencher",
  // found live in a search result right after the pass above ("funeral"),
  // same circular-definition blind spot again — its own gloss doesn't
  // contain the word "funeral". This one slipped through specifically
  // because it's a core (noun) word, not a modifier — the exhaustive
  // read-through above only covered modifiers; core words are a much
  // larger list not yet given the same treatment.
  "funeral",
  // WordNet's sense here is the archaic "odd/strange" meaning, not the
  // modern identity term — but a generated name would be read through the
  // modern meaning regardless of which WordNet sense produced it, so it's
  // excluded on that basis rather than as a judgment about the identity
  // term itself.
  "queer",
  // found via an exhaustive read-through of all ~3,400 common CORE (noun)
  // words — the modifier pass above didn't touch these. Two of these
  // ("nigga"/"nigger", "taco") are WordNet's OWN gloss literally labeling
  // them "(ethnic slur)... offensive" — a startling miss from the
  // original profanity sweep, which apparently never checked slur-labeled
  // entries this directly. "come" is a critical one too: an extremely
  // common everyday word whose selected WordNet sense is explicit sexual
  // content, not its ordinary meaning.
  "abortion", "asthma", "bugger", "bullshit", "cancer", "cemetery", "come",
  "condom", "corpse", "cruelty", "cuckoo", "curse", "death", "despair",
  "dickhead", "disease", "dope", "dump", "fart", "filth", "freak", "ghetto",
  "gypsy", "homicide", "hood", "idiot", "illness", "jackass", "junkie",
  "lust", "madman", "madness", "maniac", "massacre", "mistress", "moron",
  "morgue", "murder", "murderer", "nigga", "nigger", "oath", "opium",
  "penis", "pervert", "poison", "psycho", "puke", "screwing", "scum",
  "scumbag", "shitting", "shrimp", "slave", "slavery", "suicide", "taco",
  "thug", "torment", "torture", "tragedy", "trauma", "tumor", "vagina",
  "vomit", "wretch", "yakuza",
  // same "common string, obscure/mismatched real sense" bug as "re"/"am"
  // above, found via a full re-review of short common words prompted by
  // "mo" — each of these is almost certainly tagged common because of a
  // name (Ana, Ben, Deb, Lee, Raj, Tom) or a completely different common
  // word/meaning (van the vehicle, may the month/auxiliary verb, gal
  // informal for "girl", lay the common verb), not because of the
  // obscure sense WordNet actually selected and this app displays.
  "ana", "ben", "deb", "fin", "gal", "lay", "lee", "may", "mo", "raj",
  "tom", "van",
  // "boil" has a fine everyday sense ("boil water"), but the definition
  // this app actually selected and displays is the gross medical one
  // ("a painful sore with a hard core filled with pus") — the word's
  // other senses don't help if that's not what's shown.
  "boil",
  // A different lens from everything above: not offensive or heavy, just
  // actively bad as a brand descriptor — negative-quality, embarrassing,
  // or failure-associated words that would make a business look bad no
  // matter how "nice" they sound letter-by-letter (e.g. "uglybrand.com").
  // Found the same way as the rest: reading every common word's actual
  // definition directly, this time judged by "would this hurt a brand"
  // rather than "is this offensive/sensitive."
  "awful", "bad", "boring", "broke", "bum", "bust", "clumsy", "corrupt",
  "crappy", "creepy", "deaf", "dull", "dumb", "dummy", "harsh", "helpless",
  "ignorant", "lame", "lone", "lonely", "lousy", "numb", "petty", "punk",
  "rotten", "sloppy", "stinking", "stinky", "stupid", "ugly", "unstable",
  "vulgar", "worse",
  "reject", "rubbish", "scam", "scandal", "trash", "disaster", "failure",
  "fraud", "garbage", "junk", "loser", "mess",
  // found live in real search output right after this batch ("distress"),
  // plus a follow-up sweep for the same "reads badly as a brand
  // descriptor" pattern — "stress" and "fear" were checked and kept
  // (their shown definition is neutral/technical, and edgy-brand use
  // respectively).
  "distress", "weakness", "panic", "anxiety", "worry", "poor", "lacking",
  "bummer", "insecure", "vain",
  // "mum" here is the "keep mum" sense (failing to communicate when
  // expected to) rather than "mother" — an evasive, mildly negative trait
  // as a brand descriptor, not the affectionate word it looks like.
  "mum",
  // the original word that started the whole modifier review (reads as
  // "I'll" as a prefix, and its own meaning is "sick" anyway) — somehow
  // never actually added itself while "sick" (its parallel) was.
  "ill",
  // same crude-bodily-function tier as "crap"/"poop"/"fart"/"shitting"
  // above — missed the first time through.
  "pee",
  "urine", "sperm", "dung", "snot",
  // "re" (prompted by "tornre.com") revealed a systemic pattern: a short
  // word tagged "common" only because of a completely unrelated everyday
  // use (a name, an abbreviation, an auxiliary verb in running text —
  // "re" is common because "Re: Subject" is everywhere, not because
  // anyone uses the musical solfège sense), while the WordNet sense this
  // app actually selected and displays is obscure, meaningless jargon.
  // Same fix as "amelia" earlier: exclude the word itself, since the
  // string being common doesn't make ITS SHOWN SENSE any less junk.
  "re", "ain", "are", "am", "cos", "do", "fa", "la", "si", "so", "te",
  "gee", "ira", "kat", "mei", "meg", "min", "pat", "rip", "rue", "rum",
  "sec", "sol", "won", "yer",
  // "torn" itself (from the same "tornre.com" example) plus the rest of
  // the same "damaged/wrecked" family — negative-quality brand
  // descriptors, same tier as "broken"/"ruined" already excluded... except
  // those weren't actually excluded yet either.
  "torn", "broken", "ripped", "cracked", "wrecked", "ruined",
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
  // WordNet doesn't syntactic-mark these as predicate-only/postpositive
  // (see adjCasing.hasPrenominalSense above, which relies on that marker),
  // but real English only ever uses them that way regardless — "three
  // years ago", never "ago years"; "a frightened person", never "an
  // afraid person". Found via user reports, the same way "away" above
  // was presumably found originally.
  "ago", "afraid", "alive", "aloof",
  // A systematic pass over the rest of this same closed class (mostly
  // archaic "a-" = Old English "on-" formations) rather than adding them
  // one report at a time — English has a well-documented, finite set of
  // adjectives that only ever appear predicatively ("the room was abuzz",
  // never "an abuzz room"), and WordNet's own markers don't reliably
  // flag them (see "ago" above). "aware" is excluded too: it's genuinely
  // disputed among style guides whether modern usage has made it
  // acceptable attributively, and "only allow what we're sure about"
  // means a disputed case doesn't qualify either.
  "aware", "ablaze", "aflame", "agog", "askew", "atilt", "unwell", "loath",
  "abloom", "abuzz", "aslant",
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
// Returns the aggregate hasLowercaseSense map (does this lemma have ANY
// lowercase sense at all), per lemma exactly WHICH synset offsets used a
// lowercase form — needed later to pick a definition, since a word like
// "gore" has both a common-noun sense (lowercase, "an unpleasant
// application of violence") and a proper-noun sense (capitalized, the
// politician "Gore") and only the former should ever be shown as its
// definition, even though the word as a whole correctly counts as real —
// and (data.adj only) a hasPrenominalSense map: does this lemma have at
// least one adjective sense usable directly before a noun? data.adj tags
// some adjectives with a syntactic-position marker suffixed directly onto
// the word token: "(p)" predicate-only (usable only after a linking verb,
// e.g. "instinct" only in "words instinct with love", never "an instinct
// dog"), "(ip)" immediately-postnominal-only (e.g. "elect" only in
// "president elect", never "an elect president"), or "(a)"/no marker for
// attributive-capable (usable directly before a noun — exactly how this
// app uses a modifier). A lemma whose every sense is marked (p)/(ip) reads
// as ungrammatical or just odd jammed in front of a noun the way this app
// pairs modifier+core words, even though WordNet correctly calls it an
// adjective.
async function loadCasingMap(pos) {
  const raw = await readFile(path.join(WORDNET_DIR, `data.${pos}`), "utf8");
  const hasLowercaseSense = new Map();
  const lowercaseOffsets = new Map();
  const hasPrenominalSense = new Map();
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const parts = line.split(" ");
    const offset = parts[0];
    const wordCount = parseInt(parts[3], 16);
    if (!Number.isFinite(wordCount)) continue;
    for (let i = 0; i < wordCount; i++) {
      const token = parts[4 + i * 2];
      if (!token) continue;
      const marker = /\((a|p|ip)\)$/.exec(token)?.[1];
      const word = marker ? token.slice(0, -(marker.length + 2)) : token;
      const lemma = word.toLowerCase().replace(/_/g, "");
      const isLowercase = word === word.toLowerCase();
      hasLowercaseSense.set(lemma, isLowercase || (hasLowercaseSense.get(lemma) ?? false));
      if (isLowercase) {
        if (!lowercaseOffsets.has(lemma)) lowercaseOffsets.set(lemma, new Set());
        lowercaseOffsets.get(lemma).add(offset);
      }
      const prenominalOk = marker !== "p" && marker !== "ip";
      hasPrenominalSense.set(lemma, prenominalOk || (hasPrenominalSense.get(lemma) ?? false));
    }
  }
  return { hasLowercaseSense, lowercaseOffsets, hasPrenominalSense };
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
  console.log(`  -> ${english.size} words (2-8 letters)`);

  // "?? false", not "?? true": only allow a word we have positive evidence
  // is safe to use before a noun — a real adjective with no marker data at
  // all (verified: doesn't happen for any single-word lemma in practice,
  // only for multi-word phrases isValidWord already excludes) would
  // otherwise default to "assume it's fine", which is exactly backwards
  // for a strict allowlist.
  const englishModifiers = new Set(
    [...english].filter(
      (w) =>
        adjectives.has(w) &&
        !MODIFIER_STOPWORDS.has(w) &&
        (adjCasing.hasPrenominalSense.get(w) ?? false)
    )
  );
  console.log(`  -> ${englishModifiers.size} of ${english.size} words have an adjective sense (tagged as modifiers)`);

  console.log("Fetching English word-frequency list...");
  const frequencyRank = loadFrequencyRanks(await fetchText(FREQUENCY_LIST_URL));
  const englishCommon = new Set(
    [...english].filter((w) => (frequencyRank.get(w) ?? Infinity) < COMMON_WORD_RANK_CUTOFF)
  );
  console.log(`  -> ${englishCommon.size} of ${english.size} words are common (tagged for search priority)`);

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
        source:
          "Open English Wordnet 2025 (index.noun/adj + data.noun/adj, vendored in scripts/oewn-2025/) " +
          "+ hermitdave/FrequencyWords (English frequency ranking, fetched at build time)",
        english: [...english].sort(),
        // Subset of `english` that WordNet's index.adj lists as having an
        // adjective sense — used to bias candidate generation toward
        // modifier+noun pairs (see src/lib/modifiers.ts and candidates.ts)
        // instead of two arbitrary nouns jammed together.
        englishModifiers: [...englishModifiers].sort(),
        // Subset of `english` common enough (by usage frequency) to
        // prioritize in search — see src/lib/dictionary.ts/candidates.ts.
        // Not a hard filter: everything else in `english` is still
        // reachable, just tried second.
        englishCommon: [...englishCommon].sort(),
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
