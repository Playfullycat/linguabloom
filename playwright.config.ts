import { defineConfig, devices } from "@playwright/test";

import { getTestDatabaseUrl } from "./src/test/db";

/**
 * End-to-end tests: production build on port 3200 against the throwaway test
 * database (reset in global setup). Requires the database container:
 *   npm run db:up && npm run test:e2e
 *
 * Locally this uses the installed Google Chrome (no browser download);
 * CI can run `npx playwright install chromium` and set CI=1.
 */
const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel: process.env.CI ? undefined : "chrome" },
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // Never inherit a development NODE_ENV: it breaks `next build`.
      NODE_ENV: "production",
      DATABASE_URL: getTestDatabaseUrl(),
      APP_URL: BASE_URL,
      APP_SECRET: "e2e-test-secret-not-for-production-use-0123456789",
      OWNER_SETUP_ENABLED: "true",
      OWNER_SETUP_TOKEN: "",
      AI_ENABLED: "false",
    },
  },
});
