import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The headers netlify.toml sends on every path, so `vite preview` (and the e2e run against it) serves
 * the board under the same security headers and enforced Content Security Policy as production.
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
  plugins: [react()],
  server: { port: 5174 },
  preview: { port: 4174, headers: netlifyHeaders(readFileSync(join(import.meta.dirname, 'netlify.toml'), 'utf8')) },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    env: { TZ: 'UTC' },
  },
});
