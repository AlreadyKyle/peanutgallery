// The one public-text filter (src/public-text.ts, docs/specs/agent-workflows.md): the gate's own
// banned-phrases.sh, every list and trademarks included, and a scan that cannot run refuses. The
// terms are read from the deny-list files at run time, so this file carries none of them.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES_SCRIPT, PublicTextRefused, assertPublicTextClean, scanPublicText } from '../src/public-text.js';

const DENYLIST = path.resolve(import.meta.dirname, '..', '..', 'gate', 'denylist');

function firstTerm(list: string): string {
  const line = readFileSync(path.join(DENYLIST, `${list}.txt`), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'));
  if (!line) throw new Error(`${list}.txt holds no term`);
  return line;
}

describe('scanPublicText', () => {
  it('runs the gate script in this checkout', () => {
    expect(BANNED_PHRASES_SCRIPT.endsWith(path.join('platform', 'gate', 'banned-phrases.sh'))).toBe(true);
  });

  it('passes clean card text', async () => {
    expect(await scanPublicText(['Gatherers cost 11', 'The gatherer costs one more to build.', 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11'])).toEqual({ ok: true });
    await expect(assertPublicTextClean(['A plain summary.'])).resolves.toBeUndefined();
  });

  it('refuses a deny-list hit in any string, and a trademark too', async () => {
    for (const list of ['profanity', 'trademarks']) {
      const result = await scanPublicText(['A plain title.', `A summary with ${firstTerm(list)} in it.`]);
      expect(result.ok, list).toBe(false);
      if (!result.ok) expect(result.detail).toMatch(/^a deny-list hit: FAIL: banned-phrases/);
    }
    await expect(assertPublicTextClean([firstTerm('profanity')])).rejects.toBeInstanceOf(PublicTextRefused);
  });

  it('refuses when the scan cannot run: the script missing, or any other exit', async () => {
    const missing = await scanPublicText(['A plain title.'], { script: '/nonexistent/banned-phrases.sh' });
    expect(missing).toEqual({ ok: false, detail: 'the deny-list scan could not run: banned-phrases.sh is missing' });
    const dir = mkdtempSync(path.join(os.tmpdir(), 'public-text-test-'));
    const broken = path.join(dir, 'broken.sh');
    writeFileSync(broken, '#!/usr/bin/env bash\necho "FAIL: banned-phrases denylist folder not found"\nexit 2\n');
    chmodSync(broken, 0o755);
    const result = await scanPublicText(['A plain title.'], { script: broken });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/^the deny-list scan could not run/);
    const silent = path.join(dir, 'silent.sh');
    writeFileSync(silent, '#!/usr/bin/env bash\nexit 0\n');
    expect((await scanPublicText(['A plain title.'], { script: silent })).ok).toBe(false);
  });
});
