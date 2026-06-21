import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3014);
const baseURL = `http://127.0.0.1:${port}`;
const webServerTimeout = Number(process.env.E2E_WEB_SERVER_TIMEOUT_MS ?? 300_000);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 240_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: process.env.E2E_SERVER_COMMAND ?? "node scripts/e2e-next-start.mjs",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: webServerTimeout
  }
});
