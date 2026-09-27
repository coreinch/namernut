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
      reporter: ["text"],
      // Set a bit below the ~81/73/69/83 baseline measured once page.test.tsx
      // (rendering the full Home tree to exercise the localStorage
      // hydration/dedupe/migration logic) started pulling several
      // still-untested presentational components — FiltersPanel, GateToggle,
      // LogDot, LiveLogSection, ResultsGrid's pending-card branch — into the
      // coverage denominator just by being imported, without any of *them*
      // gaining real test coverage. Was 85/75/90/85 (measured ~92/85/98/94)
      // before this file existed, back when only src/lib and the API routes
      // were exercised at all; those numbers weren't a regression in
      // anything already tested, just a wider, more honest denominator now
      // that page.tsx/Header/Footer have real coverage. Future rounds can
      // raise this back up as more of the newly-counted components get their
      // own tests, the same way this round did for page.tsx/Header/Footer.
      thresholds: {
        statements: 78,
        branches: 70,
        functions: 65,
        lines: 80,
      },
    },
  },
});
