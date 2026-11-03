// Runs the studio's own deny-list scan (platform/gate/banned-phrases.sh, from the studio checkout the
// workflow makes) over every draft that could go out. A hit marks the draft needs_edit, so nothing
// the gate would refuse in a game reaches a public account.
//   node promo/src/scan.mjs <path to studio checkout>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listOutbox, saveDraft } from './lib.mjs';

const studio = process.argv[2];
const script = join(studio, 'platform/gate/banned-phrases.sh');
const dir = mkdtempSync(join(tmpdir(), 'promo-scan-'));
let flagged = 0;
for (const draft of listOutbox()) {
  if (!['pending', 'approved'].includes(draft.status)) continue;
  const file = join(dir, `${draft.id}.txt`);
  writeFileSync(file, `${draft.text}\n`);
  let first = '';
  try {
    first = execFileSync('bash', [script, file], { encoding: 'utf8' }).split('\n')[0];
  } catch (error) {
    first = String(error.stdout ?? '').split('\n')[0] || 'FAIL: scan did not run';
  }
  if (!first.startsWith('PASS')) {
    saveDraft({ ...draft, status: 'needs_edit', problems: [...(draft.problems ?? []), `deny-list: ${first}`] });
    flagged += 1;
  }
}
console.log(`scan: ${flagged} flagged`);
