import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isKernelPath } from '../src/worktree.js';
import { importClosure } from './helpers/imports.js';

// The gate's frames job draws a card's change on a runner that then uploads the frames the Director
// reviews (docs/specs/design-review.md), so no code a card can change may run in Node there: a card's
// code runs only in the browser. On a card branch the job restores every kernel file from the base,
// so what Node runs is kernel exactly when every file the job's Node entries load is kernel: the two
// Playwright configs and the Vite configs their builds read, seed-1's postbuild step, the site's
// route-shots spec and every spec in seed-1/e2e (Playwright loads them all). The game's states come
// from e2e/frame-states.ts, which runs the sim, a card folder, so the job runs it on the base's
// worktree and the frames spec only reads the file it writes. This test lives in the dispatcher, a
// kernel folder, so no card can weaken it.
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');

function readRepo(file: string): string | null {
  const full = path.join(REPO, file);
  return existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
}

function frameEntries(): string[] {
  const seedBuild = (JSON.parse(readRepo('seed-1/package.json')!) as { scripts: { build: string } }).scripts.build;
  const seedSteps = [...seedBuild.matchAll(/\bnode\s+(\S+\.m?js)\b/g)].map((match) => `seed-1/${match[1]}`);
  const seedSpecs = readdirSync(path.join(REPO, 'seed-1/e2e'))
    .filter((name) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(name))
    .map((name) => `seed-1/e2e/${name}`);
  return [
    'platform/site/playwright.config.ts',
    'platform/site/vite.config.ts',
    'platform/site/e2e/route-shots.spec.ts',
    'seed-1/playwright.config.ts',
    'seed-1/vite.config.ts',
    ...seedSteps,
    ...seedSpecs,
  ];
}

describe('the frames job runs only kernel code in Node', () => {
  it('finds the entries the job runs', () => {
    const entries = frameEntries();
    expect(entries).toContain('seed-1/scripts/postbuild.mjs');
    expect(entries).toContain('seed-1/e2e/frames.spec.ts');
    for (const entry of entries) expect(readRepo(entry), entry).not.toBeNull();
  });

  it('has every file its Node entries load, directly or through another file, on the kernel list', () => {
    const { files, problems } = importClosure(frameEntries(), readRepo);
    expect(problems).toEqual([]);
    expect(files.filter((file) => !isKernelPath(file))).toEqual([]);
    expect(files).toContain('platform/site/src/lib/legal.ts');
  });

  it('keeps the sim out: the frames spec never loads frame-states.ts, which runs it on the base', () => {
    const { files } = importClosure(frameEntries(), readRepo);
    expect(files).not.toContain('seed-1/e2e/frame-states.ts');
    expect(files.some((file) => file.startsWith('seed-1/sim/') && !isKernelPath(file))).toBe(false);
    const states = importClosure(['seed-1/e2e/frame-states.ts'], readRepo).files;
    expect(states).toContain('seed-1/sim/sim.ts');
    expect(isKernelPath('seed-1/sim/sim.ts')).toBe(false);
  });

  // The two imports that put card code in the job's Node (the findings on 1117f73): the frames spec
  // built the states from the sim, and route-shots read two unavailable lines from copy.ts.
  it('names a card-lane file a frame spec loads, however deep', () => {
    const tree: Record<string, string> = {
      'seed-1/e2e/frames.spec.ts': "import { serializeState } from '../sim/save';\nimport { createSim } from '../sim/sim';\n",
      'seed-1/sim/save.ts': "import { hashState } from './hash';\n",
      'seed-1/sim/sim.ts': "import { rng } from './rng';\n",
      'seed-1/sim/hash.ts': '',
      'seed-1/sim/rng.ts': '',
      'platform/site/e2e/route-shots.spec.ts': "import { legal } from '../src/lib/legal';\nimport { copy } from '../src/lib/copy';\nimport { expect } from './fixtures';\n",
      'platform/site/e2e/fixtures.ts': "import { rows } from '../src/lib/cards';\n",
      'platform/site/src/lib/legal.ts': '',
      'platform/site/src/lib/copy.ts': '',
      'platform/site/src/lib/cards.ts': '',
    };
    const { files, problems } = importClosure(['seed-1/e2e/frames.spec.ts', 'platform/site/e2e/route-shots.spec.ts'], (file) => tree[file] ?? null);
    expect(problems).toEqual([]);
    expect(files.filter((file) => !isKernelPath(file))).toEqual([
      'platform/site/src/lib/cards.ts',
      'platform/site/src/lib/copy.ts',
      'seed-1/sim/save.ts',
      'seed-1/sim/sim.ts',
    ]);
  });

  it('refuses what it cannot follow: a missing file, a computed import and a workspace package', () => {
    const tree: Record<string, string> = {
      'seed-1/e2e/a.spec.ts': "import './gone';\nconst m = await import(name);\nimport { x } from '@backseat/seed-1';\nimport { y } from './b.js';\nimport { test } from '@playwright/test';\n",
      'seed-1/e2e/b.ts': '',
    };
    const { files, problems } = importClosure(['seed-1/e2e/a.spec.ts'], (file) => tree[file] ?? null);
    expect(files).toEqual(['seed-1/e2e/a.spec.ts', 'seed-1/e2e/b.ts']);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toBe('seed-1/e2e/a.spec.ts imports the workspace package @backseat/seed-1');
    expect(problems[1]).toBe('seed-1/e2e/a.spec.ts imports ./gone, which resolves to no file');
    expect(problems[2]).toMatch(/^seed-1\/e2e\/a\.spec\.ts has a computed import at \d+$/);
  });
});
