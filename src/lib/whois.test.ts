import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";

// Real child_process.execFile resolves via a custom
// util.promisify.custom implementation (returning {stdout, stderr}), not
// Node's generic single-value callback promisify fallback. A plain vi.fn()
// mock lacks that, so promisify(execFile) would otherwise resolve to just
// the first callback argument — mock the well-known symbol directly so it
// behaves like the real thing. (The symbol must be spelled out inline here,
// not via an outer const: vi.mock factories are hoisted above every other
// top-level statement in the file, including const declarations.)
vi.mock("node:child_process", () => {
  const fn = vi.fn() as unknown as typeof import("node:child_process").execFile &
    Record<symbol, ReturnType<typeof vi.fn>>;
  fn[Symbol.for("nodejs.util.promisify.custom")] = vi.fn();
  return { execFile: fn };
});

// vi.mock calls are hoisted above imports by Vitest's transform, so this
// static import correctly receives the mocked execFile.
import { checkDomainWhois } from "./whois";

const PROMISIFY_CUSTOM = Symbol.for("nodejs.util.promisify.custom");
const promisified = (execFile as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[
  PROMISIFY_CUSTOM
];

function mockWhoisStdout(stdout: string) {
  promisified.mockResolvedValue({ stdout, stderr: "" });
}

function mockWhoisFailure() {
  promisified.mockRejectedValue(new Error("simulated whois failure"));
}

describe("checkDomainWhois", () => {
  afterEach(() => {
    promisified.mockReset();
  });

  it("recognizes 'No match for' as available", async () => {
    mockWhoisStdout('No match for "FOO.COM".');
    await expect(checkDomainWhois("foo", "com")).resolves.toBe("available");
  });

  it("recognizes 'No data found' as available", async () => {
    mockWhoisStdout("No Data Found\n>>> Last update ...");
    await expect(checkDomainWhois("foo", "biz")).resolves.toBe("available");
  });

  // Regression test: Radix/CentralNic registries (.tech, .cloud) phrase
  // availability as "is available for registration", which none of the
  // original patterns matched — a real bug found and fixed.
  it("recognizes Radix/CentralNic's 'is available for registration' phrasing as available", async () => {
    mockWhoisStdout(">>> Domain foo.tech is available for registration\n");
    await expect(checkDomainWhois("foo", "tech")).resolves.toBe("available");
  });

  it("recognizes 'Domain Name:' as taken", async () => {
    mockWhoisStdout("Domain Name: GOOGLE.COM\nRegistrar: MarkMonitor\n");
    await expect(checkDomainWhois("google", "com")).resolves.toBe("taken");
  });

  it("is case-insensitive for the taken check", async () => {
    mockWhoisStdout("   domain name: google.name\n");
    await expect(checkDomainWhois("google", "name")).resolves.toBe("taken");
  });

  // Regression test: EURid (.eu) phrases availability as "Status:
  // AVAILABLE", which the original patterns (only "status: free") missed.
  it("recognizes EURid's 'Status: AVAILABLE' as available", async () => {
    mockWhoisStdout("Domain: foo.eu\nStatus: AVAILABLE\n");
    await expect(checkDomainWhois("foo", "eu")).resolves.toBe("available");
  });

  it("recognizes DENIC's 'Status: free' as available for .de", async () => {
    mockWhoisStdout("Domain: foo.de\nStatus: free\n");
    await expect(checkDomainWhois("foo", "de")).resolves.toBe("available");
  });

  // Regression test: DENIC (.de) and EURid (.eu) echo a bare "Domain:"
  // line — not "Domain Name:" — for a *taken* domain, which the original
  // taken-check missed and fell through to "unknown".
  it("recognizes DENIC/EURid's bare 'Domain:' echo as taken", async () => {
    mockWhoisStdout("Domain: google.de\nNserver: ns1.google.com\nStatus: connect\n");
    await expect(checkDomainWhois("google", "de")).resolves.toBe("taken");
  });

  it("still correctly reports available for .de even though its response always echoes a 'Domain:' line", async () => {
    // The available-check runs first, so this must resolve via
    // "status: free" and never fall through to the "Domain:" taken check.
    mockWhoisStdout("Domain: foo.de\nStatus: free\n");
    await expect(checkDomainWhois("foo", "de")).resolves.toBe("available");
  });

  it("returns 'unknown' when output matches neither pattern", async () => {
    mockWhoisStdout("Some unrecognized registry response format.");
    await expect(checkDomainWhois("foo", "com")).resolves.toBe("unknown");
  });

  it("returns 'unknown' when the whois process fails or times out", async () => {
    mockWhoisFailure();
    await expect(checkDomainWhois("foo", "com")).resolves.toBe("unknown");
  });

  // Regression test: .dev/.app (Google Registry) have no legacy whois
  // server at all — DNS resolution fails outright — and .info/.shop
  // explicitly say they have none / are RDAP-only. Skip the attempt
  // entirely rather than waste a doomed lookup.
  it.each(["dev", "app", "info", "shop"])(
    "skips the whois attempt entirely for .%s (no whois server)",
    async (tld) => {
      const result = await checkDomainWhois("foo", tld);
      expect(result).toBe("unknown");
      expect(promisified).not.toHaveBeenCalled();
    }
  );
});
