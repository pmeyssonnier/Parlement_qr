import { defineConfig, devices } from "@playwright/test";
// CI tests the production build (`npm run build` runs first); locally, the dev server.
export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, forbidOnly: !!process.env.CI,
  use: { baseURL: "http://127.0.0.1:3000", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: { command: process.env.CI ? "npm run start" : "npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI, timeout: 120000 },
});
