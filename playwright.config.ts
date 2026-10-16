import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against the dev server in demo mode (fictional data, auth disabled).
 * Demo mode cannot run in production; see src/lib/config.ts.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { AUTH_MODE: "demo", DATA_SOURCE: "demo" },
  },
});
