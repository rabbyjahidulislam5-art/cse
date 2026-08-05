import { defineConfig, devices } from '@playwright/test';

// Focused E2E suite (golden-path coverage of every NEW feature in this enhancement, plus smoke
// tests of core pre-existing flows) — no Playwright suite existed in this repo before. Boots both
// the backend (port 4000) and the Vite frontend (port 5173) automatically via webServer, matching
// how this project already runs in local development (two separate `npm run dev` processes).
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false, // tests share seeded/real DB state — safer sequential by default
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'npm run dev',
      cwd: './server',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
