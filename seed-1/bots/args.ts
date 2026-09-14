export interface BotArgs {
  configDir: string;
  hours: number;
  seed: number;
  realSeconds: number | null;
  json: boolean;
}

export const USAGE =
  'usage: bot --config-dir <dir> --hours <n> --seed <n> [--real-seconds <n>] [--json]';

function readNumber(name: string, raw: string | null, min: number): number {
  if (raw === null) throw new Error(`${name} needs a value`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) throw new Error(`${name} must be a number of at least ${min}`);
  return value;
}

export function parseArgs(argv: readonly string[]): BotArgs {
  const values = new Map<string, string | null>();
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // pnpm forwards the bare "--" separator into the script's arguments.
    if (arg === '--') continue;
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--config-dir' || arg === '--hours' || arg === '--seed' || arg === '--real-seconds') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      values.set(arg, next);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument ${arg ?? ''}`);
  }
  const configDir = values.get('--config-dir');
  if (configDir === undefined || configDir === null) throw new Error('--config-dir is required');
  if (!values.has('--hours')) throw new Error('--hours is required');
  if (!values.has('--seed')) throw new Error('--seed is required');
  const seed = readNumber('--seed', values.get('--seed') ?? null, 0);
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  return {
    configDir,
    hours: readNumber('--hours', values.get('--hours') ?? null, 0),
    seed,
    realSeconds: values.has('--real-seconds') ? readNumber('--real-seconds', values.get('--real-seconds') ?? null, 0) : null,
    json,
  };
}
