import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveBuildSha } from '../scripts/build-sha.mjs';
import { COPIED_FOLDERS, runPostbuild } from '../scripts/postbuild.mjs';
import { FIXTURE_CONFIG_DIR, LIVE_CONTENT_DIR } from './paths';

const SHA_FROM_NETLIFY = '0123456789abcdef0123456789abcdef01234567';
const SHA_FROM_ACTIONS = 'fedcba9876543210fedcba9876543210fedcba98';

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path).map((child) => join(name, child)));
    else out.push(name);
  }
  return out;
}

describe('build scripts', () => {
  const savedEnv = { COMMIT_REF: process.env['COMMIT_REF'], GITHUB_SHA: process.env['GITHUB_SHA'] };
  let workDir = '';

  beforeEach(() => {
    delete process.env['COMMIT_REF'];
    delete process.env['GITHUB_SHA'];
    workDir = mkdtempSync(join(tmpdir(), 'seed-1-postbuild-'));
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  it('takes the commit from COMMIT_REF, then GITHUB_SHA, then git', () => {
    process.env['COMMIT_REF'] = SHA_FROM_NETLIFY;
    process.env['GITHUB_SHA'] = SHA_FROM_ACTIONS;
    expect(resolveBuildSha()).toBe(SHA_FROM_NETLIFY);
    process.env['COMMIT_REF'] = '';
    expect(resolveBuildSha()).toBe(SHA_FROM_ACTIONS);
    delete process.env['GITHUB_SHA'];
    expect(resolveBuildSha()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('copies config and content verbatim and writes version.json', () => {
    const packageDir = join(workDir, 'package');
    const dist = join(workDir, 'dist');
    mkdirSync(join(packageDir, 'config'), { recursive: true });
    mkdirSync(join(packageDir, 'content'), { recursive: true });
    for (const name of readdirSync(FIXTURE_CONFIG_DIR)) {
      writeFileSync(join(packageDir, 'config', name), readFileSync(join(FIXTURE_CONFIG_DIR, name)));
    }
    for (const name of readdirSync(LIVE_CONTENT_DIR)) {
      writeFileSync(join(packageDir, 'content', name), readFileSync(join(LIVE_CONTENT_DIR, name)));
    }
    process.env['COMMIT_REF'] = SHA_FROM_NETLIFY;
    const before = Date.now();
    const version = runPostbuild(packageDir, dist);

    expect(COPIED_FOLDERS).toEqual(['config', 'content']);
    for (const folder of COPIED_FOLDERS) {
      const files = listFiles(join(packageDir, folder));
      expect(files.length).toBeGreaterThan(0);
      expect(listFiles(join(dist, folder))).toEqual(files);
      for (const file of files) {
        expect(readFileSync(join(dist, folder, file))).toEqual(readFileSync(join(packageDir, folder, file)));
      }
    }
    const written = JSON.parse(readFileSync(join(dist, 'version.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(['sha', 'builtAt']);
    expect(written).toEqual(version);
    expect(written['sha']).toBe(SHA_FROM_NETLIFY);
    const builtAt = Date.parse(String(written['builtAt']));
    expect(builtAt).toBeGreaterThanOrEqual(before);
    expect(builtAt).toBeLessThanOrEqual(Date.now());
  });
});
