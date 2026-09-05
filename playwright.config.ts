import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3197", serviceWorkers: "block", headless: true },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3197",
    url: "http://127.0.0.1:3197/staff/self-study-room",
    reuseExistingServer: false,
    env: { STAFF_AUTH_ENABLED: "true", STAFF_AUTH_ORIGIN: "https://test.invalid",
      SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SECRET_KEY: "isolated-test-not-a-real-key" },
  },
});
