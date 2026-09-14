import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';
import { gitHead, resolveBuildSha } from './build-sha';

let resolvedSha = '';

function buildSha(): string {
  if (resolvedSha === '') resolvedSha = resolveBuildSha(process.env, gitHead);
  return resolvedSha;
}

function stampBuildSha(): Plugin {
  return {
    name: 'backseat-stamp-build-sha',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%BUILD_SHA%', buildSha()),
    },
  };
}

function writeVersionFile(): Plugin {
  let outDir = '';
  return {
    name: 'backseat-write-version',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      const version = { sha: buildSha(), builtAt: new Date().toISOString() };
      writeFileSync(join(outDir, 'version.json'), `${JSON.stringify(version)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [react(), stampBuildSha(), writeVersionFile()],
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'build-sha.test.ts'],
    env: { TZ: 'UTC' },
  },
});
