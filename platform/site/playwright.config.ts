import { defineConfig } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: origin,
    browserName: 'chromium',
    viewport: { width: 375, height: 812 },
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort',
    url: origin,
    reuseExistingServer: true,
  },
});
