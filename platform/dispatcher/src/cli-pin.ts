// The Claude Code pin (docs/specs/agent-upkeep.md, R33). platform/ops/mac/claude-code-pin.json
// records the version attended sessions run on and the sandbox:check --positive PASS line that
// version passed; the board's one sudo script turns Claude Code's auto-updater off in its managed
// settings. Before every attended session the adapter compares `claude --version` with the pin and
// pauses the card with cli_version when they differ, so an update that has not passed the sandbox
// check never runs a card. The Janitor's daily check records the same difference as a finding. A
// new version is a board pull request that updates the pin file with a fresh PASS line.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const PIN_PATH = path.join('platform', 'ops', 'mac', 'claude-code-pin.json');
// How long one `claude --version` answer is reused in a process.
export const VERSION_CACHE_MS = 60_000;
export const CLI_VERSION_CHECK = 'cli_version';

export interface ClaudeCodePin {
  version: string;
  sandbox_check: string;
}

// "2.1.280 (Claude Code)" is 2.1.280; anything without a version is null.
export function parseClaudeVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function parsePin(text: string): ClaudeCodePin {
  const pin: unknown = JSON.parse(text);
  if (typeof pin !== 'object' || pin === null) throw new Error('the Claude Code pin is not an object');
  const { version, sandbox_check: sandboxCheck } = pin as Record<string, unknown>;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('the Claude Code pin has no version');
  if (typeof sandboxCheck !== 'string' || !sandboxCheck.includes('PASS') || !sandboxCheck.includes(version)) {
    throw new Error("the Claude Code pin's sandbox_check is not a PASS line on its version");
  }
  return { version, sandbox_check: sandboxCheck };
}

export type VersionReader = () => Promise<string>;

export function claudeVersionReader(claudeBin: string): VersionReader {
  return async () => (await execFileAsync(claudeBin, ['--version'], { timeout: 30_000 })).stdout;
}

export type PinState = { ok: true; version: string } | { ok: false; installed: string | null; pinned: string | null; detail: string };

export interface CliPinOptions {
  pinFile: string;
  readVersion: VersionReader;
  now?: () => number;
}

// Reads the pin and the installed version, the version cached for VERSION_CACHE_MS. A pin file or a
// version that cannot be read is a mismatch: no session runs on a CLI no one checked.
export class CliPin {
  private cached: { at: number; output: string } | null = null;
  constructor(private readonly options: CliPinOptions) {}

  async state(): Promise<PinState> {
    let pin: ClaudeCodePin;
    try {
      pin = parsePin(await readFile(this.options.pinFile, 'utf8'));
    } catch (error) {
      return { ok: false, installed: null, pinned: null, detail: `the Claude Code pin could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
    const now = (this.options.now ?? Date.now)();
    let output: string;
    try {
      if (this.cached === null || now - this.cached.at >= VERSION_CACHE_MS) {
        this.cached = { at: now, output: await this.options.readVersion() };
      }
      output = this.cached.output;
    } catch (error) {
      return { ok: false, installed: null, pinned: pin.version, detail: `claude --version failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    const installed = parseClaudeVersion(output);
    if (installed === pin.version) return { ok: true, version: installed };
    return {
      ok: false,
      installed,
      pinned: pin.version,
      detail: `Claude Code ${installed ?? 'of no known version'} is installed but the pin is ${pin.version}. Run sudo bash platform/ops/mac/pin-claude-code.sh on the pinned version, or update the pin in a board pull request with a fresh sandbox:check --positive PASS line.`,
    };
  }
}

export function defaultCliPin(codeRoot: string, claudeBin: string): CliPin {
  return new CliPin({ pinFile: path.join(codeRoot, PIN_PATH), readVersion: claudeVersionReader(claudeBin) });
}
