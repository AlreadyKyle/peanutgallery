// Entry for the VPS jobs (docs/specs/money-safety.md), run by their systemd units in the dispatcher
// image from the read-only code clone, each with its own env file:
//   node platform/ops/jobs/main.mjs controller [--dry-run]
//   node platform/ops/jobs/main.mjs quota [--dry-run]
// --dry-run reads everything and prints the result, but writes no controller_runs row, reinstates no
// dispute and alerts nobody. The first output line is PASS: or FAIL:. A run that finds a mismatch
// exits 0 (the board is alerted); one that cannot run exits 1, and the unit's OnFailure alert fires.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runController } from './controller.mjs';
import { runQuota } from './quota.mjs';

export const JOBS = { controller: runController, quota: runQuota };

export async function main(argv, env = process.env, deps = {}) {
  const [job, ...flags] = argv;
  const run = JOBS[job];
  const unknown = flags.filter((flag) => flag !== '--dry-run');
  if (!run || unknown.length > 0) {
    (deps.err ?? process.stderr).write('usage: node platform/ops/jobs/main.mjs controller|quota [--dry-run]\n');
    return 2;
  }
  try {
    await run({ env, dryRun: flags.includes('--dry-run'), ...deps });
    return 0;
  } catch (error) {
    (deps.out ?? process.stdout).write(`FAIL: ${job}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
