import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DomainStatus } from "@/lib/rdap";

const execFileAsync = promisify(execFile);

const NOT_FOUND_PATTERNS = [
  /no match for/i,
  /not found/i,
  /no data found/i,
  /no entries found/i,
  /status:\s*free/i,
  /domain not found/i,
  // Radix/CentralNic-registry phrasing (.tech, .cloud, and similar), e.g.
  // ">>> Domain foo.tech is available for registration".
  /available for registration/i,
  // EURid (.eu), e.g. "Status: AVAILABLE".
  /status:\s*available/i,
];

// DENIC (.de) and EURid (.eu) echo a bare "Domain:" line (not "Domain
// Name:") for both available and taken lookups alike, distinguishing only
// via Status — so this only runs after every NOT_FOUND_PATTERNS check above
// has already failed to match, at which point a "Domain:" echo is a safe
// signal of "taken".
const TAKEN_PATTERNS = [/domain\s*name\s*:/i, /^domain:/im];

// Registries with no legacy whois service at all — either DNS resolution
// for whois.nic.<tld> fails outright (.dev, .app — Google Registry, RDAP
// only), or the server responds but says so explicitly ("This TLD has no
// whois server" for .info; .shop's whois was retired in favor of RDAP).
// None of that matches NOT_FOUND_PATTERNS or the taken check below, so it'd
// already resolve to "unknown" — skip the attempt rather than waste it.
const NO_WHOIS_SERVER = new Set(["dev", "app", "info", "shop"]);

/**
 * Fallback availability check using the system `whois` CLI (via `timeout`
 * to bound the call), used when the RDAP lookup is inconclusive. Works for
 * most TLDs — the `whois` client follows the standard IANA referral chain
 * itself, so no per-TLD server configuration is needed here — except the
 * handful with no legacy whois service at all (see NO_WHOIS_SERVER).
 */
export async function checkDomainWhois(name: string, tld: string): Promise<DomainStatus> {
  if (NO_WHOIS_SERVER.has(tld)) return "unknown";
  const domain = `${name}.${tld}`;
  try {
    const { stdout } = await execFileAsync("timeout", ["10", "whois", domain]);
    if (NOT_FOUND_PATTERNS.some((re) => re.test(stdout))) return "available";
    if (TAKEN_PATTERNS.some((re) => re.test(stdout))) return "taken";
    return "unknown";
  } catch {
    return "unknown";
  }
}
