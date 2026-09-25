// Single source of truth for the app's headline value-prop copy — was
// previously duplicated by hand across layout.tsx and manifest.ts (and
// had drifted slightly out of sync with opengraph-image.tsx's own version
// before this file existed). Anywhere that states what Namernut does in
// one sentence should import from here rather than hardcode its own
// copy, so a future wording change doesn't need a repo-wide grep to catch
// every place it was pasted.
export const APP_NAME = "Namernut";

export const TITLE = "Namernut – AI Business Name Generator + Availability Check";

// The exact framing requested directly (2026-09-25, reordered later the
// same day to lead with the pain point rather than the mechanism): the
// deeper explanation (dictionary pairing, RDAP/WHOIS, LLM scoring) still
// lives in README.md and llms.txt's longer explanations, which serve a
// different reader (someone already evaluating the tool, not deciding
// whether to click into it at all).
export const DESCRIPTION =
  "Never fall for a name that's already taken. AI business name generator that instantly checks domain, social & search availability.";
