import { describe, expect, it } from "vitest";
import { MAX_COMBINED_LENGTH, MIN_COMBINED_LENGTH, DEFAULT_COMBINED_LENGTH } from "./dictionary";
import { parseCount, SUPPORTED_TLDS } from "./candidates";
import {
  TLDS,
  MIN_COMBINED_LENGTH as CLIENT_MIN_COMBINED_LENGTH,
  MAX_COMBINED_LENGTH as CLIENT_MAX_COMBINED_LENGTH,
  DEFAULT_COMBINED_LENGTH as CLIENT_DEFAULT_COMBINED_LENGTH,
  DEFAULT_RESULT_COUNT,
} from "./searchConfig";

// src/lib/searchConfig.ts exists specifically to give the client bundle a
// dictionary-free copy of a handful of constants the real server-side
// modules (candidates.ts, dictionary.ts) already enforce — each one is a
// documented, hand-maintained duplicate, not a shared import (see
// searchConfig.ts's own top-of-file comment on why). Nothing catches these
// two copies drifting apart except a person noticing the "must stay in
// sync" comment and manually re-checking it — this file makes that
// invariant an actual, continuously-checked test instead of an honor
// system, the same way the sync between candidates.ts's SUPPORTED_TLDS and
// searchConfig.ts's TLDS is checked below rather than just asserted in a
// comment.
describe("searchConfig.ts stays in sync with the server-side constants it duplicates", () => {
  it("TLDS matches candidates.ts's SUPPORTED_TLDS exactly, in the same order", () => {
    expect(TLDS).toEqual(SUPPORTED_TLDS);
  });

  it("MIN/MAX/DEFAULT_COMBINED_LENGTH match dictionary.ts's own constants", () => {
    expect(CLIENT_MIN_COMBINED_LENGTH).toBe(MIN_COMBINED_LENGTH);
    expect(CLIENT_MAX_COMBINED_LENGTH).toBe(MAX_COMBINED_LENGTH);
    expect(CLIENT_DEFAULT_COMBINED_LENGTH).toBe(DEFAULT_COMBINED_LENGTH);
  });

  it("DEFAULT_RESULT_COUNT matches parseCount's own hardcoded clamp in candidates.ts", () => {
    // parseCount clamps to a literal 10 (see its own comment on why it
    // doesn't import DEFAULT_RESULT_COUNT itself) — asking for one more
    // than DEFAULT_RESULT_COUNT and getting exactly DEFAULT_RESULT_COUNT
    // back proves the two numbers still match, without hardcoding either
    // one a second time in this file.
    expect(parseCount(String(DEFAULT_RESULT_COUNT + 1))).toBe(DEFAULT_RESULT_COUNT);
  });
});
