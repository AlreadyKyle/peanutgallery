// The gate repair round (docs/specs/gate-repair.md): once per card, a gate that failed the card's own
// change sends it back to its builder with the failed jobs and steps, instead of rejecting it at once.
// This file holds the builder's repair feedback; the round itself is in pipeline.ts.
import type { CardFolder } from './adapters/types.js';
import type { CardLane } from './db.js';
import type { FailedStep } from './github.js';

export const GATE_REPAIR_STEP = 'gate_repair';

// At most this many failed steps are named; a run that failed everywhere needs the first ones only.
const MAX_NAMED = 8;

// A job or step name as the gate workflow writes it. Anything else is dropped rather than shown.
const NAME = /^[A-Za-z0-9 ,.'()/_-]{1,100}$/;

// What to run locally for each gate job, from the worktree. The gate workflow's jobs map onto the
// phases of platform/gate/ship-gate.sh (its header comment), plus the end-to-end and frames jobs,
// which have no ship-gate phase.
function localCommand(job: string, step: string | null, folder: CardFolder, lane: CardLane): string | null {
  const gate = (phase: string) => `bash platform/gate/ship-gate.sh --folder ${folder} --lane ${lane} --phase ${phase} --dry-run`;
  switch (job) {
    case 'detect':
      return `${gate('scans')} (the secret, deny-list, runtime-token and game-stack scans; the kernel, lane and symlink guards are the rules in your prompt)`;
    case 'seed-code':
      return 'pnpm --filter @backseat/seed-1 typecheck && pnpm --filter @backseat/seed-1 test';
    case 'platform':
      return gate('checks');
    case 'build':
      if (step === 'Headless bot' && folder === 'seed-1') return gate('bot');
      return gate('build');
    case 'end-to-end':
      return 'E2E_PORT=4400 npx playwright test, from platform/site';
    case 'frames':
      return 'the frames job draws each state twice and needs the same picture each time, so what your change draws must follow only from the game state: nothing random, clock-driven or timer-driven may change a drawn frame. The frames harness is kernel; do not edit it';
    default:
      return null;
  }
}

// The builder's repair feedback: the failed jobs and steps by their workflow names, each with what to
// run locally, and nothing else from the run.
export function repairAddendum(failed: readonly FailedStep[], folder: CardFolder, lane: CardLane): string {
  const named = failed.filter((item) => NAME.test(item.job) && (item.step === null || NAME.test(item.step))).slice(0, MAX_NAMED);
  const lines = named.map((item) => {
    const where = item.step ? `job ${item.job}, step "${item.step}"` : `job ${item.job}`;
    const local = localCommand(item.job, item.step, folder, lane);
    return local ? `- ${where}: ${local}` : `- ${where}`;
  });
  return [
    'Gate repair: the gate failed your change, and this is its one repair round. Your change is already in this working tree; fix what the gate failed, keeping the acceptance test true and the change as small as it was.',
    lines.length > 0 ? 'The gate failed at:' : 'The gate did not say which step failed, so run the whole local gate.',
    ...lines,
    `Then run the whole local gate, \`bash platform/gate/ship-gate.sh --folder ${folder} --lane ${lane} --dry-run\`, until its last line is GATE PASS. A second gate failure rejects the card.`,
  ].join('\n');
}
