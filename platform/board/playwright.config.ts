import { defineConfig } from '@playwright/test';
import { E2E_BUILD_ENV, E2E_ORIGIN, E2E_PORT } from './e2e/fixture-env';

// The e2e run builds its own copy of the board into dist-e2e with the fixture values, then serves it
// with `vite preview`, which sends netlify.toml's headers (vite.config.ts). The port comes from
// BOARD_E2E_PORT (default 4174), and a busy port fails the run instead of silently testing another
// worktree's build: reuseExistingServer is off and the port is strict.
const vite = 'node node_modules/vite/bin/vite.js';

// Every test runs on its own page with its own fixture routes, so tests spread across workers one by
// one, not file by file: the long design files no longer run on one worker while the others idle
// (docs/specs/gate-speed.md). CI takes two workers, one per vCPU of the gate's runner; locally the
// default is half the cores. No retries: a test that fails under load fails the gate.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  use: {
    baseURL: E2E_ORIGIN,
    browserName: 'chromium',
    viewport: { width: 375, height: 812 },
  },
  webServer: {
    command: `${vite} build --outDir dist-e2e --emptyOutDir --logLevel warn && ${vite} preview --outDir dist-e2e --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    url: E2E_ORIGIN,
    env: E2E_BUILD_ENV,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
