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
      // Raised from 78/70/65/80 now that FiltersPanel, GateToggle, LogDot,
      // LiveLogSection, and ResultsGrid — flagged as the next round's
      // highest-value target when that lower floor was set (they'd been
      // pulled into the coverage denominator just by being imported from
      // page.test.tsx's full Home render, without any real coverage of
      // their own) — all got their own test files. Measured ~82.2/78.0/
      // 75.3/85.0 with those in place; set a bit below so small, incidental
      // drift doesn't fail CI. page.tsx itself (44.72% stmts) is still the
      // biggest remaining gap — it's exercised only indirectly via
      // page.test.tsx's localStorage/dedupe/migration tests, not through its
      // own render tree of event handlers — and is the natural next target
      // once it's worth the same render-tree-mocking investment page.test.tsx
      // already made.
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 72,
        lines: 83,
      },
    },
  },
});
