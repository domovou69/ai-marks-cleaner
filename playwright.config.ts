import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "*.e2e.ts",
  timeout: 120_000,
  use: { baseURL: "http://localhost:4173", serviceWorkers: "allow" },
  // Tests run against the built site, the same files that get deployed.
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173/ai-marks-cleaner/",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
