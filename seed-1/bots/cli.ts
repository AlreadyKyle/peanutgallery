import { USAGE, parseArgs } from './args';
import type { BotArgs } from './args';
import { CONFIG_INVARIANT, RUN_INVARIANT, failureReport, formatReport, isFilesystemError, loadBotConfig, runBot } from './report';
import type { BotReport } from './report';
import type { SimConfig } from '../sim/types';

// Exit codes: 0 every invariant holds, 1 a run or config failure (reported on
// stdout under the invariant named for the step that failed), 2 a usage error
// including a config directory that cannot be read (reported on stderr with
// the usage line).

function usageError(error: unknown): number {
  process.stderr.write(`${errorMessage(error)}\n${USAGE}\n`);
  return 2;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function main(argv: string[]): number {
  let args: BotArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return usageError(error);
  }
  let config: SimConfig;
  let report: BotReport;
  try {
    config = loadBotConfig(args.configDir);
  } catch (error) {
    if (isFilesystemError(error)) return usageError(error);
    return printReport(args, failureReport(CONFIG_INVARIANT, errorMessage(error)));
  }
  try {
    report = runBot(config, args);
  } catch (error) {
    report = failureReport(RUN_INVARIANT, errorMessage(error));
  }
  return printReport(args, report);
}

function printReport(args: BotArgs, report: BotReport): number {
  process.stdout.write(`${args.json ? JSON.stringify(report) : formatReport(report)}\n`);
  return report.ok ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
