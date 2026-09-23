// The one public-text filter (docs/specs/agent-workflows.md): every agent-written string a stranger
// can read is scanned by the gate's own platform/gate/banned-phrases.sh before it is written, so one
// implementation of the deny-list exists. The strings go to a scratch file scanned as a commit
// message, which applies every list, trademarks included. A hit refuses the write, and so does a
// scan that cannot run: a missing script, a timeout, or any exit other than 0 with a PASS line.
// studio-reports and design-review call assertPublicTextClean before their writes too.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// The gate in the checkout this file runs from, never in a worktree an agent can change.
export const BANNED_PHRASES_SCRIPT = path.resolve(import.meta.dirname, '..', '..', 'gate', 'banned-phrases.sh');
export const SCAN_TIMEOUT_MS = 60_000;
// What the scan's child process sees: enough to find bash, awk and node, and nothing secret.
const SCAN_ENV_NAMES = ['PATH', 'HOME', 'TMPDIR', 'LANG'];

export type PublicTextResult = { ok: true } | { ok: false; detail: string };

export class PublicTextRefused extends Error {
  constructor(detail: string) {
    super(`public text refused: ${detail}`);
    this.name = 'PublicTextRefused';
  }
}

export interface ScanOptions {
  script?: string;
  timeoutMs?: number;
}

function scanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of SCAN_ENV_NAMES) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

// Scans the strings; ok only when the script ran and printed PASS.
export async function scanPublicText(strings: readonly string[], options: ScanOptions = {}): Promise<PublicTextResult> {
  const script = options.script ?? BANNED_PHRASES_SCRIPT;
  if (!existsSync(script)) return { ok: false, detail: `the deny-list scan could not run: ${path.basename(script)} is missing` };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'public-text-'));
  try {
    const file = path.join(dir, 'public-text.txt');
    await writeFile(file, `${strings.join('\n')}\n`, 'utf8');
    try {
      const { stdout } = await execFileAsync('bash', [script, '--commit-message-file', file], { env: scanEnv(), timeout: options.timeoutMs ?? SCAN_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
      const first = stdout.split('\n')[0] ?? '';
      if (first.startsWith('PASS:')) return { ok: true };
      return { ok: false, detail: `the deny-list scan could not run: ${first.slice(0, 200) || 'no output'}` };
    } catch (error) {
      const failure = error as { code?: number | string; stdout?: string; killed?: boolean };
      const first = String(failure.stdout ?? '').split('\n')[0] ?? '';
      if (failure.code === 1 && first.startsWith('FAIL:')) return { ok: false, detail: `a deny-list hit: ${first.slice(0, 200)}` };
      return { ok: false, detail: `the deny-list scan could not run: ${failure.killed ? 'timed out' : first.slice(0, 200) || `exit ${String(failure.code ?? 'unknown')}`}` };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Throws PublicTextRefused unless every string passes.
export async function assertPublicTextClean(strings: readonly string[], options: ScanOptions = {}): Promise<void> {
  const result = await scanPublicText(strings, options);
  if (!result.ok) throw new PublicTextRefused(result.detail);
}
