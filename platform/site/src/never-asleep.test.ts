import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The owner, 19 October 2026, asked twice: the agents are never drawn asleep, in the studio room, on
// /team, on home or anywhere else. With no work, while a role is paused and while the agents are
// offline, they putter about the room like any idle agent; only work changes what they do. No closed
// eyes, no sleep mark and no sleeping words. This scan fails if any of them comes back.

const SRC = resolve(process.cwd(), 'src');
// The only allowed hit: the counter's note on a sleeping laptop, which is about the reader's machine.
const ALLOWED = new Set(['lib/count.ts']);
const SLEEP = /\b(asleep|sleeps?|sleeping|slumped|snooz\w*|zzz+)\b|avatar-lid|data-pose=.?asleep/i;
// The old sleep mark over an agent in the room: two stacked Z glyphs.
const Z_MARK = 'M-4 -6h7l-7 7h7';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : files(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$|\.test-fixture\.ts$/.test(name) ? [path] : [];
  });
}

describe('the agents never sleep', () => {
  it('has no closed eyes, sleep mark or sleeping words in the site source', () => {
    const hits: string[] = [];
    for (const path of files(SRC)) {
      const name = relative(SRC, path).replace(/\\/g, '/');
      if (ALLOWED.has(name)) continue;
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (SLEEP.test(line) || line.includes(Z_MARK)) hits.push(`${name}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
