import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/funnel-focus', testMatch: '*.spec.ts', fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3141', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL, headless: true },
  webServer: { command: 'node tests/funnel-focus/serve.cjs', url: 'http://127.0.0.1:3141', reuseExistingServer: false, timeout: 120000 },
  reporter: 'list', outputDir: 'tmp/funnel-focus-playwright',
});
