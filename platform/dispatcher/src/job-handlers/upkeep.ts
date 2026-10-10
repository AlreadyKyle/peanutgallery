// What the Janitor's two code jobs run with (docs/specs/agent-upkeep.md): GitHub, the models and the
// price table, the code checkout, the pin, and the deploy and smoke path a merge uses. main.ts builds
// one; the handlers fail a run in a process that has none.
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DispatcherConfig } from '../config.js';
import { MERGE_STATE_INTERVAL_MS, MERGE_STATE_TIMEOUT_MS, type GateStatus } from '../github.js';
import type { JobContext } from '../jobs.js';
import { mergedServedFiles, type MergedFile } from '../smoke.js';
import { gitAuthEnv } from '../worktree.js';

const execFileAsync = promisify(execFile);

export interface UpkeepTimings {
  deployTimeoutMs: number;
  deployIntervalMs: number;
  gateTimeoutMs: number;
  gateIntervalMs: number;
  retryDelayMs: number;
  // How long a merge request whose answer was lost is read back before it is left pending.
  mergeStateTimeoutMs: number;
  mergeStateIntervalMs: number;
}

export interface UpkeepDeps {
  config: Pick<
    DispatcherConfig,
    'githubToken' | 'githubRepo' | 'netlifyAuthToken' | 'netlifySiteIdSeed' | 'netlifySiteIdPlatform' | 'modelBuilder' | 'modelDirector' | 'modelHost' | 'priceTable' | 'studioAnthropicApiKey' | 'codeRoot'
  >;
  // GitHub, Netlify, the npm registry and the Anthropic model list; tests pass a mock.
  fetchFn?: typeof fetch;
  // main's head and its gate, as the tick reads them.
  mainGate: () => Promise<{ sha: string; status: GateStatus }>;
  // schema_fingerprint() after every migration in this process's checkout, on PGlite.
  migrationsFingerprint: () => Promise<Record<string, string>>;
  // The Claude Code pin against claude --version (cli-pin.ts).
  // The newest file in platform/agents/evals/results/, parsed, or null when there is none.
  newestEvalResult: () => Promise<{ file: string; model_ids: Record<string, string> } | null>;
  // seed-1's served files at a merge commit, for the smoke test (smoke.ts mergedServedFiles).
  servedFiles: (sha: string) => Promise<MergedFile[]>;
  timings?: Partial<UpkeepTimings>;
}

export const UPKEEP_TIMINGS: UpkeepTimings = {
  deployTimeoutMs: 10 * 60_000,
  deployIntervalMs: 10_000,
  gateTimeoutMs: 12 * 60_000,
  gateIntervalMs: 15_000,
  retryDelayMs: 1000,
  mergeStateTimeoutMs: MERGE_STATE_TIMEOUT_MS,
  mergeStateIntervalMs: MERGE_STATE_INTERVAL_MS,
};

export function requireUpkeep(context: JobContext): UpkeepDeps {
  if (!context.upkeep) throw new Error('the upkeep jobs are not configured in this process');
  return context.upkeep;
}

export const EVAL_RESULTS_DIR = path.join('platform', 'agents', 'evals', 'results');
// The migrations on PGlite take seconds; the script gets two minutes.
export const FINGERPRINT_TIMEOUT_MS = 120_000;

// The fingerprint child's whole environment. It runs kernel migrations on PGlite with no network and
// reads no secret, so it gets none of the dispatcher's (the service role, GitHub, Netlify and Anthropic
// keys): PATH to find pnpm and node, HOME and TMPDIR, and tsx's cache off, as the dispatcher's own
// start sets it (platform/ops/mac/run-dispatcher.sh).
export function fingerprintEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { TSX_DISABLE_CACHE: '1' };
  for (const name of ['PATH', 'HOME', 'TMPDIR'] as const) {
    if (env[name] !== undefined) out[name] = env[name];
  }
  return out;
}

type ExecFile = (file: string, args: string[], options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string }>;

// schema_fingerprint() on PGlite after every migration in the code checkout, from
// platform/supabase/scripts/schema-fingerprint.ts: in process, with no network, kernel code only.
export function migrationsFingerprintRunner(codeRoot: string, exec: ExecFile = execFileAsync, env: NodeJS.ProcessEnv = process.env): () => Promise<Record<string, string>> {
  return async () => {
    const { stdout } = await exec('pnpm', ['--silent', '--filter', '@backseat/supabase', 'exec', 'tsx', 'scripts/schema-fingerprint.ts', '--pglite'], {
      cwd: codeRoot,
      timeout: FINGERPRINT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: fingerprintEnv(env),
    });
    const line = stdout.trim().split('\n').at(-1) ?? '';
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('schema-fingerprint.ts printed no object');
    return parsed as Record<string, string>;
  };
}

// The newest result file by its UTC stamp name, with the model ids it ran.
export async function newestEvalResult(codeRoot: string): Promise<{ file: string; model_ids: Record<string, string> } | null> {
  const dir = path.join(codeRoot, EVAL_RESULTS_DIR);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return null;
  }
  const newest = names.at(-1);
  if (newest === undefined) return null;
  const result = JSON.parse(await readFile(path.join(dir, newest), 'utf8')) as { model_ids?: Record<string, unknown> };
  const ids = Object.fromEntries(Object.entries(result.model_ids ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  return { file: path.join(EVAL_RESULTS_DIR, newest), model_ids: ids };
}

export function upkeepDeps(config: DispatcherConfig, mainGate: UpkeepDeps['mainGate']): UpkeepDeps {
  return {
    config,
    mainGate,
    migrationsFingerprint: migrationsFingerprintRunner(config.codeRoot),
    newestEvalResult: () => newestEvalResult(config.codeRoot),
    servedFiles: (sha) => mergedServedFiles(config.repoRoot, sha, gitAuthEnv(config.githubToken)),
  };
}
