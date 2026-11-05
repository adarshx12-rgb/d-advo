import { defineConfig, devices } from "@playwright/test";

const SERVER_PORT = 4100;
const WEB_PORT = 3100;

/**
 * E2E runs against a real game server (in-memory persistence, accelerated timers, mock payments)
 * and the Next.js dev server. Ports differ from local dev so tests never touch your running game.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 420_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "pnpm --filter @hps/server start",
      url: `http://localhost:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        PORT: String(SERVER_PORT),
        DATABASE_URL: "",
        GAME_TIMER_SCALE: "0.2",
        PAYMENT_MODE: "mock",
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        SESSION_SECRET: "e2e-session-secret-at-least-32-characters-long",
      },
    },
    {
      command: `pnpm --filter @hps/web exec next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { NEXT_PUBLIC_SERVER_URL: `http://localhost:${SERVER_PORT}` },
    },
  ],
});
