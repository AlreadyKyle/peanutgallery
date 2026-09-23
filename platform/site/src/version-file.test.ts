import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedConfig } from 'vite';
import { writeVersionFile } from '../vite.config';

// version.json goes into the build's output folder and nowhere else. A build run with an absolute
// --outDir once wrote it under the site's source tree (the root joined with the absolute path), where
// it was committed by mistake.

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function build(root: string, outDir: string) {
  const plugin = writeVersionFile();
  const configResolved = plugin.configResolved as (config: ResolvedConfig) => void;
  const closeBundle = plugin.closeBundle as () => void;
  configResolved({ root, build: { outDir } } as ResolvedConfig);
  closeBundle();
}

describe('writeVersionFile', () => {
  it('writes into an absolute outDir as given, not under the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'site-root-'));
    const out = mkdtempSync(join(tmpdir(), 'site-out-'));
    made.push(root, out);
    build(root, out);
    const version = JSON.parse(readFileSync(join(out, 'version.json'), 'utf8')) as { sha: string; builtAt: string };
    expect(typeof version.sha).toBe('string');
    expect(Number.isFinite(new Date(version.builtAt).getTime())).toBe(true);
    expect(existsSync(join(root, out))).toBe(false);
  });

  it('writes a relative outDir under the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'site-root-'));
    made.push(root);
    build(root, 'dist-test');
    expect(existsSync(join(root, 'dist-test', 'version.json'))).toBe(true);
  });
});
