// The one public-text filter (docs/specs/agent-workflows.md): every agent-written string a stranger
// can read is scanned by the gate's own platform/gate/banned-phrases.sh before it is written, so one
// implementation of the deny-list exists. The strings go to a scratch file scanned as a commit
// message, which applies every list, trademarks included. The gate's secret-scan.sh then reads the
// same file, so a credential a role session happened to read never reaches a public row. A hit
// refuses the write, and so does a scan that cannot run: a missing script, a timeout, or any exit
// other than 0 with a PASS line. studio-reports and design-review call assertPublicTextClean before
// their writes too.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// The gate in the checkout this file runs from, never in a worktree an agent can change.
export const BANNED_PHRASES_SCRIPT = path.resolve(import.meta.dirname, '..', '..', 'gate', 'banned-phrases.sh');
export const SECRET_SCAN_SCRIPT = path.resolve(import.meta.dirname, '..', '..', 'gate', 'secret-scan.sh');
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
  // banned-phrases.sh; tests pass another.
  script?: string;
  // secret-scan.sh; tests pass another.
  secretScript?: string;
  timeoutMs?: number;
}

// One of the two scans: its name in a refusal, what a hit is called, and its arguments after the file.
interface Scan {
  name: string;
  hit: string;
  script: string;
  args: (file: string) => string[];
}

function scanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of SCAN_ENV_NAMES) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

// One scan over the file; ok only when the script ran and printed PASS.
async function runScan(scan: Scan, file: string, timeoutMs: number): Promise<PublicTextResult> {
  try {
    const { stdout } = await execFileAsync('bash', [scan.script, ...scan.args(file)], { env: scanEnv(), timeout: timeoutMs, maxBuffer: 1024 * 1024 });
    const first = stdout.split('\n')[0] ?? '';
    if (first.startsWith('PASS:')) return { ok: true };
    return { ok: false, detail: `${scan.name} could not run: ${first.slice(0, 200) || 'no output'}` };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; killed?: boolean };
    const first = String(failure.stdout ?? '').split('\n')[0] ?? '';
    if (failure.code === 1 && first.startsWith('FAIL:')) return { ok: false, detail: `${scan.hit}: ${first.slice(0, 200)}` };
    return { ok: false, detail: `${scan.name} could not run: ${failure.killed ? 'timed out' : first.slice(0, 200) || `exit ${String(failure.code ?? 'unknown')}`}` };
  }
}

// Scans the strings with the deny-list, then the secret scan; ok only when both ran and passed.
export async function scanPublicText(strings: readonly string[], options: ScanOptions = {}): Promise<PublicTextResult> {
  const scans: Scan[] = [
    { name: 'the deny-list scan', hit: 'a deny-list hit', script: options.script ?? BANNED_PHRASES_SCRIPT, args: (file) => ['--commit-message-file', file] },
    { name: 'the secret scan', hit: 'a credential shape', script: options.secretScript ?? SECRET_SCAN_SCRIPT, args: (file) => [file] },
  ];
  const missing = scans.find((scan) => !existsSync(scan.script));
  if (missing) return { ok: false, detail: `${missing.name} could not run: ${path.basename(missing.script)} is missing` };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'public-text-'));
  try {
    const file = path.join(dir, 'public-text.txt');
    await writeFile(file, `${strings.join('\n')}\n`, 'utf8');
    for (const scan of scans) {
      const result = await runScan(scan, file, options.timeoutMs ?? SCAN_TIMEOUT_MS);
      if (!result.ok) return result;
    }
    return { ok: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Throws PublicTextRefused unless every string passes.
export async function assertPublicTextClean(strings: readonly string[], options: ScanOptions = {}): Promise<void> {
  const result = await scanPublicText(strings, options);
  if (!result.ok) throw new PublicTextRefused(result.detail);
}
