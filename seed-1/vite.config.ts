import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// The headers netlify.toml sends on every path ("/*"), so `vite preview` and the e2e run against it
// serve the game under the production security headers.
export function netlifyHeaders(toml: string): Record<string, string> {
  for (const block of toml.split(/^\[\[headers\]\]\s*$/m).slice(1)) {
    if (!/^\s*for\s*=\s*"\/\*"\s*$/m.test(block)) continue;
    const headers: Record<string, string> = {};
    for (const match of block.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/gm)) {
      if (match[1] !== 'for') headers[match[1]!] = match[2]!;
    }
    return headers;
  }
  return {};
}

export default defineConfig({
  publicDir: false,
  plugins: [buildShaPlugin()],
  build: {
    chunkSizeWarningLimit: 2000,
  },
  preview: { headers: netlifyHeaders(readFileSync(join(import.meta.dirname, 'netlify.toml'), 'utf8')) },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
