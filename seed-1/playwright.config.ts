import { defineConfig } from '@playwright/test';

// The game's frames (docs/specs/design-review.md): e2e/frames.spec.ts draws the built game in
// headless Chromium. WebGL runs on SwiftShader, Chromium's software renderer, so the same build draws
// the same pixels on any runner. The run builds the game, then serves dist/ with `vite preview` on
// E2E_PORT (default 4174); a busy port fails the run instead of testing another build.
const PORT = Number(process.env.E2E_PORT ?? 4174);
const vite = 'node node_modules/vite/bin/vite.js';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    // PW_CHROMIUM_PATH: a cloud session whose network blocks Playwright's download uses the image's Chromium (scripts/cloud-setup.sh).
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    },
  },
  webServer: {
    command: `pnpm build && ${vite} preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
