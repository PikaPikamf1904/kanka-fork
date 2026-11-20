import { defineConfig, devices } from '@playwright/test';
import { assertBrowserUrl } from './scripts/local-targets.mjs';

const browserUrl = process.env.CHRONICLE_E2E_URL ?? 'http://127.0.0.1:8788';
assertBrowserUrl(browserUrl);

// Performance measurement only (tests/perf). Same LOCAL target and data as the browser tests:
//   PERF_LABEL=before bash scripts/e2e-local.sh --config playwright.perf.config.ts
export default defineConfig({
  testDir: 'tests/perf',
  testMatch: '*.perf.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: browserUrl, trace: 'off', screenshot: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
