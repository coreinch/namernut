import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./rdap", () => ({ checkDomain: vi.fn() }));
vi.mock("./whois", () => ({ checkDomainWhois: vi.fn() }));
vi.mock("./instagram", () => ({ checkInstagramUsername: vi.fn() }));
vi.mock("./github", () => ({ checkGithubUsername: vi.fn() }));
vi.mock("./tiktok", () => ({ checkTiktokUsername: vi.fn() }));
vi.mock("./npm", () => ({ checkNpmPackageName: vi.fn() }));
vi.mock("./youtube", () => ({ checkYoutubeHandle: vi.fn() }));
vi.mock("./twitter", () => ({ checkTwitterHandle: vi.fn() }));
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
import { checkNpmPackageName } from "./npm";
import { checkYoutubeHandle } from "./youtube";
import { checkTwitterHandle } from "./twitter";
import { buildNicenessIndex } from "./niceness";
import { clearAvailabilityCaches } from "./discoveryChecks";
import { parseGates, runDiscovery, type DiscoveryEvent, type DiscoveryGates } from "./discovery";
import { isPronounceable } from "./pronounceable";
import type { WordEntry } from "./dictionary";

// The default for every test that isn't specifically exercising a gate
// toggle — matches runDiscovery's pre-gates behavior (everything on).
const ALL_GATES_ON: DiscoveryGates = {
  requireInstagram: true,
  requireGithub: true,
  requireTiktok: true,
  requireNpm: true,
  requireYoutube: true,
  requireTwitter: true,
  filterPronounceable: true,
  filterTypos: true,
  filterNiceness: true,
};

describe("runDiscovery", () => {
  // Every test drives checkDomain/checkDomainWhois explicitly, but most of
  // them don't care about the social checks specifically (that's covered
  // below) — default all six to "available" so a domain match still
  // counts as "found" the way it did before these gates existed (an
  // available domain where any required platform's handle is taken/unknown
  // no longer counts — see the dedicated tests below).
  beforeEach(() => {
    clearAvailabilityCaches();
    vi.mocked(checkInstagramUsername).mockResolvedValue("available");
    vi.mocked(checkGithubUsername).mockResolvedValue("available");
    vi.mocked(checkTiktokUsername).mockResolvedValue("available");
    vi.mocked(checkNpmPackageName).mockResolvedValue("available");
    vi.mocked(checkYoutubeHandle).mockResolvedValue("available");
    vi.mocked(checkTwitterHandle).mockResolvedValue("available");
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

  it("answers a repeat domain/social lookup from cache instead of re-checking", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    const run = () =>
      runDiscovery(pool, undefined, ["com"], 100, () => {}, new AbortController().signal, 20, ALL_GATES_ON);

    await run();
    const domainCalls = vi.mocked(checkDomain).mock.calls.length;
    const npmCalls = vi.mocked(checkNpmPackageName).mock.calls.length;
    expect(domainCalls).toBeGreaterThan(0);

    await run();
    expect(vi.mocked(checkDomain).mock.calls.length).toBe(domainCalls);
    expect(vi.mocked(checkNpmPackageName).mock.calls.length).toBe(npmCalls);
  });

  it("does not cache an inconclusive domain result", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("unknown");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    const run = () =>
      runDiscovery(pool, undefined, ["com"], 100, () => {}, new AbortController().signal, 20, ALL_GATES_ON);
    await run();
    const first = vi.mocked(checkDomain).mock.calls.length;
    await run();
    expect(vi.mocked(checkDomain).mock.calls.length).toBe(first * 2);
  });

  it("reports why candidates were filtered on the complete event", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    vi.mocked(checkNpmPackageName).mockResolvedValue("taken");

    const events: DiscoveryEvent[] = [];
    await runDiscovery(pool, undefined, ["com"], 100, (e) => events.push(e), new AbortController().signal, 4, ALL_GATES_ON);
    const complete = events.find((e) => e.type === "complete");
    if (complete?.type !== "complete") throw new Error("no complete event");
    // Six-letter pairs exceed maxLength 4; the rest fail on npm.
    expect(complete.filterCounts.tooLong).toBeGreaterThan(0);
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

  it("falls back to whois immediately (no delay) when RDAP rate-limits once but whois resolves", async () => {
    // Distinct from the exhausted-retries case below: whois answering
    // conclusively on the first attempt breaks out of checkOne's retry loop
    // right away — no backoff delay, and no second (unconditional) whois
    // call after the loop, since status is no longer "unknown" by then.
    const pool: WordEntry[] = [{ word: "cat", langs: ["english"], definition: "", common: false, noun: true }];
    const rateLimitError = new Error("rdap_rate_limited");
    rateLimitError.name = "RateLimitError";
    vi.mocked(checkDomain).mockRejectedValueOnce(rateLimitError);
    vi.mocked(checkDomainWhois).mockResolvedValueOnce("available");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 1, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    expect(events.some((e) => e.type === "error" && e.message.includes("RDAP rate limited, falling back to whois"))).toBe(true);
    expect(events.filter((e) => e.type === "found").length).toBe(1);
    expect(vi.mocked(checkDomain).mock.calls.length).toBe(1);
    expect(vi.mocked(checkDomainWhois).mock.calls.length).toBe(1);
  });

  it("gives up after repeated RDAP rate limits and inconclusive whois, reporting the domain as unknown", async () => {
    // Every RateLimitError retry calls whois inline (checkOne line ~148),
    // and once the retry cap is hit there's still one more *unconditional*
    // whois call after the loop (checkOne line ~176, shared with the
    // generic-error path) — so with whois never resolving, 3 loop-internal
    // calls plus 1 trailing call is the correct total, not 3.
    vi.useFakeTimers();
    try {
      const pool: WordEntry[] = [{ word: "cat", langs: ["english"], definition: "", common: false, noun: true }];
      const rateLimitError = new Error("rdap_rate_limited");
      rateLimitError.name = "RateLimitError";
      vi.mocked(checkDomain).mockRejectedValue(rateLimitError);
      vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

      const events: DiscoveryEvent[] = [];
      const controller = new AbortController();
      const promise = runDiscovery(pool, undefined, ["com"], 1, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);
      await vi.runAllTimersAsync();
      await promise;

      // An inconclusive domain check is its own event type, not "filtered"
      // (which is reserved for a domain that's actually available but a
      // required social handle isn't) and not "found".
      expect(events.some((e) => e.type === "unknown" && e.name === "catcat.com")).toBe(true);
      expect(events.filter((e) => e.type === "found").length).toBe(0);
      expect(vi.mocked(checkDomain).mock.calls.length).toBe(3);
      expect(vi.mocked(checkDomainWhois).mock.calls.length).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a generic RDAP error after a flat delay, and succeeds on the retry", async () => {
    // A non-RateLimitError, non-blocked error takes the flat 1000ms retry
    // path (no whois fallback attempted inline) rather than RateLimitError's
    // 5000ms-backoff-plus-whois path — this is the success-on-retry case;
    // the exhaustion shape of this same path is already implicitly covered
    // by the RateLimitError-exhaustion test above sharing the post-loop
    // whois fallback.
    vi.useFakeTimers();
    try {
      const pool: WordEntry[] = [{ word: "cat", langs: ["english"], definition: "", common: false, noun: true }];
      vi.mocked(checkDomain).mockRejectedValueOnce(new Error("rdap_network_error")).mockResolvedValue("available");

      const events: DiscoveryEvent[] = [];
      const controller = new AbortController();
      const promise = runDiscovery(pool, undefined, ["com"], 1, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);
      await vi.runAllTimersAsync();
      await promise;

      expect(events.filter((e) => e.type === "found").length).toBe(1);
      expect(vi.mocked(checkDomain).mock.calls.length).toBe(2);
      expect(vi.mocked(checkDomainWhois).mock.calls.length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
        expect(f.npm).toBe("available");
        expect(f.youtube).toBe("available");
        expect(f.twitter).toBe("available");
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

  it("does not filter a name out just because Instagram redirected to its login wall", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
      { word: "fox", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    const loginWallError = new Error("instagram_login_wall");
    loginWallError.name = "LoginWallError";
    vi.mocked(checkInstagramUsername).mockRejectedValue(loginWallError);

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 3, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);

    // An inconclusive (blocked) Instagram check is not "unavailable": no
    // name may be filtered on its account, even before the breaker trips.
    expect(events.filter((e) => e.type === "filtered").length).toBe(0);
    expect(events.filter((e) => e.type === "found").length).toBe(3);
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

  it("stops requiring GitHub availability once its rate limit persists past the retry cap, rather than producing zero results forever", async () => {
    // GitHub's real limit is hourly (see github.ts) — a few seconds of
    // backoff can't outlast that, so a rate limit that never clears within
    // this retry cap needs the same breaker as a structural block (the test
    // above), not an "unknown" that fails every remaining candidate with no
    // recovery. Fake timers stand in for the real RATE_LIMIT_BACKOFF_MS waits.
    vi.useFakeTimers();
    try {
      const pool: WordEntry[] = [
        { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
        { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
        { word: "fox", langs: ["english"], definition: "", common: false, noun: true },
      ];
      vi.mocked(checkDomain).mockResolvedValue("available");
      vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
      const rateLimitError = new Error("github_rate_limited");
      rateLimitError.name = "RateLimitError";
      vi.mocked(checkGithubUsername).mockRejectedValue(rateLimitError);

      const events: DiscoveryEvent[] = [];
      const controller = new AbortController();
      const promise = runDiscovery(pool, undefined, ["com"], 3, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);
      await vi.runAllTimersAsync();
      await promise;

      // Without the breaker this would filter every match forever and never
      // reach the target — instead, after a handful of exhausted-retry
      // checks, results start counting again on domain availability alone.
      const found = events.filter((e) => e.type === "found");
      expect(found.length).toBe(3);
      for (const f of found) {
        if (f.type === "found") expect(f.github).toBe("unknown");
      }

      // Told the user what happened, not just silently changed behavior.
      expect(
        events.some((e) => e.type === "error" && e.message.toLowerCase().includes("github checking appears to be blocked"))
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { label: "npm", mock: checkNpmPackageName, errorName: "npm_rate_limited", gate: "requireNpm", foundKey: "npm" },
    {
      label: "TikTok",
      mock: checkTiktokUsername,
      errorName: "tiktok_rate_limited",
      gate: "requireTiktok",
      foundKey: "tiktok",
    },
    {
      label: "YouTube",
      mock: checkYoutubeHandle,
      errorName: "youtube_rate_limited",
      gate: "requireYoutube",
      foundKey: "youtube",
    },
    {
      label: "X",
      mock: checkTwitterHandle,
      errorName: "twitter_rate_limited",
      gate: "requireTwitter",
      foundKey: "twitter",
    },
  ] as const)(
    "stops requiring $label availability once its rate limit persists past the retry cap, same as GitHub",
    async ({ label, mock, errorName, foundKey }) => {
      // Same breaker, same code path (checkSocialOne), different platform —
      // this locks in that the GitHub-specific test above isn't the only
      // one of EAGER_PLATFORMS actually covered by
      // SOCIAL_BLOCKED_STREAK_THRESHOLD. All five throw the identical
      // RateLimitError shape on a 429 (see EAGER_PLATFORMS in discovery.ts),
      // so exhausting retries here should trip the same breaker GitHub's
      // test exercises, not fail every remaining candidate forever.
      vi.useFakeTimers();
      try {
        const pool: WordEntry[] = [
          { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
          { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
          { word: "fox", langs: ["english"], definition: "", common: false, noun: true },
        ];
        vi.mocked(checkDomain).mockResolvedValue("available");
        vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
        const rateLimitError = new Error(errorName);
        rateLimitError.name = "RateLimitError";
        vi.mocked(mock).mockRejectedValue(rateLimitError);

        const events: DiscoveryEvent[] = [];
        const controller = new AbortController();
        const promise = runDiscovery(pool, undefined, ["com"], 3, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);
        await vi.runAllTimersAsync();
        await promise;

        const found = events.filter((e) => e.type === "found");
        expect(found.length).toBe(3);
        for (const f of found) {
          if (f.type === "found") expect(f[foundKey]).toBe("unknown");
        }

        expect(
          events.some(
            (e) => e.type === "error" && e.message.toLowerCase().includes(`${label.toLowerCase()} checking appears to be blocked`)
          )
        ).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it("retries a rate-limited social check after backing off, and the candidate still resolves", async () => {
    // Distinct from the LoginWallError breaker above: a rate limit is
    // transient (retry the same request after a delay), not structural
    // (drop the requirement) — see checkSocialOne's two separate branches
    // in discovery.ts. Real timers would make this test wait out the actual
    // 5s RATE_LIMIT_BACKOFF_MS, so fake timers stand in for it.
    vi.useFakeTimers();
    try {
      // A single-word pool pairs only with itself ("catcat") — exactly one
      // candidate, so there's no concurrency ambiguity over which of
      // several in-flight candidates consumes the one-time rejection below.
      const pool: WordEntry[] = [{ word: "cat", langs: ["english"], definition: "", common: false, noun: true }];
      vi.mocked(checkDomain).mockResolvedValue("available");
      vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

      const rateLimitError = new Error("instagram_rate_limited");
      rateLimitError.name = "RateLimitError";
      vi.mocked(checkInstagramUsername).mockRejectedValueOnce(rateLimitError).mockResolvedValue("available");

      const events: DiscoveryEvent[] = [];
      const controller = new AbortController();
      const promise = runDiscovery(pool, undefined, ["com"], 1, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);
      await vi.runAllTimersAsync();
      await promise;

      // Told the user it was backing off, not just silently retrying.
      expect(
        events.some((e) => e.type === "error" && e.message.includes("Instagram rate limited, backing off"))
      ).toBe(true);

      // The retry succeeded — this is not the structurally-blocked path, so
      // the candidate still counts once Instagram comes back "available".
      const found = events.filter((e) => e.type === "found");
      expect(found.length).toBe(1);
      if (found[0].type === "found") expect(found[0].instagram).toBe("available");
      expect(vi.mocked(checkInstagramUsername).mock.calls.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a social check as 'unknown' (not 'blocked') after repeated non-rate-limit errors", async () => {
    // A generic error (no blockedErrorName match, not a RateLimitError)
    // retries with the flat 1000ms delay and then settles as "unknown" —
    // it never trips the structural-block breaker, since only
    // blockedErrorName does that (see checkSocialOne in discovery.ts).
    vi.useFakeTimers();
    try {
      // Single-word pool, same reasoning as the rate-limit test above: one
      // deterministic candidate, so the retry count below is exact.
      const pool: WordEntry[] = [{ word: "cat", langs: ["english"], definition: "", common: false, noun: true }];
      vi.mocked(checkDomain).mockResolvedValue("available");
      vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
      vi.mocked(checkInstagramUsername).mockRejectedValue(new Error("instagram_network_error"));

      const events: DiscoveryEvent[] = [];
      const controller = new AbortController();
      // Target 5 is unreachable (the pool has exactly one candidate,
      // "catcat", and it never qualifies — see below) — this just lets
      // runDiscovery run the pool to exhaustion rather than stopping after
      // one result, since "unknown" doesn't count as found for a required
      // platform.
      const promise = runDiscovery(pool, undefined, ["com"], 5, (e) => events.push(e), controller.signal, 20, ALL_GATES_ON);
      await vi.runAllTimersAsync();
      await promise;

      // "unknown" is not "available" — Instagram is still required (the
      // gate never tripped, see below), so the domain match is filtered
      // rather than counted, distinct from the breaker case where the
      // requirement itself gets dropped.
      expect(events.filter((e) => e.type === "found").length).toBe(0);
      expect(events.some((e) => e.type === "filtered" && e.name === "catcat.com")).toBe(true);

      // Retried up to the cap, then gave up on this one check — not the
      // "checking appears to be blocked" breaker message, and the gate
      // stays on for any further candidates.
      expect(events.some((e) => e.type === "error" && e.message.toLowerCase().includes("blocked"))).toBe(false);
      expect(vi.mocked(checkInstagramUsername).mock.calls.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
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

  // GitHub, TikTok, npm, YouTube, and X share the exact same gate/require/
  // skip mechanism as Instagram (see EAGER_PLATFORMS/DEFERRED_PLATFORMS in
  // discovery.ts) — parameterized here rather than copy-pasting the two
  // tests above a second, third, fourth, and fifth time.
  // Neither has a "structurally blocked" circuit-breaker test of its own:
  // that failure mode is specific to Instagram's login-wall redirect (see
  // SocialPlatform.blockedErrorName) — GitHub's official API and TikTok's
  // scraping haven't shown an analogous distinct signal, so neither
  // platform's checker can ever return "blocked" at all.
  it.each([
    { label: "GitHub", gate: "requireGithub" as const, fn: checkGithubUsername },
    { label: "TikTok", gate: "requireTiktok" as const, fn: checkTiktokUsername },
    { label: "npm", gate: "requireNpm" as const, fn: checkNpmPackageName },
    { label: "YouTube", gate: "requireYoutube" as const, fn: checkYoutubeHandle },
    { label: "X", gate: "requireTwitter" as const, fn: checkTwitterHandle },
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
    { label: "npm", gate: "requireNpm" as const, fn: checkNpmPackageName },
    { label: "YouTube", gate: "requireYoutube" as const, fn: checkYoutubeHandle },
    { label: "X", gate: "requireTwitter" as const, fn: checkTwitterHandle },
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
      new Set(["novacat.com", "blazecat.com"])
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
      new Set(["novacat.com", "novvacat.com"])
    );
  });

  it("exempts alt-spelling candidates from the pronounceable gate, even though the same combination would otherwise fail it", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: true, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    // Sanity check: "lft"+"cat" genuinely fails isPronounceable — this
    // test only proves something if the exemption is actually doing work.
    // (Not "lyft": isPronounceable treats a "y" flanked by two consonants
    // as a vowel — see isVowelAt in pronounceable.ts — which shortens
    // "lyft"'s effective consonant run enough that "lyftcat"/"catlyft"
    // pass the gate on their own, defeating the point of this sanity
    // check. "lft" has no such semivowel to rescue it.)
    expect(isPronounceable("lftcat")).toBe(false);

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(
      pool,
      "lift",
      ["com"],
      // A single-word pool only has 2 possible candidates per tier
      // (keyword+word, word+keyword) — asking for all 4 across both tiers
      // (the literal "lift" tier and the alt-spelling "lft" tier) forces
      // both to be fully drained, so the alt-spelling ones are guaranteed
      // to show up if (and only if) the exemption actually let them through.
      4,
      (e) => events.push(e),
      controller.signal,
      20,
      ALL_GATES_ON, // filterPronounceable: true
      [],
      [],
      ["lft"]
    );

    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    expect(new Set(foundDomains)).toEqual(
      new Set(["lftcat.com", "liftcat.com"])
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

// parseGates's actual default when no query params are present at all —
// distinct from ALL_GATES_ON above. requireGithub defaults off: GitHub is
// the only platform actually confirmed to hit a real rate limit in
// practice, by a 100-request-in-a-row test (see DEFERRED_PLATFORMS in
// discovery.ts) that came back clean for every other platform — so
// requiring GitHub out of the box would rate-limit most searches before
// they produce any results, while the rest of the gates keep the original
// on-by-default behavior, same as every quality filter.
const DEFAULT_QUERY_GATES: DiscoveryGates = {
  ...ALL_GATES_ON,
  requireInstagram: false,
  requireGithub: false,
};

describe("parseGates", () => {
  it("defaults every gate on for an empty/missing query string, except requireGithub and requireInstagram", () => {
    expect(parseGates(new URLSearchParams(""))).toEqual(DEFAULT_QUERY_GATES);
  });

  it("turns an on-by-default gate off only when its param is exactly the string 'false'", () => {
    expect(
      parseGates(
        new URLSearchParams("requireTiktok=false&requireNpm=false&requireYoutube=false&requireTwitter=false")
      )
    ).toEqual({
      ...DEFAULT_QUERY_GATES,
      requireTiktok: false,
      requireNpm: false,
      requireYoutube: false,
      requireTwitter: false,
    });
    expect(parseGates(new URLSearchParams("filterPronounceable=false&filterTypos=false"))).toEqual({
      ...DEFAULT_QUERY_GATES,
      filterPronounceable: false,
      filterTypos: false,
    });
  });

  it("turns the off-by-default requireGithub gate on only when its param is exactly the string 'true'", () => {
    expect(parseGates(new URLSearchParams("requireGithub=true"))).toEqual({
      ...DEFAULT_QUERY_GATES,
      requireGithub: true,
    });
    // Anything other than the literal string "true" fails safe (stays off).
    expect(parseGates(new URLSearchParams("requireGithub=1"))).toEqual(DEFAULT_QUERY_GATES);
  });

  it("fails safe (on) for a malformed value on an on-by-default gate rather than silently disabling it", () => {
    expect(parseGates(new URLSearchParams("filterNiceness=nope"))).toEqual(DEFAULT_QUERY_GATES);
  });
});
