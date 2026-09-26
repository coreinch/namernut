import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Deliberately not `all: true` — only files actually exercised by a
      // test count, so the floor tracks the tested surface (currently
      // src/lib and the API routes; components have no test coverage yet,
      // see @testing-library/react gap) rather than being diluted by every
      // untested file in src/.
      reporter: ["text"],
      // Set a bit below the ~92/85/98/94 baseline measured when this was
      // added, so the gate catches a real regression without being brittle
      // against small, legitimate coverage dips.
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 90,
        lines: 85,
      },
    },
  },
});
