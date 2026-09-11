/**
 * Checks domain registration status via RDAP (RFC 7484), resolving each
 * TLD's RDAP server through IANA's public bootstrap registry. No API key
 * required. 404 means unregistered (available); 200 means the domain has a
 * registration record (taken).
 */
export type DomainStatus = "available" | "taken" | "unknown";

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";

// Verisign runs .com/.net but (as of this writing) isn't listed in IANA's
// bootstrap file for them — hardcode these two as a safety net.
const STATIC_RDAP_BASE: Record<string, string> = {
  com: "https://rdap.verisign.com/com/v1",
  net: "https://rdap.verisign.com/net/v1",
  // .io and .me are run by Identity Digital and do resolve RDAP there, but
  // (like .com/.net) aren't listed in IANA's bootstrap registry — found by
  // testing directly, not by IANA discovery.
  io: "https://rdap.identitydigital.services/rdap",
  me: "https://rdap.identitydigital.services/rdap",
};

let bootstrapPromise: Promise<Map<string, string>> | null = null;

async function loadBootstrap(): Promise<Map<string, string>> {
  if (!bootstrapPromise) {
    bootstrapPromise = fetch(BOOTSTRAP_URL)
      .then((res) => res.json())
      .then((data: { services: [string[], string[]][] }) => {
        const map = new Map<string, string>();
        for (const [tlds, urls] of data.services) {
          if (urls.length === 0) continue;
          const base = urls[0].replace(/\/$/, "");
          for (const tld of tlds) map.set(tld.toLowerCase(), base);
        }
        return map;
      })
      .catch((err) => {
        // Don't cache a transient failure forever — clear the cached
        // promise so the next call retries instead of every TLD lookup
        // silently resolving to "unknown" for the rest of the process's
        // lifetime.
        bootstrapPromise = null;
        throw err;
      });
  }
  return bootstrapPromise;
}

async function getRdapBase(tld: string): Promise<string | null> {
  if (STATIC_RDAP_BASE[tld]) return STATIC_RDAP_BASE[tld];
  try {
    const map = await loadBootstrap();
    return map.get(tld) ?? null;
  } catch {
    return null;
  }
}

export async function checkDomain(
  name: string,
  tld: string,
  signal?: AbortSignal
): Promise<DomainStatus> {
  const base = await getRdapBase(tld);
  if (!base) return "unknown";

  const domain = `${name}.${tld}`;
  const res = await fetch(`${base}/domain/${domain}`, {
    headers: { Accept: "application/rdap+json" },
    signal,
  });

  if (res.status === 404) return "available";
  if (res.status === 200) return "taken";
  if (res.status === 429) {
    const err = new Error("rate_limited");
    err.name = "RateLimitError";
    throw err;
  }
  return "unknown";
}
