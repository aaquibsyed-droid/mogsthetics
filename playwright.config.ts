import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * E2E runs against a production build using the LOCAL backend (embedded
 * Postgres, local auth) and the labelled MOCK AI provider — no external
 * services or credentials needed. Data lives in .data/e2e and is wiped before the server starts.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `node -e "require('fs').rmSync('.data/e2e',{recursive:true,force:true})" && npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NUTRILENS_BACKEND: "local",
      LOCAL_DATA_DIR: ".data/e2e",
      AI_PROVIDER: "mock",
      ENABLE_EXTERNAL_FOOD_APIS: "false",
      SESSION_SECRET: "e2e-only-session-secret-0123456789abcdef",
      E2E_INSECURE_COOKIES: "1",
      AUTH_RATE_LIMIT_PER_5MIN: "200",
    },
  },
});
