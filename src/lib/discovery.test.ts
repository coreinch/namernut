import { describe, expect, it, vi } from "vitest";

vi.mock("./rdap", () => ({ checkDomain: vi.fn() }));
vi.mock("./whois", () => ({ checkDomainWhois: vi.fn() }));

import { checkDomain } from "./rdap";
import { checkDomainWhois } from "./whois";
import { runDiscovery, type DiscoveryEvent } from "./discovery";
import type { WordEntry } from "./dictionary";

describe("runDiscovery", () => {
  it("dedupes candidate names that collide via ambiguous word-boundary concatenation", async () => {
    // "ab" + "cde" and "abc" + "de" both concatenate to the identical
    // string "abcde" — a different underlying word pair landing on the
    // same candidate name. Without dedup this fires two "checking"/"found"
    // events for the same domain and produces a duplicate React key.
    const pool: WordEntry[] = [
      { word: "ab", langs: ["english"] },
      { word: "cde", langs: ["english"] },
      { word: "abc", langs: ["english"] },
      { word: "de", langs: ["english"] },
    ];

    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();

    // Large enough target that every non-colliding candidate in this tiny
    // 4x4 pool gets visited, so the collision would surface if not deduped.
    await runDiscovery(pool, undefined, ["com"], 100, (e) => events.push(e), controller.signal);

    const foundDomains = events.filter((e) => e.type === "found").map((e) => e.domain);
    const checkingNames = events.filter((e) => e.type === "checking").map((e) => e.name);

    expect(foundDomains.filter((d) => d === "abcde.com").length).toBe(1);
    expect(checkingNames.filter((n) => n === "abcde.com").length).toBe(1);

    // No candidate name (checking or found) appears more than once overall.
    expect(new Set(checkingNames).size).toBe(checkingNames.length);
    expect(new Set(foundDomains).size).toBe(foundDomains.length);
  });

  it("stops around the target count and reports completion", async () => {
    // Every candidate resolves "available" near-instantly here, so with
    // several concurrent workers all racing the same claimIndex() check,
    // foundCount can briefly overshoot the target before a worker observes
    // the updated value — a deliberate, documented tradeoff (see
    // claimIndex/worker in discovery.ts), not a bug. So this asserts
    // "stopped at or shortly after the target", not exact equality.
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"] },
      { word: "dog", langs: ["english"] },
      { word: "fox", langs: ["english"] },
    ];
    vi.mocked(checkDomain).mockResolvedValue("available");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    await runDiscovery(pool, undefined, ["com"], 2, (e) => events.push(e), controller.signal);

    const found = events.filter((e) => e.type === "found");
    const complete = events.find((e) => e.type === "complete");
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.length).toBeLessThanOrEqual(pool.length * pool.length);
    expect(complete).toBeDefined();
    if (complete?.type === "complete") expect(complete.foundCount).toBe(found.length);
  });

  it("emits 'stopped' instead of 'complete' when aborted", async () => {
    const pool: WordEntry[] = [
      { word: "cat", langs: ["english"] },
      { word: "dog", langs: ["english"] },
    ];
    vi.mocked(checkDomain).mockResolvedValue("taken");
    vi.mocked(checkDomainWhois).mockResolvedValue("unknown");

    const events: DiscoveryEvent[] = [];
    const controller = new AbortController();
    controller.abort();
    await runDiscovery(pool, undefined, ["com"], 10, (e) => events.push(e), controller.signal);

    expect(events.some((e) => e.type === "stopped")).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(false);
  });
});
