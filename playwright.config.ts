import { defineConfig, devices } from "@playwright/test";

// The macOS app renders with WebKit, so the tests run in WebKit.
// Set PW_BROWSER=chromium to try them somewhere WebKit isn't installed.
const browser = process.env.PW_BROWSER === "chromium" ? "chromium" : "webkit";

export default defineConfig({
  testDir: "e2e",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1100, height: 720 },
  },
  projects: [
    {
      name: browser,
      use: {
        ...devices[browser === "webkit" ? "Desktop Safari" : "Desktop Chrome"],
        viewport: { width: 1100, height: 720 },
        // Lets a machine with its own Chromium build run the tests (PW_CHROMIUM=/path/to/chrome).
        launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
      },
    },
  ],
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
