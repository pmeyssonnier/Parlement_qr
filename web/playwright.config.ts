import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false,
  use: { baseURL:"http://127.0.0.1:3000", screenshot:"only-on-failure", trace:"retain-on-failure" },
  projects:[{name:"desktop",use:{...devices["Desktop Chrome"],channel:"msedge"}},{name:"mobile",use:{...devices["iPhone 13"],defaultBrowserType:"chromium",channel:"msedge"}}],
  webServer:{command:"npm run dev",url:"http://127.0.0.1:3000",reuseExistingServer:true,timeout:120000}
});
