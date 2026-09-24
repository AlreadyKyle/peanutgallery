import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

/**
 * Writes version.json (the served build's sha, which lib/freshness.ts reads) into the build's output
 * folder. The folder resolves as Vite resolves it: an absolute --outDir stays absolute, so the file
 * lands beside the build and never inside the repository.
 */
export function writeVersionFile(): Plugin {
  let outDir = '';
  return {
    name: 'backseat-write-version',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      const version = { sha: buildSha(), builtAt: new Date().toISOString() };
      writeFileSync(join(outDir, 'version.json'), `${JSON.stringify(version)}\n`);
    },
  };
}

/**
 * The headers netlify.toml sends on every path, so `vite preview` (and the e2e run against it) serves
 * the site under the same security headers and Content Security Policy as production.
 */
export function netlifyHeaders(toml: string, path = '/*'): Record<string, string> {
  for (const block of toml.split(/^\[\[headers\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\[\[/m)[0] ?? '';
    if (body.match(/^\s*for\s*=\s*"([^"]*)"/m)?.[1] !== path) continue;
    const values: Record<string, string> = {};
    for (const match of body.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/gm)) {
      if (match[1] !== 'for') values[match[1]!] = match[2]!;
    }
    return values;
  }
  return {};
}

export default defineConfig({
  plugins: [react(), stampBuildSha(), writeVersionFile()],
  server: { port: 5173 },
  preview: { port: 4173, headers: netlifyHeaders(readFileSync(join(import.meta.dirname, 'netlify.toml'), 'utf8')) },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'netlify/**/*.test.ts', 'build-sha.test.ts'],
    env: { TZ: 'UTC' },
  },
});
