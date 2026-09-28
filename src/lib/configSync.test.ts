import { describe, expect, it } from "vitest";
import { MAX_COMBINED_LENGTH, MIN_COMBINED_LENGTH, DEFAULT_COMBINED_LENGTH } from "./dictionary";
import { parseCount, SUPPORTED_TLDS } from "./candidates";
import { parseGates } from "./discovery";
import type { SocialStatus as ServerSocialStatus } from "./socialStatus";
import type { SocialStatus as ClientSocialStatus } from "./types";
import { DEFAULT_GATES } from "@/hooks/usePersistedAppState";
import {
  TLDS,
  MIN_COMBINED_LENGTH as CLIENT_MIN_COMBINED_LENGTH,
  MAX_COMBINED_LENGTH as CLIENT_MAX_COMBINED_LENGTH,
  DEFAULT_COMBINED_LENGTH as CLIENT_DEFAULT_COMBINED_LENGTH,
  DEFAULT_RESULT_COUNT,
} from "./searchConfig";

// Compile-time only: standard mutual-assignability trick to catch two
// independently-declared type aliases drifting apart (types.ts's own
// comment on SocialStatus explains why it's a hand-copied duplicate of
// socialStatus.ts's, not an import). If either gains/loses a member, this
// line stops typechecking — npx tsc --noEmit (part of this project's CI)
// catches it even though there's no runtime string to assert equal for a
// bare `type`.
type AssertSameType<A, B> = A extends B ? (B extends A ? true : never) : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _SocialStatusStaysInSync = AssertSameType<ServerSocialStatus, ClientSocialStatus>;

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

// usePersistedAppState.ts's DEFAULT_GATES (what a fresh install starts
// with) and discovery.ts's parseGates (what an empty request — no gate
// params at all — falls back to server-side) are two independently
// hand-written object literals that must produce the exact same values,
// per DEFAULT_GATES's own comment. Diverging would mean a fresh visitor's
// UI shows one set of gates as on/off while the very first search they run
// silently applies a different set until they touch a toggle.
describe("DEFAULT_GATES (usePersistedAppState.ts) stays in sync with parseGates's own defaults (discovery.ts)", () => {
  it("matches parseGates(new URLSearchParams()) — an empty request — exactly", () => {
    expect(DEFAULT_GATES).toEqual(parseGates(new URLSearchParams()));
  });
});
