// Production smoke test after a deploy: the served build carries the merge sha, every checked
// config path serves the expected value, and (seed-1 only) the headless bot runs against the
// served config within a real-second budget. The bot runs from a checkout of the merge commit,
// which an agent wrote, so it starts with the agent session's allowlisted environment and none of
// the dispatcher's secrets.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { evaluateCheck, type ConfigCheck } from './acceptance.js';
import { childEnv } from './adapters/claude-cli.js';
import type { CardFolder } from './adapters/types.js';
import { requestSignal } from './github.js';
import { retry } from './time.js';

const execFileAsync = promisify(execFile);

export interface BotExecOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
}

// Runs a command and resolves with its stdout, or rejects when it exits non-zero.
export type BotExec = (file: string, args: string[], options: BotExecOptions) => Promise<{ stdout: string }>;

const defaultExec: BotExec = async (file, args, options) => {
  const { stdout } = await execFileAsync(file, args, options);
  return { stdout };
};

export const BOT_RUNNER = path.join('platform', 'gate', 'headless-bot', 'run.mjs');
export const BOT_SEED = '20260914';
export const BOT_HOURS = '10';
export const BOT_CONFIG_FILES = ['spawn-table.json', 'unlocks.json'];
const BOT_PASS_LINE = /^PASS: headless-bot simulatedSeconds=(\d+) unlocks=(\d+)/m;

export interface SmokeInput {
  baseUrl: string;
  sha: string;
  folder: CardFolder;
  checks: readonly ConfigCheck[];
  // A checkout of the merge commit; the bot runs there. Unused for platform.
  botRoot: string;
  botSeconds: number;
  fetchFn?: typeof fetch;
  exec?: BotExec;
  // Per request; a page with no answer by then throws.
  timeoutMs?: number;
  // The first wait before a page request is tried again.
  retryDelayMs?: number;
}

export interface SmokeResult {
  ok: boolean;
  summary: string;
}

// seed-1/config/x.json is served at /config/x.json; platform files have no served path.
export function servedPath(folder: CardFolder, file: string): string | null {
  if (folder !== 'seed-1') return null;
  if (file.startsWith('seed-1/config/') || file.startsWith('seed-1/content/')) return `/${file.slice('seed-1/'.length)}`;
  return null;
}

async function getText(fetchFn: typeof fetch, url: string): Promise<{ status: number; body: string }> {
  const response = await fetchFn(url, { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'backseat-dispatcher' } });
  return { status: response.status, body: await response.text() };
}

function parseJson(body: string): { ok: true; doc: unknown } | { ok: false } {
  try {
    return { ok: true, doc: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

async function checkBuild(fetchFn: typeof fetch, baseUrl: string, sha: string): Promise<string | null> {
  const page = await getText(fetchFn, `${baseUrl}/`);
  if (page.status !== 200) return `GET / returned ${page.status}`;
  if (!page.body.includes('build-sha')) return 'GET / has no build-sha meta';
  const version = await getText(fetchFn, `${baseUrl}/version.json`);
  if (version.status !== 200) return `GET /version.json returned ${version.status}`;
  const parsed = parseJson(version.body);
  if (!parsed.ok) return 'GET /version.json is not JSON';
  const servedSha = typeof parsed.doc === 'object' && parsed.doc !== null ? (parsed.doc as Record<string, unknown>).sha : undefined;
  if (servedSha !== sha) return `version.json sha ${String(servedSha)} differs from merge sha ${sha}`;
  return null;
}

async function checkConfig(fetchFn: typeof fetch, baseUrl: string, folder: CardFolder, checks: readonly ConfigCheck[]): Promise<string | null> {
  for (const check of checks) {
    const route = servedPath(folder, check.file);
    if (!route) continue;
    const served = await getText(fetchFn, `${baseUrl}${route}`);
    if (served.status !== 200) return `GET ${route} returned ${served.status}`;
    const parsed = parseJson(served.body);
    if (!parsed.ok) return `GET ${route} is not JSON`;
    if (!evaluateCheck(check, parsed.doc)) return `served ${route} does not satisfy ${check.line}`;
  }
  return null;
}

type BotRun = { ok: true; summary: string } | { ok: false; reason: string };

// The bot runs at maximum speed until ten simulated hours or the real-second budget elapse;
// the summary reports what the runner printed, not the budget.
async function runBot(fetchFn: typeof fetch, exec: BotExec, baseUrl: string, botRoot: string, seconds: number): Promise<BotRun> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-smoke-'));
  try {
    for (const file of BOT_CONFIG_FILES) {
      const served = await getText(fetchFn, `${baseUrl}/config/${file}`);
      if (served.status !== 200) return { ok: false, reason: `GET /config/${file} returned ${served.status}` };
      await writeFile(path.join(dir, file), served.body, 'utf8');
    }
    const args = [BOT_RUNNER, '--config-dir', dir, '--hours', BOT_HOURS, '--seed', BOT_SEED, '--real-seconds', String(seconds), '--repo-root', botRoot];
    let stdout: string;
    try {
      ({ stdout } = await exec('node', args, { cwd: botRoot, env: childEnv(process.env), timeout: (seconds + 120) * 1000, maxBuffer: 16 * 1024 * 1024 }));
    } catch (error) {
      const detail = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
      return { ok: false, reason: `headless bot failed on the served config: ${detail}` };
    }
    const pass = BOT_PASS_LINE.exec(stdout);
    if (!pass) return { ok: false, reason: 'headless bot exited 0 without a PASS line' };
    return { ok: true, summary: `bot: ${pass[1]} simulated seconds, ${pass[2]} unlocks, budget ${seconds} s` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const SMOKE_TRIES = 3;

class ServerErrorAnswer extends Error {
  readonly response: Response;
  constructor(response: Response) {
    super(`http ${response.status}`);
    this.response = response;
  }
}

// Every page request carries its own timeout and is tried up to three times, with a doubling wait,
// when it throws or answers 5xx: a CDN blip is not a verdict on the build. A 5xx on the last try is
// the answer; a throw on the last try makes runSmoke throw, which is no verdict, and the pipeline
// decides what follows.
function smokeFetch(fetchFn: typeof fetch, timeoutMs: number | undefined, retryDelayMs: number): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    try {
      return await retry(
        async () => {
          const response = await fetchFn(url, { ...init, signal: requestSignal(timeoutMs, init?.signal ?? undefined) });
          if (response.status >= 500) throw new ServerErrorAnswer(response);
          return response;
        },
        SMOKE_TRIES,
        retryDelayMs,
      );
    } catch (error) {
      if (error instanceof ServerErrorAnswer) return error.response;
      throw error;
    }
  }) as typeof fetch;
}

export async function runSmoke(input: SmokeInput): Promise<SmokeResult> {
  const fetchFn = smokeFetch(input.fetchFn ?? fetch, input.timeoutMs, input.retryDelayMs ?? 1000);
  const build = await checkBuild(fetchFn, input.baseUrl, input.sha);
  if (build) return { ok: false, summary: `fail: ${build}` };
  const config = await checkConfig(fetchFn, input.baseUrl, input.folder, input.checks);
  if (config) return { ok: false, summary: `fail: ${config}` };
  if (input.folder === 'seed-1') {
    const bot = await runBot(fetchFn, input.exec ?? defaultExec, input.baseUrl, input.botRoot, input.botSeconds);
    if (!bot.ok) return { ok: false, summary: `fail: ${bot.reason}` };
    return { ok: true, summary: `pass: build ${input.sha.slice(0, 8)} served; ${input.checks.length} config check(s) hold; ${bot.summary}` };
  }
  return { ok: true, summary: `pass: build ${input.sha.slice(0, 8)} served` };
}
