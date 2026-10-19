// The Dust mod's static checks, run by `pnpm verify` (node --test), which has no Claude Code to run the
// mod itself: the manifests parse and point at real files, the link carries only the source tag, the
// hint is off by default, and the copy follows the studio's rules (no money, no exclamation marks).
// The behaviour is tested in dust.test.ts under `claude plugin test platform/claude-mod`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const modDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(modDir, '..', '..');
const readJson = (...parts) => JSON.parse(readFileSync(join(...parts), 'utf8'));
const plugin = readJson(modDir, '.claude-plugin', 'plugin.json');
const hooks = readJson(modDir, 'hooks', 'hooks.json');
const marketplace = readJson(repoRoot, '.claude-plugin', 'marketplace.json');
const source = readFileSync(join(modDir, 'hooks', 'register.ts'), 'utf8');

// The person-facing strings of the hooks module: every quoted string with a space in it.
const moduleCopy = [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)]
  .map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{\w+\}/g, ''))
  .filter((text) => text.includes(' '));

test('the manifest names the mod and one hooks module that exists', () => {
  assert.equal(plugin.name, 'dust');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(hooks.modules.length, 1);
  assert.ok(existsSync(join(modDir, 'hooks', hooks.modules[0])), hooks.modules[0]);
});

test("the repository's marketplace lists the mod at this folder", () => {
  const entry = marketplace.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, 'marketplace entry');
  assert.equal(resolve(repoRoot, entry.source), modDir);
});

test('the link is the game with the claude-code source tag and nothing else', () => {
  const urls = source.match(/https:\/\/[^'"`\s]+/g);
  assert.deepEqual(urls, ['https://play.mobmachine.games/?from=claude-code']);
  assert.deepEqual([...new URL(urls[0]).searchParams.keys()], ['from']);
});

test('the long-turn hint is off unless the person turns it on', () => {
  assert.equal(plugin.userConfig.longTurnHint.type, 'boolean');
  assert.equal(plugin.userConfig.longTurnHint.default, false);
  assert.match(source, /options\.longTurnHint === true/);
});

test('the copy names no money and uses no exclamation marks', () => {
  const copy = [
    plugin.description,
    plugin.userConfig.longTurnHint.title,
    plugin.userConfig.longTurnHint.description,
    marketplace.metadata.description,
    ...marketplace.plugins.map((p) => p.description),
    ...moduleCopy,
  ];
  assert.ok(moduleCopy.some((text) => text.includes('/dust')), 'the module copy was read');
  for (const text of copy) {
    assert.doesNotMatch(text, /!|\$|money|pay|fund|donat|contribut|price|cost|free|streak|left\b/i, text);
  }
});
