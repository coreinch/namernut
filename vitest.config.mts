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
      // Raised from 80/75/72/83 now that page.tsx's own event-handler tree —
      // flagged as the next round's highest-value target when that floor was
      // set, since it was previously exercised only indirectly via
      // page.test.tsx's localStorage/dedupe/migration tests — has its own
      // coverage too: a mocked-fetch/SSE-stream "Home — live search" describe
      // block in page.test.tsx that drives a real Generate click through a
      // fake ReadableStream of "found"/"complete" events, covering the
      // found-event handler (including the MAX_FOUND_HISTORY live-append cap)
      // rather than only the hydration path. page.tsx went from 44.75% to
      // 71.91% stmts; measured ~89.0/81.8/82.6/92.1 overall with that in
      // place, set a bit below so small, incidental drift doesn't fail CI.
      // FiltersPanel.tsx (59.37% stmts) and ResultsGrid.tsx (66.66% stmts)
      // are now the biggest remaining per-file gaps — advanced-filters-panel
      // controls and archive-filter/pending-count branches, respectively —
      // and are reasonable candidates for a future round.
      thresholds: {
        statements: 87,
        branches: 79,
        functions: 80,
        lines: 90,
      },
    },
  },
});
