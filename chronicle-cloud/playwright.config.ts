import { defineConfig, devices } from '@playwright/test';
import { assertBrowserUrl } from './scripts/local-targets.mjs';

const browserUrl = process.env.CHRONICLE_E2E_URL ?? 'http://127.0.0.1:8788';
assertBrowserUrl(browserUrl);

// Runs against a LOCAL build served by `wrangler pages dev` on 127.0.0.1:8788, backed by the local
// Supabase stack with synthetic sample data (scripts/local-stack.sh up && seed). See docs.
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: browserUrl,
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
  ],
});
