import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: process.env.PLAYWRIGHT_BROWSER === "webkit" ? "webkit" : "chromium",
    channel: process.env.PLAYWRIGHT_BROWSER === "webkit" ? undefined : process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure"
  },
  webServer: {
    // A missed mock must never reach a developer's real database or Pusher app.
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test?connect_timeout=1",
      CHORCHAT_AUTH_PASSWORD: "",
      PUSHER_APP_ID: "",
      PUSHER_SECRET: ""
    },
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120000
  }
});
