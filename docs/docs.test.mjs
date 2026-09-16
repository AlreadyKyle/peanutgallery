// Drift guard for the docs (docs/specs/docs-truth.md). Checks that spec statuses are well formed,
// that docs/ROADMAP.md shows each linked spec at the status the spec itself declares, that the
// protected-paths list in seed-1/CLAUDE.md matches the gate's kernel list, and that the root docs
// name no company other than the footer's Clayhouse credit.
// Run from the repo root: node --test docs/docs.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const docsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(docsDir, '..');
const specsDir = join(docsDir, 'specs');

const STATUSES = ['draft', 'agreed', 'built', 'done'];

const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8');

function specFiles() {
  return readdirSync(specsDir)
    .filter((file) => file.endsWith('.md') && file !== 'TEMPLATE.md')
    .sort();
}

// The word after "Status:" on the spec's status line, or null when the line is missing.
function specStatus(file) {
  const match = /^Status: ([a-z]+)\./m.exec(readFileSync(join(specsDir, file), 'utf8'));
  return match ? match[1] : null;
}

test('every spec has a Status line with draft, agreed, built or done', () => {
  const files = specFiles();
  assert.ok(files.length > 0, 'docs/specs holds specs');
  for (const file of files) {
    const status = specStatus(file);
    assert.ok(status !== null, `${file} has a line starting "Status: <word>."`);
    assert.ok(STATUSES.includes(status), `${file} status "${status}" is one of ${STATUSES.join(', ')}`);
  }
});

// Table rows of docs/ROADMAP.md that name a spec by path, as { line, path, cells, index }, where
// index is the cell holding the path. Rows for specs that live only in an open pull request link
// the pull request instead of a path, so they are not returned.
function roadmapSpecRows() {
  const rows = [];
  for (const line of read('docs', 'ROADMAP.md').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const index = cells.findIndex((cell) => /`specs\/[a-z0-9-]+\.md`/.test(cell));
    if (index === -1) continue;
    const path = /`specs\/([a-z0-9-]+\.md)`/.exec(cells[index])[1];
    rows.push({ line, path, cells, index });
  }
  return rows;
}

test('every ROADMAP row that names a spec path shows the status the spec declares', () => {
  const rows = roadmapSpecRows();
  assert.ok(rows.length > 0, 'docs/ROADMAP.md has table rows naming specs');
  for (const { line, path, cells, index } of rows) {
    assert.ok(existsSync(join(specsDir, path)), `ROADMAP names specs/${path}, which exists (link a pull request for a spec not on this branch): ${line}`);
    const statusCell = cells[index + 1] ?? '';
    const shown = /^[a-z]+/.exec(statusCell)?.[0] ?? '';
    assert.equal(shown, specStatus(path), `ROADMAP shows specs/${path} as "${shown}", the spec says "${specStatus(path)}": ${line}`);
  }
});

// The backticked seed-1 paths in the Protected paths section, trailing slashes dropped. The
// section also names platform/gate/kernel-paths.txt, which is not a seed-1 path.
function seedProtectedPaths() {
  const text = read('seed-1', 'CLAUDE.md');
  const section = /^## Protected paths\n([\s\S]*?)(?=^## )/m.exec(text);
  assert.ok(section, 'seed-1/CLAUDE.md has a "## Protected paths" section');
  return [...section[1].matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((path) => !path.startsWith('platform/'))
    .map((path) => path.replace(/\/$/, ''))
    .sort();
}

test('the protected paths in seed-1/CLAUDE.md equal the seed-1 entries of the kernel list', () => {
  const kernel = read('platform', 'gate', 'kernel-paths.txt')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('seed-1/'))
    .map((line) => line.slice('seed-1/'.length))
    .sort();
  assert.ok(kernel.length > 0, 'the kernel list has seed-1 entries');
  assert.deepEqual(seedProtectedPaths(), kernel);
});

const ROOT_DOCS = ['README.md', 'CLAUDE.md', join('docs', 'PLAN.md')];

// The founder's other company names, as sha256 digests of their lowercase spelling, so this file
// never carries them in plain text: the gate's banned-phrases scan reads docs/ and refuses the
// name (platform/gate/denylist/hashed.txt). Each digest is checked against every window of its
// length in every lowercased line, with runs of whitespace collapsed, so a name is found inside a
// longer word, an address or a domain as well as on its own.
const COMPANY_DIGESTS = [
  { length: 12, digest: '5f71ec6a9bbf350f95caf4a4cb1ace6e10607f6d997d71699aeb0c8fd0bc411e' },
  { length: 19, digest: 'f4062b184f5c5035d54a39d40322d9770d35059b6fe96c60c4de0830dc30fca2' },
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function namesCompany(line) {
  const text = line.toLowerCase().replace(/\s+/g, ' ');
  return COMPANY_DIGESTS.some(({ length, digest }) => {
    for (let start = 0; start + length <= text.length; start += 1) {
      if (sha256(text.slice(start, start + length)) === digest) return true;
    }
    return false;
  });
}

test('the root docs name none of the founder\'s other companies, and Clayhouse only as the footer credit', () => {
  for (const file of ROOT_DOCS) {
    const lines = read(file).split('\n');
    lines.forEach((line, number) => {
      const where = `${file}:${number + 1}`;
      assert.ok(!namesCompany(line), `${where} names one of the founder's other companies`);
      if (/clayhouse/i.test(line)) {
        assert.match(line, /"Created by Clayhouse"/, `${where} names Clayhouse outside the footer credit`);
      }
    });
  }
});
