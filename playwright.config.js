import { defineConfig, devices } from "@playwright/test";

// End-to-end config.
// Runs against the vite dev server in demo mode (the fixtures in
// src/lib/api.js), in the system Edge — the project only ships playwright-core
// without a browser download, and Edge shares its engine with the desktop
// WebView2, so behaviour is closer to the real thing.
//
// To exercise the save path against a real desktop window (real tasks, real
// permissions) use scripts/manual/verify-edit-save.mjs: it attaches to the
// desktop build's CDP port, which needs the app running, so it stays out of
// npm test.

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:1424";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.js",
  // Cases share one demo dataset and all touch localStorage; running them in
  // parallel would make assertions like "how many rows survive the filter"
  // non-deterministic.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    ...devices["Desktop Chrome"],
    // The UI follows navigator.language, which comes from the browser locale —
    // pin it so assertions do not depend on the machine.
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 860 },
    launchOptions: { executablePath: EDGE, args: ["--no-sandbox", "--disable-dev-shm-usage"] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
