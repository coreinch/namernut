import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // Node stays the default: most tests here (src/lib, the API routes) rely
    // on real fetch/ReadableStream/NextResponse behavior that jsdom doesn't
    // fully implement (see app/api/discover/route.test.ts's SSE stream
    // reading). Component tests opt into jsdom per-file instead, via a
    // `// @vitest-environment jsdom` docblock at the top of the file — see
    // components/Header.test.tsx, components/Footer.test.tsx, and
    // app/page.test.tsx.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // page.test.tsx's two 500/501-entry MAX_FOUND_HISTORY tests mount that
    // many real ResultCards, then unmount them all in the shared `afterEach`
    // `cleanup()` — under `npm run test:coverage`'s v8 instrumentation and 32
    // concurrent worker files, that teardown intermittently missed Vitest's
    // default 5000ms *hook* timeout (a separate budget from the tests' own
    // already-raised 15000/30000ms `it(...)` timeouts, which were passing).
    // Reproduced directly: a coverage run failed with "Test timed out in
    // 5000ms" attributed to the hook, not the test body.
    hookTimeout: 20000,
    // Same root cause as hookTimeout above: with all ~35 test files spawned
    // as isolated worker processes at once, CPU contention during that
    // startup burst can blow past the default 5000ms *test* timeout too —
    // reproduced directly: a plain `npm run test` (no coverage instrumentation
    // involved) failed `getSelectedPool`'s single-language filter test, a
    // synchronous Array.filter over an already-built pool that finishes in
    // well under 5ms in isolation, with "Test timed out in 5000ms".
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      // Deliberately not `all: true` — only files actually exercised by a
      // test count, so the floor tracks the tested surface (src/lib, the
      // API routes, and now a first pass of component tests — see
      // @testing-library/react) rather than being diluted by every
      // untested file in src/.
      // `skipFull: false` because the default text reporter silently omits
      // any file at 100% coverage on every metric from the printed table —
      // confirmed by diffing the table against coverage-final.json's raw
      // per-file numbers (18 fully-covered lib/component files were missing
      // rows entirely, e.g. kilocode.ts, Footer.tsx). The aggregate
      // percentages and threshold gate were never affected by this — it's a
      // reporting gap, not a coverage gap — but a hidden 100%-covered file
      // that later regresses would show no row and no uncovered-line
      // numbers, only a small dip in the aggregate.
      reporter: [["text", { skipFull: false }]],
      // Raised again (was 87/79/80/90, itself raised from an original
      // 80/75/72/83) now that a round of accessibility/focus-management
      // fixes each shipped with real regression tests — the ResultCard
      // remove/favorite-unmount focus handoff, SettingsDrawer's
      // return-focus-on-close, Footer's Stop-button unmount redirect, the
      // hero-to-compact-layout first-search redirect, LiveLogSection's
      // throttled announcer, plus a new configSync.test.ts and
      // nextConfig.test.ts covering invariants that previously had no test
      // at all — pushed real coverage to roughly 94/89/93/97. Set a bit
      // below that (not at it) for the same reason as every previous raise
      // here: so small, incidental drift doesn't fail CI, while still
      // catching an actual regression rather than drifting arbitrarily far
      // below the tested reality. See git history for the specific
      // per-file numbers at each prior raise if reconstructing this
      // trajectory is ever useful.
      thresholds: {
        statements: 93,
        branches: 87,
        functions: 91,
        lines: 95,
      },
    },
  },
});
