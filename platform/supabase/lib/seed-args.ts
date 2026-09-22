// Command-line parsing for seed.ts. A UsageError is reported with exit 2.

import { parseRunNumber, type Week1Run } from "./week1.js";

export class UsageError extends Error {}

export interface SeedOptions {
  week1Test: boolean;
  run: Week1Run;
}

/** Accepts `--week1-test`, `--run N` and `--run=N`; `--run` needs `--week1-test`. */
export function parseSeedArgs(argv: string[]): SeedOptions {
  let week1Test = false;
  let runValue: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // pnpm passes the `--` in `pnpm seed -- --week1-test` through to the script.
    if (arg === "--") continue;
    if (arg === "--week1-test") {
      week1Test = true;
    } else if (arg === "--run") {
      if (argv[i + 1] === undefined) throw new UsageError("--run needs a value");
      runValue = argv[i + 1];
      i++;
    } else if (arg?.startsWith("--run=")) {
      runValue = arg.slice("--run=".length);
    } else {
      throw new UsageError(`Unknown argument ${arg}`);
    }
  }
  if (runValue !== undefined && !week1Test) {
    throw new UsageError("--run is only valid together with --week1-test");
  }
  try {
    return { week1Test, run: parseRunNumber(runValue) };
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
}
