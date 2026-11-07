import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Integration tests against a real PostgreSQL test database.
 * Requires the database container:  npm run db:up
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside React Server Components; tests run in plain Node.
      "server-only": path.resolve(import.meta.dirname, "src/test/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./src/test/integration-global-setup.ts"],
    // One shared database: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
