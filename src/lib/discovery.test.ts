import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./rdap", () => ({ checkDomain: vi.fn() }));
vi.mock("./whois", () => ({ checkDomainWhois: vi.fn() }));
vi.mock("./instagram", () => ({ checkInstagramUsername: vi.fn() }));
vi.mock("./github", () => ({ checkGithubUsername: vi.fn() }));
vi.mock("./tiktok", () => ({ checkTiktokUsername: vi.fn() }));
// The real niceness index is built from the actual candidate pool passed
// in — these tests use tiny 2-3 word fixtures, far too little data for
// real bigram statistics, so almost every combined candidate would fail
// the niceness gate for reasons unrelated to what each test is actually
// checking. Default it to "always nice" here; the dedicated niceness test
// below overrides it to verify the gate itself.
vi.mock("./niceness", () => ({ buildNicenessIndex: vi.fn() }));

import { checkDomain } from "./rdap";
import { checkDomainWhois } from "./whois";
import { checkInstagramUsername } from "./instagram";
import { checkGithubUsername } from "./github";
import { checkTiktokUsername } from "./tiktok";
import { buildNicenessIndex } from "./niceness";
import { parseGates, runDiscovery, type DiscoveryEvent, type DiscoveryGates } from "./discovery";
import { isPronounceable } from "./pronounceable";
import type { WordEntry } from "./dictionary";

// The default for every test that isn't specifically exercising a gate
// toggle — matches runDiscovery's pre-gates behavior (everything on).
const ALL_GATES_ON: DiscoveryGates = {
  requireInstagram: true,
  requireGithub: true,
  requireTiktok: true,
  filterPronounceable: true,
  filterTypos: true,
  filterNiceness: true,
};

describe("runDiscovery", () => {
  // Every test drives checkDomain/checkDomainWhois explicitly, but most of
  // them don't care about the social checks specifically (that's covered
  // below) — default all three to "available" so a domain match still
  // counts as "found" the way it did before these gates existed (an
  // available domain where any required platform's handle is taken/unknown
  // no longer counts — see the dedicated tests below).
  beforeEach(() => {
    vi.mocked(checkInstagramUsername).mockResolvedValue("available");
    vi.mocked(checkGithubUsername).mockResolvedValue("available");
    vi.mocked(checkTiktokUsername).mockResolvedValue("available");
    vi.mocked(buildNicenessIndex).mockReturnValue({ score: () => 1 });
  });

  it("dedupes candidate names that collide via ambiguous word-boundary concatenation", async () => {
    // "ab" + "cde" and "abc" + "de" both concatenate to the identical
    // string "abcde" — a different underlying word pair landing on the
    // same candidate name. Without dedup this fires two "checking"/"found"
    // events for the same domain and produces a duplicate React key.
    const pool: WordEntry[] = [
      { word: "ab", langs: ["english"], definition: "", common: false, noun: true },
      { word: "cde", langs: ["english"], definition: "", common: false, noun: true },
      { word: "abc", langs: ["english"], definition: "", common: false, noun: true },
      { word: "de", langs: ["english"], definition: "", common: false, noun: true },
    ];

    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();

    // Large enough target that every non-colliding candidate in this tiny
    // 4x4 pool gets visited, so the collision would surface if not deduped.
    await runDiscovery(pool, undefined, ["com"], 100, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    const checkingNames = events.filter((e) => e.type === "checking").map((e) => e.name);

    expect(foundDomains.filter((d) => d === "abcde.com").length).toBe(1);
    expect(checkingNames.filter((n) => n === "abcde.com").length).toBe(1);

    // No candidate name (checking or found) appears more than once overall.
    expect(new Set(checkingNames).size).toBe(checkingNames.length);
    expect(new Set(foundDomains).size).toBe(foundDomains.length);
  });

  it("stops at exactly the target count and reports completion", async () => {
    // Every candidate resolves "available" near-instantly here, so several
    // concurrent workers race past the top-of-loop foundCount check before
    // any of them increments it. The synchronous re-check right before the
    // increment in the worker (no `await` in between) closes that race, so
    // this can assert exact equality rather than "around" the target.
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
      { word: "fox", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 2, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    const found = events.filter((e) => e.type === "found");
    const complete = events.find((e) => e.type === "complete");
    expect(found.length).toBe(2);
    expect(complete).toBeDefined();
    if (complete?.type === "complete") expect(complete.foundCount).toBe(2);
  });

  it("counts a result only when the domain and every required platform's handle are all available", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    vi.mocked(checkInstagramUsername).mockResolvedValue("available");
    vi.mocked(checkGithubUsername).mockResolvedValue("available");
    vi.mocked(checkTiktokUsername).mockResolvedValue("available");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 2, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(2);
    for (const f of found) {
      if (f.type === "found") {
        expect(f.instagram).toBe("available");
        expect(f.github).toBe("available");
        expect(f.tiktok).toBe("available");
      }
    }
  });

  it("filters out a domain match if even one required platform's handle is taken, with the rest available", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    vi.mocked(checkInstagramUsername).mockResolvedValue("available");
    vi.mocked(checkTiktokUsername).mockResolvedValue("available");
    // Only GitHub is taken — this must be enough to disqualify the
    // candidate on its own, not just when every platform agrees.
    vi.mocked(checkGithubUsername).mockResolvedValue("taken");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 4, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    expect(events.filter((e) => e.type === "found").length).toBe(0);
    expect(events.filter((e) => e.type === "filtered").length).toBeGreaterThan(0);
  });

  it("filters out (rather than counts) a domain match whose Instagram username is taken, checked once per name not per TLD", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    vi.mocked(checkInstagramUsername).mockResolvedValue("taken");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    // Two TLDs so a single name can match more than once, to verify the
    // Instagram lookup is cached rather than repeated per TLD/match.
    await runDiscovery(pool, undefined, ["com", "net"], 4, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    // Every domain match has its Instagram username taken, so none of them
    // qualify as a result — the whole 2x2 pool gets exhausted instead of
    // ever reaching the target of 4.
    expect(events.filter((e) => e.type === "found").length).toBe(0);
    expect(events.filter((e) => e.type === "filtered").length).toBeGreaterThan(0);
    const complete = events.find((e) => e.type === "complete");
    expect(complete).toBeDefined();
    if (complete?.type === "complete") expect(complete.foundCount).toBe(0);

    // 4 names (2x2 pool) x 2 TLDs = 8 possible domain matches, but every
    // name is only checked on Instagram once regardless of how many TLDs
    // match it.
    expect(vi.mocked(checkInstagramUsername).mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("stops requiring Instagram availability once checking it looks structurally blocked, rather than producing zero results forever", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
      { word: "fox", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    // Every Instagram check hits the same login-wall redirect — the real
    // symptom that prompted this: Instagram checking is completely broken,
    // not just occasionally wrong.
    const loginWallError = new Error("instagram_login_wall");
    loginWallError.name = "LoginWallError";
    vi.mocked(checkInstagramUsername).mockRejectedValue(loginWallError);

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 3, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    // Without the circuit breaker this would filter every match forever
    // and never reach the target — instead, after a handful of blocked
    // checks, results start counting again on domain availability alone.
    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(3);
    for (const f of found) {
      if (f.type === "found") expect(f.instagram).toBe("unknown");
    }

    // Told the user what happened, not just silently changed behavior.
    expect(
      events.some((e) => e.type === "error" && e.message.toLowerCase().includes("blocked"))
    ).toBe(true);
  });

  it("does not require (or even check) Instagram availability when requireInstagram is off", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    vi.mocked(checkInstagramUsername).mockResolvedValue("taken");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 2, (e) => events.push(e), controller.signal, 20, {
      ...ALL_GATES_ON,
      requireInstagram: false,
    });

    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(2);
    // Starts already "disabled" (same path the blocked-streak breaker
    // drops into at runtime) rather than checking and then ignoring the
    // result, so it's never called at all.
    expect(checkInstagramUsername).not.toHaveBeenCalled();
  });

  // GitHub and TikTok share the exact same gate/require/skip mechanism as
  // Instagram (see SOCIAL_PLATFORMS in discovery.ts) — parameterized here
  // rather than copy-pasting the two tests above a second and third time.
  // Neither has a "structurally blocked" circuit-breaker test of its own:
  // that failure mode is specific to Instagram's login-wall redirect (see
  // SocialPlatform.blockedErrorName) — GitHub's official API and TikTok's
  // scraping haven't shown an analogous distinct signal, so neither
  // platform's checker can ever return "blocked" at all.
  it.each([
    { label: "GitHub", gate: "requireGithub" as const, fn: checkGithubUsername },
    { label: "TikTok", gate: "requireTiktok" as const, fn: checkTiktokUsername },
  ])(
    "filters out (rather than counts) a domain match whose $label handle is taken, checked once per name not per TLD",
    async ({ fn }) => {
      const pool: WordEntry[] = [
        { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
        { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
      ];
      vi.mocked(checkDomain).mockResolvedValue("available");
      vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
      vi.mocked(fn).mockResolvedValue("taken");

      const events: DiscoveryEvent[] = [];
      const controller = new AbortController();
      await runDiscovery(pool, undefined, ["com", "net"], 4, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

      expect(events.filter((e) => e.type === "found").length).toBe(0);
      expect(events.filter((e) => e.type === "filtered").length).toBeGreaterThan(0);
      // 4 names (2x2 pool) x 2 TLDs = 8 possible domain matches, but every
      // name is only checked on this platform once regardless of how many
      // TLDs match it.
      expect(vi.mocked(fn).mock.calls.length).toBeLessThanOrEqual(4);
    }
  );

  it.each([
    { label: "GitHub", gate: "requireGithub" as const, fn: checkGithubUsername },
    { label: "TikTok", gate: "requireTiktok" as const, fn: checkTiktokUsername },
  ])("does not require (or even check) $label availability when its gate is off", async ({ gate, fn }) => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    vi.mocked(fn).mockResolvedValue("taken");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 2, (e) => events.push(e), controller.signal, 20, {
      ...ALL_GATES_ON,
      [gate]: false,
    });

    expect(events.filter((e) => e.type === "found").length).toBe(2);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects a candidate that isn't pronounceable", async () => {
    // "str"+"ngth" and every other combination in this pool has no vowels
    // at all, so none of them are pronounceable.
    const pool: WordEntry[] = [
      { word: "str", langs: ["english"], definition: "", common: false, noun: true },
      { word: "ngth", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 4, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    expect(events.filter((e) => e.type === "found").length).toBe(0);
    // Rejected before ever reaching a domain check, same as the niceness gate below.
    expect(events.filter((e) => e.type === "checking").length).toBe(0);
  });

  it("does not reject unpronounceable candidates when filterPronounceable is off", async () => {
    const pool: WordEntry[] = [
      { word: "str", langs: ["english"], definition: "", common: false, noun: true },
      { word: "ngth", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 4, (e) => events.push(e), controller.signal, 20, {
      ...ALL_GATES_ON,
      filterPronounceable: false,
    });

    expect(events.filter((e) => e.type === "found").length).toBeGreaterThan(0);
  });

  it("rejects a candidate outright when it doesn't score as a natural-sounding name", async () => {
    // Only "catdog" clears the (mocked) niceness bar; every other
    // combination in this 2x2 pool doesn't, so it should never be checked
    // (or found) at all, no matter how many are requested.
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(buildNicenessIndex).mockReturnValue({ score: (name) => (name === "catdog" ? 1 : 0) });
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 4, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(1);
    if (found[0].type === "found") expect(found[0].domain).toBe("catdog.com");

    // The rejected names never even get a "checking" event — no domain
    // check is wasted on a candidate this cheap local check already ruled
    // out, the same as isPronounceable.
    const checkingNames = events.filter((e) => e.type === "checking").map((e) => e.name);
    expect(checkingNames).toEqual(["catdog.com"]);
  });

  it("does not reject low-niceness candidates when filterNiceness is off", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(buildNicenessIndex).mockReturnValue({ score: (name) => (name === "catdog" ? 1 : 0) });
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 4, (e) => events.push(e), controller.signal, 20, {
      ...ALL_GATES_ON,
      filterNiceness: false,
    });

    // With the gate off, the low-scoring combinations aren't rejected
    // outright — all 4 pairings in this 2x2 pool reach a real check.
    expect(events.filter((e) => e.type === "found").length).toBe(4);
  });

  it("rejects a candidate that reads as a typo of a common word (no keyword)", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
      { word: "s", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 4, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    // "cats" and "scat" both read as a one-letter-off typo of "cat" and get
    // rejected outright; only "catcat" (not close to either "cat" or "s")
    // reaches a real check.
    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    expect(foundDomains).toEqual(["catcat.com"]);
  });

  it("does not reject typo-like candidates when filterTypos is off", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
      { word: "s", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 4, (e) => events.push(e), controller.signal, 20, {
      ...ALL_GATES_ON,
      filterTypos: false,
    });

    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    expect(foundDomains).toEqual(expect.arrayContaining(["cats.com", "scat.com"]));
  });

  it("with a keyword, doesn't reject a candidate for merely reading as a typo of the word it's paired with", async () => {
    // A one-letter keyword glued onto a word is, by construction, always
    // exactly one edit (an insertion) away from that same word — e.g. "c" +
    // "cat" = "ccat", one letter deleted away from "cat" itself. Without the
    // keyword-aware skip, the (real, unmocked) typo check would flag every
    // single candidate this way and the search would silently examine none
    // of them.
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, "c", ["com"], 1, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(1);
  });

  it("with a keyword, doesn't reject a candidate for a low niceness score", async () => {
    // The keyword's own letters (not the algorithm's) produced this bigram
    // — judging it the same way as a generated pairing would make a
    // keyword like "xx" reject every possible candidate, since no real
    // English word contains a doubled "x".
    vi.mocked(buildNicenessIndex).mockReturnValue({ score: () => 0 });
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, "xx", ["com"], 1, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(1);
  });

  it("emits 'stopped' instead of 'complete' when aborted", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("taken");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    controller.abort();
    await runDiscovery(pool, undefined, ["com"], 10, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    expect(events.some((e) => e.type === "stopped")).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(false);
  });

  it("widens the candidate space with AI-suggested synonym tiers and announces them via a 'synonyms' event", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(
      pool,
      "nova",
      ["com"],
      4,
      (e) => events.push(e),
      controller.signal,
      20,
      ALL_GATES_ON,
      ["blaze"]
    );

    // Fired first, before any real check, and carries exactly the synonyms
    // passed in.
    expect(events[0]).toEqual({ type: "synonyms", words: ["blaze"] });

    // The literal keyword ("nova") and the AI synonym ("blaze") both search
    // — the synonym tier is additive, not a replacement.
    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    expect(new Set(foundDomains)).toEqual(
      new Set(["novacat.com", "catnova.com", "blazecat.com", "catblaze.com"])
    );
  });

  it("claims candidates round-robin across sibling tiers, not sequentially, so more than one AI synonym's results actually surface", async () => {
    // Each of the 3 keyword-shaped tiers (the two AI synonyms plus the
    // literal keyword "nova") has 2 * 3 = 6 candidates of its own — a
    // target smaller than any single tier's own capacity. Sequential
    // tier-by-tier claiming (the pre-round-robin behavior) would pull every
    // result from whichever tier happened to be first and never touch the
    // other two at all.
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: true, noun: true },
      { word: "fox", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(
      pool,
      "nova",
      ["com"],
      6,
      (e) => events.push(e),
      controller.signal,
      20,
      ALL_GATES_ON,
      ["blaze", "flash"]
    );

    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(6);
    const sourceWords = new Set(
      found.flatMap((f) => (f.type === "found" ? f.parts.filter((p) => ["blaze", "flash", "nova"].includes(p)) : []))
    );
    // More than one of the 3 keyword-shaped tiers actually contributed a
    // result — proof this isn't draining one tier before touching the rest.
    expect(sourceWords.size).toBeGreaterThan(1);
  });

  it("does not emit a 'synonyms' event when there are no AI synonyms", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, "nova", ["com"], 2, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    expect(events.some((e) => e.type === "synonyms")).toBe(false);
  });

  it("searches AI-invented names as complete standalone candidates and announces them via an 'invented' event", async () => {
    // Empty pool -> the fallback dictionary-pairing tier has zero
    // candidates, isolating this run to the invented tier alone.
    const pool: WordEntry[] = [];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(
      pool,
      undefined,
      ["com"],
      2,
      (e) => events.push(e),
      controller.signal,
      20,
      ALL_GATES_ON,
      [],
      ["zuvio", "fovixia"]
    );

    expect(events[0]).toEqual({ type: "invented", words: ["zuvio", "fovixia"] });

    // Invented names reach a real check directly — no dictionary word ever
    // gets glued onto them, unlike every other candidate in this run.
    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    expect(new Set(foundDomains)).toEqual(new Set(["zuvio.com", "fovixia.com"]));
  });

  it("does not emit an 'invented' event when there are no AI-invented names", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 1, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    expect(events.some((e) => e.type === "invented")).toBe(false);
  });

  it("widens the candidate space with alternate-spelling tiers and announces them via an 'altSpellings' event", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(
      pool,
      "nova",
      ["com"],
      4,
      (e) => events.push(e),
      controller.signal,
      20,
      ALL_GATES_ON,
      [],
      [],
      ["novva"]
    );

    expect(events[0]).toEqual({ type: "altSpellings", words: ["novva"] });

    // The literal keyword ("nova") and its respelling ("novva") both
    // search — the alt-spelling tier is additive, not a replacement.
    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    expect(new Set(foundDomains)).toEqual(
      new Set(["novacat.com", "catnova.com", "novvacat.com", "catnovva.com"])
    );
  });

  it("exempts alt-spelling candidates from the pronounceable gate, even though the same combination would otherwise fail it", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    // Sanity check: "lyft"+"cat" genuinely fails isPronounceable — this
    // test only proves something if the exemption is actually doing work.
    expect(isPronounceable("lyftcat")).toBe(false);
    expect(isPronounceable("catlyft")).toBe(false);

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(
      pool,
      "lift",
      ["com"],
      // A single-word pool only has 2 possible candidates per tier
      // (keyword+word, word+keyword) — asking for all 4 across both tiers
      // (the literal "lift" tier and the alt-spelling "lyft" tier) forces
      // both to be fully drained, so the alt-spelling ones are guaranteed
      // to show up if (and only if) the exemption actually let them through.
      4,
      (e) => events.push(e),
      controller.signal,
      20,
      ALL_GATES_ON, // filterPronounceable: true
      [],
      [],
      ["lyft"]
    );

    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    expect(new Set(foundDomains)).toEqual(
      new Set(["lyftcat.com", "catlyft.com", "liftcat.com", "catlift.com"])
    );
  });

  it("still applies the pronounceable gate to the literal keyword tier when an alt-spelling tier is also present", async () => {
    // "lift"+"cat" is pronounceable on its own — this isolates the
    // exemption to alt-spelling candidates specifically, rather than the
    // whole run once any alt-spelling tier exists.
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
      // "grxpt" fails isPronounceable however it's paired, and isn't an
      // alt spelling of anything here — a control to prove the literal
      // keyword tier still gets gated normally.
      { word: "grxpt", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    expect(isPronounceable("liftgrxpt")).toBe(false);

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(
      pool,
      "lift",
      ["com"],
      10,
      (e) => events.push(e),
      controller.signal,
      20,
      ALL_GATES_ON,
      [],
      [],
      ["lyft"]
    );

    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    expect(foundDomains).not.toContain("liftgrxpt.com");
    expect(foundDomains).not.toContain("grxptlift.com");
  });

  it("does not emit an 'altSpellings' event when there are no alternate spellings", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, "nova", ["com"], 2, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    expect(events.some((e) => e.type === "altSpellings")).toBe(false);
  });
});

describe("parseGates", () => {
  it("defaults every gate on for an empty/missing query string", () => {
    expect(parseGates(new URLSearchParams(""))).toEqual(ALL_GATES_ON);
  });

  it("turns a gate off only when its param is exactly the string 'false'", () => {
    expect(parseGates(new URLSearchParams("requireInstagram=false"))).toEqual({
      ...ALL_GATES_ON,
      requireInstagram: false,
    });
    expect(parseGates(new URLSearchParams("requireGithub=false&requireTiktok=false"))).toEqual({
      ...ALL_GATES_ON,
      requireGithub: false,
      requireTiktok: false,
    });
    expect(parseGates(new URLSearchParams("filterPronounceable=false&filterTypos=false"))).toEqual({
      ...ALL_GATES_ON,
      filterPronounceable: false,
      filterTypos: false,
    });
  });

  it("fails safe (on) for a malformed value rather than silently disabling the gate", () => {
    expect(parseGates(new URLSearchParams("filterNiceness=nope"))).toEqual(ALL_GATES_ON);
  });
});
