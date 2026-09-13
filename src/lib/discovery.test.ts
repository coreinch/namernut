import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./rdap", () => ({ checkDomain: vi.fn() }));
vi.mock("./whois", () => ({ checkDomainWhois: vi.fn() }));
vi.mock("./instagram", () => ({ checkInstagramUsername: vi.fn() }));
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
import { buildNicenessIndex } from "./niceness";
import { runDiscovery, type DiscoveryEvent } from "./discovery";
import type { WordEntry } from "./dictionary";

describe("runDiscovery", () => {
  // Every test drives checkDomain/checkDomainWhois explicitly, but most of
  // them don't care about Instagram specifically (that's covered below) —
  // default it to "available" so a domain match still counts as "found"
  // the way it did before the Instagram gate existed (an available domain
  // whose Instagram username is taken/unknown no longer counts — see the
  // dedicated tests below).
  beforeEach(() => {
    vi.mocked(checkInstagramUsername).mockResolvedValue("available");
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
    await runDiscovery(pool, undefined, ["com"], 100, (e) => events.push(e), controller.signal, 20);

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
    await runDiscovery(pool, undefined, ["com"], 2, (e) => events.push(e), controller.signal, 20);

    const found = events.filter((e) => e.type === "found");
    const complete = events.find((e) => e.type === "complete");
    expect(found.length).toBe(2);
    expect(complete).toBeDefined();
    if (complete?.type === "complete") expect(complete.foundCount).toBe(2);
  });

  it("counts a result only when both the domain and its Instagram username are available", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"], definition: "", common: false, noun: true },
      { word: "dog", langs: ["english"], definition: "", common: false, noun: true },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");
    vi.mocked(checkInstagramUsername).mockResolvedValue("available");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 2, (e) => events.push(e), controller.signal, 20);

    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(2);
    for (const f of found) {
      if (f.type === "found") expect(f.instagram).toBe("available");
    }
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
    await runDiscovery(pool, undefined, ["com", "net"], 4, (e) => events.push(e), controller.signal, 20);

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
    await runDiscovery(pool, undefined, ["com"], 3, (e) => events.push(e), controller.signal, 20);

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
    await runDiscovery(pool, undefined, ["com"], 4, (e) => events.push(e), controller.signal, 20);

    const found = events.filter((e) => e.type === "found");
    expect(found.length).toBe(1);
    if (found[0].type === "found") expect(found[0].domain).toBe("catdog.com");

    // The rejected names never even get a "checking" event — no domain
    // check is wasted on a candidate this cheap local check already ruled
    // out, the same as isPronounceable.
    const checkingNames = events.filter((e) => e.type === "checking").map((e) => e.name);
    expect(checkingNames).toEqual(["catdog.com"]);
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
    await runDiscovery(pool, undefined, ["com"], 10, (e) => events.push(e), controller.signal, 20);

    expect(events.some((e) => e.type === "stopped")).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(false);
  });
});
