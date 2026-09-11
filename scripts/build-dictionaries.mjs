#!/usr/bin/env node
// Downloads the source word lists and filters each down to plain 3-4 letter
// words, writing the result to src/data/dictionaries.json. Re-run this
// script any time to refresh the bundled word lists; the app itself never
// hits these URLs at runtime.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "src", "data", "dictionaries.json");

const SOURCES = {
  // dwyl/english-words: largest freely available plain English word list (~370k words).
  english:
    "https://raw.githubusercontent.com/dwyl/english-words/master/words_dictionary.json",
  // titoBouzout/Dictionaries: Hunspell Latin lexicon (~129k stems), the
  // largest plain-text Latin word list readily available.
  latin:
    "https://raw.githubusercontent.com/titoBouzout/Dictionaries/master/la.dic",
  // hermitdave/FrequencyWords: Esperanto word frequency list derived from
  // OpenSubtitles (~36k unique words), the largest plain Esperanto list found.
  esperanto:
    "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/eo/eo_full.txt",
  // titoBouzout/Dictionaries again (same repo as Latin): Hunspell French
  // and Spanish lexicons. Tried the FrequencyWords/OpenSubtitles corpus
  // approach first (like Esperanto), but even frequency-capped it was
  // dominated by subtitle character names (carl, kent, suzy, mack...) —
  // a curated spell-check dictionary doesn't have that problem.
  french: "https://raw.githubusercontent.com/titoBouzout/Dictionaries/master/French.dic",
  spanish: "https://raw.githubusercontent.com/titoBouzout/Dictionaries/master/Spanish.dic",
};

const ESPERANTO_TRANSLITERATION = {
  ĉ: "c",
  ĝ: "g",
  ĥ: "h",
  ĵ: "j",
  ŝ: "s",
  ŭ: "u",
};

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "domain-finder-dictionary-builder" },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

// Matches any valid Roman numeral (1-3999) spelled with standard
// subtractive notation, e.g. "xiv", "lxvi", "mmxi".
const ROMAN_NUMERAL_RE =
  /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

// Raw source lists mix in abbreviations, unit symbols, and Roman-numeral
// fragments (e.g. "ccw", "twp", "bldg", "lxv", "xiv") alongside real words.
// A real word in each of these languages always contains a vowel, so
// requiring one is a cheap, effective filter for that category of junk. We
// also reject words that are just one letter repeated (e.g. "sss", "mmmm"),
// another common abbreviation/interjection pattern in these source lists,
// and words that are entirely valid Roman numerals.
function isValidWord(word, vowels) {
  if (!/^[a-z]{3,4}$/.test(word)) return false;
  if (!new RegExp(`[${vowels}]`).test(word)) return false;
  if (/^(.)\1*$/.test(word)) return false;
  if (ROMAN_NUMERAL_RE.test(word)) return false;
  return true;
}

function parseEnglish(raw) {
  const dict = JSON.parse(raw);
  const words = new Set();
  for (const key of Object.keys(dict)) {
    const w = key.toLowerCase();
    if (isValidWord(w, "aeiouy")) words.add(w);
  }
  return words;
}

function parseLatin(raw) {
  const words = new Set();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const word = trimmed.split("/")[0].toLowerCase();
    if (isValidWord(word, "aeiouy")) words.add(word);
  }
  return words;
}

function parseEsperanto(raw) {
  const words = new Set();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let token = trimmed.split(/\s+/)[0].toLowerCase();

    // The corpus mixes actual Unicode diacritics with the plain-ASCII
    // "x-system" convention (ĉ=cx, ĝ=gx, ĥ=hx, ĵ=jx, ŝ=sx, ŭ=ux). Collapse
    // the digraphs to the same base letter our Unicode map below produces,
    // e.g. "cxi" (ĉi) -> "ci", consistent with how ĉi itself would resolve.
    token = token.replace(/([cghjsu])x/g, "$1");

    const transliterated = [...token]
      .map((ch) => ESPERANTO_TRANSLITERATION[ch] ?? ch)
      .join("");

    // The Esperanto alphabet has no q, w, x, or y at all. Since the source
    // corpus is subtitle text, entries containing any of them are foreign
    // words or names that leaked in (e.g. "away", "wolf", "lucy", "york"),
    // not real Esperanto — and 'x' specifically is also what's left over
    // after collapsing the digraphs above (e.g. "marx", "alex", "rex").
    if (/[qwxy]/.test(transliterated)) continue;

    if (isValidWord(transliterated, "aeiou")) words.add(transliterated);
  }
  return words;
}

// Standard Latin-script accent stripping via Unicode NFD decomposition
// (é -> e + combining acute -> "e"), plus the two ligatures that don't
// decompose that way. Good enough for French/Spanish; Esperanto needs its
// own handling above because ĉ/ĝ/ĥ/ĵ/ŝ/ŭ carry an x-system ASCII spelling
// in that corpus that this wouldn't catch.
function stripDiacritics(word) {
  return word
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Same Hunspell .dic format as Latin (word/FLAGS, one per line, an initial
// count-only header line), plus accent stripping for the accented Latin
// scripts (French, Spanish) that Latin itself doesn't need.
function parseHunspellDic(raw, vowels) {
  const words = new Set();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const word = stripDiacritics(trimmed.split(/\s+/)[0].split("/")[0].toLowerCase());
    if (isValidWord(word, vowels)) words.add(word);
  }
  return words;
}

async function main() {
  console.log("Fetching English word list...");
  const english = parseEnglish(await fetchText(SOURCES.english));
  console.log(`  -> ${english.size} words (3-4 letters)`);

  console.log("Fetching Latin word list...");
  const latin = parseLatin(await fetchText(SOURCES.latin));
  console.log(`  -> ${latin.size} words (3-4 letters)`);

  console.log("Fetching Esperanto word list...");
  const esperanto = parseEsperanto(await fetchText(SOURCES.esperanto));
  console.log(`  -> ${esperanto.size} words (3-4 letters)`);

  console.log("Fetching French word list...");
  const french = parseHunspellDic(await fetchText(SOURCES.french), "aeiouy");
  console.log(`  -> ${french.size} words (3-4 letters)`);

  console.log("Fetching Spanish word list...");
  const spanish = parseHunspellDic(await fetchText(SOURCES.spanish), "aeiou");
  console.log(`  -> ${spanish.size} words (3-4 letters)`);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: SOURCES,
        english: [...english].sort(),
        latin: [...latin].sort(),
        esperanto: [...esperanto].sort(),
        french: [...french].sort(),
        spanish: [...spanish].sort(),
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
