/**
 * Checks npm package name availability via the npm registry's own public
 * REST API (`GET /{name}` on registry.npmjs.org) — like github.ts, a real,
 * documented, officially-supported endpoint: 404 means the name is free,
 * 200 means it's taken, no scraping or undocumented HTML structure
 * involved. Confirmed directly (2026-09-27) against both a known-real
 * package ("react") and a random unlikely-to-exist string. Every candidate
 * name this app generates is already plain lowercase letters/digits (see
 * parseKeyword in candidates.ts and the dictionary source), which is a
 * valid, unscoped npm package name as-is — no extra normalization needed
 * here.
 */
import { checkStatusOnly, SOCIAL_CHECK_USER_AGENT, type SocialStatus } from "@/lib/socialStatus";

export async function checkNpmPackageName(name: string, signal?: AbortSignal): Promise<SocialStatus> {
  return checkStatusOnly(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    { "User-Agent": SOCIAL_CHECK_USER_AGENT, Accept: "application/json" },
    "npm_rate_limited",
    signal
  );
}
