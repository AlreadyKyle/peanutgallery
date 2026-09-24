import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBuildSha } from './build-sha';
import { writeVersionFile } from './vite.config';

const head = () => '2775bcb1000a2ebb53a1b03771afb137aae2f50c\n';

describe('resolveBuildSha', () => {
  it('prefers COMMIT_REF, then GITHUB_SHA, then git', () => {
    expect(resolveBuildSha({ COMMIT_REF: 'aaa1111', GITHUB_SHA: 'bbb2222' }, head)).toBe('aaa1111');
    expect(resolveBuildSha({ GITHUB_SHA: 'bbb2222' }, head)).toBe('bbb2222');
    expect(resolveBuildSha({}, head)).toBe('2775bcb1000a2ebb53a1b03771afb137aae2f50c');
  });

  it('treats blank values as unset and trims the rest', () => {
    expect(resolveBuildSha({ COMMIT_REF: '   ', GITHUB_SHA: ' bbb2222 ' }, head)).toBe('bbb2222');
    expect(resolveBuildSha({ COMMIT_REF: '', GITHUB_SHA: '' }, head)).toBe(
      '2775bcb1000a2ebb53a1b03771afb137aae2f50c',
    );
  });
});

describe('writeVersionFile', () => {
  /** Runs the plugin as a build does: the resolved config, then the end of the bundle. */
  function build(root: string, outDir: string) {
    const plugin = writeVersionFile();
    (plugin.configResolved as (config: unknown) => void)({ root, build: { outDir } });
    (plugin.closeBundle as () => void)();
  }

  it('writes version.json into an absolute --outDir, never into a copy of that path under the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'site-root-'));
    const out = mkdtempSync(join(tmpdir(), 'site-out-'));
    try {
      build(root, out);
      expect(JSON.parse(readFileSync(join(out, 'version.json'), 'utf8'))).toEqual({ sha: expect.any(String), builtAt: expect.any(String) });
      expect(existsSync(join(root, out))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('writes a relative outDir under the root, as Vite resolves it', () => {
    const root = mkdtempSync(join(tmpdir(), 'site-root-'));
    try {
      build(root, 'dist');
      expect(existsSync(join(root, 'dist', 'version.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
