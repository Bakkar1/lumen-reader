import { defineConfig } from '@playwright/test';

export const FIXTURE_PORT = 4317;

export default defineConfig({
  testDir: 'tests/e2e',
  // One persistent Chromium per test; extensions cannot share a context safely.
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${FIXTURE_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node scripts/fixture-server.mjs ${FIXTURE_PORT}`,
    url: `http://127.0.0.1:${FIXTURE_PORT}/health`,
    reuseExistingServer: !process.env.CI,
  },
});
