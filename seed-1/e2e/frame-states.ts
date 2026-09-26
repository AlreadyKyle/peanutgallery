import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromDir } from '../bots/config';
import { greedyTick } from '../bots/greedy';
import { serializeState } from '../sim/save';
import { createSim } from '../sim/sim';

// The game's fixed states for its frames (docs/specs/design-review.md): the sim with seed 1 at 0, 600,
// 3,600 and 21,600 seconds, stepped a second at a time as the headless bot steps it (bots/greedy.ts),
// each as the save the game reads, written as { "<seconds>": "<save>" } to the file named on the
// command line. e2e/frames.spec.ts reads that file (E2E_FRAME_STATES) and never imports this module,
// because this one runs the sim, which a card can change: the gate's frames job runs it on the base
// commit's worktree before the change's draw, and `pnpm e2e` runs it on the checkout for a local run.
//
// usage: tsx e2e/frame-states.ts <out.json>
export const SEED = 1;
export const STATES = [0, 600, 3_600, 21_600];

export function frameStates(): Record<string, string> {
  const config = loadConfigFromDir(fileURLToPath(new URL('../config', import.meta.url)));
  const saves: Record<string, string> = {};
  let state = createSim(config, SEED);
  let at = 0;
  for (const seconds of STATES) {
    for (; at < seconds; at += 1) state = greedyTick(state, config);
    saves[String(seconds)] = serializeState(state);
  }
  return saves;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: tsx e2e/frame-states.ts <out.json>');
    process.exit(2);
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(frameStates())}\n`);
  console.log(`frame states: ${STATES.join(', ')} s -> ${out}`);
}
