import { resolve } from 'node:path';
import { checkInvariants } from '../sim/invariants';
import type { InvariantResult } from '../sim/invariants';
import type { SimConfig, UnlockEvent } from '../sim/types';
import type { BotArgs } from './args';
import { loadConfigFromDir } from './config';
import { runGreedy } from './greedy';

export interface BotReport {
  ok: boolean;
  simulatedSeconds: number;
  invariants: InvariantResult[];
  unlocks: UnlockEvent[];
  finalTotalDust: number;
  stateHash: string;
}

export const CONFIG_INVARIANT = 'config-loads';
export const RUN_INVARIANT = 'bot-run';

// pnpm runs package scripts with the package as the working directory and
// records the caller's directory in INIT_CWD; relative paths resolve against
// the caller so `--config-dir seed-1/config` works from the repository root.
export function resolveConfigDir(configDir: string, baseDir = process.env['INIT_CWD'] ?? process.cwd()): string {
  return resolve(baseDir, configDir);
}

export function loadBotConfig(configDir: string): SimConfig {
  return loadConfigFromDir(resolveConfigDir(configDir));
}

// Node file errors carry a string code (ENOENT, ENOTDIR, EACCES); parse and
// validation errors do not, which is how the command line tells a bad path
// from a bad file.
export function isFilesystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}

export function runBot(config: SimConfig, args: BotArgs): BotReport {
  const run = runGreedy(config, {
    seed: args.seed,
    hours: args.hours,
    ...(args.realSeconds === null ? {} : { realSecondsBudget: args.realSeconds }),
  });
  const invariants = checkInvariants(run.log);
  return {
    ok: invariants.every((result) => result.ok),
    simulatedSeconds: run.log.simulatedSeconds,
    invariants,
    unlocks: run.log.unlocks,
    finalTotalDust: run.state.totalDust,
    stateHash: run.log.stateHash,
  };
}

// A config that fails to parse, or a run that throws, is reported in the same
// shape as a failed run under the named invariant, so callers reading the
// JSON or the first line see one kind of failure and which step it came from.
export function failureReport(name: string, message: string): BotReport {
  return {
    ok: false,
    simulatedSeconds: 0,
    invariants: [{ name, ok: false, detail: message }],
    unlocks: [],
    finalTotalDust: 0,
    stateHash: '',
  };
}

export function formatReport(report: BotReport): string {
  const lines = [
    `${report.ok ? 'PASS' : 'FAIL'}: ${report.invariants.filter((r) => r.ok).length} of ${report.invariants.length} invariants hold over ${report.simulatedSeconds} simulated seconds`,
  ];
  for (const result of report.invariants) lines.push(`${result.ok ? 'ok  ' : 'fail'} ${result.name}: ${result.detail}`);
  for (const event of report.unlocks) lines.push(`unlock ${event.id} at ${event.atSeconds} s`);
  lines.push(`final total dust ${report.finalTotalDust}`);
  lines.push(`state hash ${report.stateHash}`);
  return lines.join('\n');
}
