import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { resolveBuildSha } from './scripts/build-sha.mjs';

function buildShaPlugin(): Plugin {
  return {
    name: 'build-sha',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%BUILD_SHA%', resolveBuildSha()),
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [buildShaPlugin()],
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
