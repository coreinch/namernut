import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// next.config.ts's headers() is the entire enforcement mechanism for this
// app's security headers (CSP, frame/embedding restrictions, HSTS, the
// Permissions-Policy lockdown, COOP/CORP) — nothing else in the codebase
// checks that a future edit doesn't accidentally weaken or drop one of
// them (e.g. adding 'unsafe-eval' back, or losing frame-ancestors 'none').
// vitest's include glob only picks up src/**/*.test.ts, hence this file
// living under src/lib rather than beside next.config.ts itself — its
// import reaches up to the real config object either way.
describe("next.config.ts's security headers", () => {
  async function getHeaders() {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/:path*");
    if (!rule) throw new Error("no /:path* header rule found");
    return Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
  }

  it("sets a Content-Security-Policy with no 'unsafe-eval' and a locked-down frame-ancestors", async () => {
    const headers = await getHeaders();
    const csp = headers["Content-Security-Policy"];
    expect(csp).toBeDefined();
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("sets the standard clickjacking/MIME-sniffing/referrer/transport hardening headers", async () => {
    const headers = await getHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toContain("includeSubDomains");
  });

  it("locks down Permissions-Policy and cross-origin isolation headers", async () => {
    const headers = await getHeaders();
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });
});
