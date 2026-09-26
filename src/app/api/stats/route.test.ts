import { describe, expect, it, vi } from "vitest";

const { getDictionaryStats } = vi.hoisted(() => ({ getDictionaryStats: vi.fn() }));
vi.mock("@/lib/dictionary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dictionary")>();
  return { ...actual, getDictionaryStats };
});

import { GET } from "./route";

function req(query: string) {
  return new Request(`http://localhost/api/stats?${query}`);
}

describe("GET /api/stats", () => {
  it("returns the computed stats on success", async () => {
    getDictionaryStats.mockReturnValue({ total: 5, matched: 2 });
    const res = await GET(req("langs=english&maxLength=8&keyword=glow"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 5, matched: 2 });
  });

  it("returns a JSON {error} response instead of crashing when the stats computation throws", async () => {
    getDictionaryStats.mockImplementation(() => {
      throw new Error("dictionary not loaded");
    });
    const res = await GET(req("langs=english&maxLength=8&keyword="));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("dictionary not loaded");
  });
});
