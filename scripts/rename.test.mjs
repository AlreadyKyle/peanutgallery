// Tests for the rename tool (docs/specs/rename.md): the rewrite, the kept history lines, and a
// drift guard that fails when a tracked file carries the old name or domain without a tier.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { KEEP_LINES, TIERS, apply, inventory, rewrite, tierOf } from './rename.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEW = { name: 'Front Row', domain: 'frontrow.example' };

test('rewrite replaces the display name in every spelling and the domain in every case', () => {
  const before = [
    '<title>Dust · Peanut Gallery</title>',
    'description=Peanut+Gallery+Mac+dispatcher',
    'mail board@PeanutGallery.games and https://www.peanutgallery.games/og.png',
    'the peanut gallery',
  ].join('\n');
  assert.equal(
    rewrite(before, NEW),
    [
      '<title>Dust · Front Row</title>',
      'description=Front+Row+Mac+dispatcher',
      'mail board@frontrow.example and https://www.frontrow.example/og.png',
      'the Front Row',
    ].join('\n'),
  );
});

test('rewrite leaves internal identifiers and the kept history lines alone', () => {
  const identifiers = 'peanutgallery_backup studio.peanutgallery.dispatcher @backseat/site peanutgallerygames';
  assert.equal(rewrite(identifiers, NEW), identifiers);
  for (const line of KEEP_LINES) assert.equal(rewrite(`x ${line} y`, NEW), `x ${line} y`);
});

test('apply rewrites only the files of the tier asked for', () => {
  const root = mkdtempSync(join(tmpdir(), 'rename-'));
  const one = TIERS[1][0];
  const two = TIERS[2][0];
  for (const file of [one, two]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'Peanut Gallery at peanutgallery.games\n');
  }
  for (const file of TIERS[1].slice(1)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'nothing here\n');
  }
  assert.deepEqual(apply(root, '1', NEW), [one]);
  assert.equal(readFileSync(join(root, one), 'utf8'), 'Front Row at frontrow.example\n');
  assert.equal(readFileSync(join(root, two), 'utf8'), 'Peanut Gallery at peanutgallery.games\n');
  assert.deepEqual(
    inventory(root, [one, two]).map((row) => [row.file, row.tier, row.name, row.domain]),
    [[two, '2', 1, 1]],
  );
});

test('history is never a tier', () => {
  assert.equal(tierOf('docs/specs/site-mark.md'), 'history');
  assert.equal(tierOf('platform/supabase/migrations/20260923000010_backup_role.sql'), 'history');
  // The posted Terms versions (docs/specs/legal-copy.md): a rename adds a new version instead.
  assert.equal(tierOf('platform/site/src/lib/terms-versions.ts'), 'history');
});

test('never rewrites the posted Terms versions, whichever tier is applied', () => {
  // apply rewrites only the files of the tier it is given, and the versions file is in none.
  const file = 'platform/site/src/lib/terms-versions.ts';
  assert.ok(readFileSync(join(repoRoot, file), 'utf8').includes('Peanut Gallery is operated by'), 'the versions name the studio');
  assert.ok(!Object.values(TIERS).some((files) => files.includes(file)));
  assert.deepEqual(inventory(repoRoot, [file]).map((row) => [row.file, row.tier]), [[file, 'history']]);
});

test('every tracked file that carries the old name or domain is in a tier (add new ones to TIERS in scripts/rename.mjs)', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);
  const unclassified = inventory(repoRoot, files).filter((row) => row.tier === 'unclassified').map((row) => row.file);
  assert.deepEqual(unclassified, []);
  for (const file of [...TIERS[1], ...TIERS[2]]) assert.ok(files.includes(file), `${file} in TIERS is tracked`);
});
