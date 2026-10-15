import { defineConfig } from "@playwright/test";

/**
 * Wave E1 e2e harness: chromium against the vite dev server (port 1420,
 * strictPort — see vite.config.ts). The Tauri bridge is mocked per-test via
 * addInitScript (e2e/tauri-mock.js); the app itself runs unmodified.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
