// The community content filter's term digests (docs/specs/community-core.md, Content filter).
//
// The gate's deny-lists (platform/gate/denylist/*.txt) hold the terms in plain text, and the
// banned-phrases scan reads every changed file, so a migration cannot carry the terms themselves.
// It carries their sha256 digests instead: each list line is normalized exactly as the gate does it
// (platform/gate/lib/banned-scan.awk, mode=normalize), trimmed, and hashed; hashed.txt's digests are
// taken as they are. community.text_allowed() normalizes a player's text the same way and refuses
// any one-to-four token phrase whose digest is in community.denied_digests.
//
//   node platform/supabase/scripts/denylist-digests.mjs   prints the digests, one a line, sorted
//
// platform/supabase/test/community-denylist.test.ts checks the migration's list equals this output.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GATE = resolve(ROOT, 'platform', 'gate');
export const LISTS = ['profanity', 'slurs', 'sexual', 'drugs', 'coded', 'trademarks'];

export function denylistDigests(gateDir = GATE) {
  const digests = new Set();
  for (const list of LISTS) {
    const file = resolve(gateDir, 'denylist', `${list}.txt`);
    const terms = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.startsWith('#'))
      .join('\n');
    const normalized = execFileSync('awk', ['-v', 'mode=normalize', '-f', resolve(gateDir, 'lib', 'banned-scan.awk')], { input: `${terms}\n`, encoding: 'utf8' });
    for (const line of normalized.split('\n')) {
      const phrase = line.trim();
      if (phrase !== '') digests.add(createHash('sha256').update(phrase, 'utf8').digest('hex'));
    }
  }
  for (const line of readFileSync(resolve(gateDir, 'denylist', 'hashed.txt'), 'utf8').split('\n')) {
    const digest = line.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(digest)) digests.add(digest);
  }
  return [...digests].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${denylistDigests().join('\n')}\n`);
}
