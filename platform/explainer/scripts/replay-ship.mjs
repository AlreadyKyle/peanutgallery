// The unattended half of Replays (docs/specs/replays.md, step 2), run by .github/workflows/replay.yml
// on a push to main. Two commands:
//
//   node scripts/replay-ship.mjs check --sha <commit>
//     Whether the commit is a dispatcher ship of a card that changes what Dust draws (src/replay/ship.ts).
//     Prints `card=<id>` when it is, or `skip: <reason>`, and writes `card=<id or empty>` to
//     $GITHUB_OUTPUT when that is set. Exits 0 either way: a commit that makes no clip is no failure.
//
//   node scripts/replay-ship.mjs card --id <card id> --out <card.json> [--base-url https://mobmachine.games]
//                                     [--attempts 40] [--interval 30]
//     Saves the card's public /api/card/<id> document once it says the card is live, asking every
//     --interval seconds up to --attempts times. A card the dispatcher took back out writes no file,
//     prints `skip: ...` and writes `live=false` to $GITHUB_OUTPUT; exits 1 when the card never went live.
//
// Reads git and one public document; writes nothing anywhere but --out and $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { factsFrom } from '../src/replay/plan.ts';
import { liveDocument, shipOf } from '../src/replay/ship.ts';

const USAGE = 'usage: node scripts/replay-ship.mjs check --sha <commit> | card --id <card id> --out <card.json> [--base-url <url>] [--attempts 40] [--interval 30]';
const [command, ...args] = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  if (i !== -1 && args[i + 1] !== undefined) return args[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`${name} is required\n${USAGE}`);
  process.exit(2);
};
const output = (line) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
};
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });

if (command === 'check') {
  const sha = value('--sha');
  if (!/^[0-9a-f]{7,40}$/.test(sha)) {
    console.error(`--sha "${sha}" is not a commit sha`);
    process.exit(2);
  }
  const message = git('show', '-s', '--format=%B', sha);
  // The parent must exist to draw the before; a root commit has nothing before it.
  const paths = git('diff', '--name-only', '--no-renames', `${sha}^`, sha).split('\n').filter(Boolean);
  const ship = shipOf(message, paths);
  if (ship.ok) console.log(`card=${ship.cardId}`);
  else console.log(`skip: ${ship.reason}`);
  output(`card=${ship.ok ? ship.cardId : ''}`);
} else if (command === 'card') {
  const id = value('--id');
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), value('--out'));
  const base = value('--base-url', 'https://mobmachine.games').replace(/\/$/, '');
  const attempts = Number(value('--attempts', '40'));
  const interval = Number(value('--interval', '30'));
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    console.error(`--id "${id}" is not a card id`);
    process.exit(2);
  }
  const fetchDoc = async () => {
    const response = await fetch(`${base}/api/card/${id}?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`/api/card/${id} answered HTTP ${response.status}`);
    return response.json();
  };
  try {
    const doc = await liveDocument(fetchDoc, factsFrom, { attempts, intervalMs: interval * 1000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    if (doc === null) {
      console.log(`skip: card ${id} was taken back out, so this commit did not ship it`);
      output('live=false');
    } else {
      writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
      console.log(`card ${id} is live: ${out}`);
      output('live=true');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
} else {
  console.error(USAGE);
  process.exit(2);
}
