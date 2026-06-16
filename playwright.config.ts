import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3100";
const baseURL = `http://localhost:${port}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 5_000,
  },
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `${baseURL}/?e2e=1`,
    timeout: 120_000,
    reuseExistingServer,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
