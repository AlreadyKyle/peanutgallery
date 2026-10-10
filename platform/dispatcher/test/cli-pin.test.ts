// The Claude Code pin (docs/specs/agent-upkeep.md): the pin file parses and its sandbox-check line is
// a PASS on its own version; the installed version is read once a minute; the attended adapter
// refuses to start a session on another version, pausing the card with cli_version (a SessionPaused
// becomes a paused card with that failing check, pipeline.test.ts), and the dispatcher's own
// adapters carry the pin.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AttendedAdapter } from '../src/adapters/attended.js';
import { createAdapter } from '../src/adapters/factory.js';
import { SessionPaused, type SessionSpec } from '../src/adapters/types.js';
import { CliPin, PIN_PATH, VERSION_CACHE_MS, parseClaudeVersion, parsePin } from '../src/cli-pin.js';
import type { DispatcherConfig } from '../src/config.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PIN = { version: '2.1.280', sandbox_check: 'PASS: attended sandbox (sandbox:check --positive on Claude Code 2.1.280)' };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pinFile(content: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cli-pin-'));
  dirs.push(dir);
  const file = path.join(dir, 'claude-code-pin.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

const spec: SessionSpec = {
  cardId: 'card-1',
  worktree: os.tmpdir(),
  prompt: 'p',
  systemPromptFile: null,
  model: 'builder-class',
  roleTools: ['Read'],
  folder: 'seed-1',
  maxTurns: 5,
  maxBudgetUsd: 1,
  spentUsd: 0,
  roleId: 'r-builder-a',
  allowedPaths: ['seed-1/'],
};

describe('the pin file', () => {
  it("is the repository's pin: a version and a sandbox-check PASS line on that version", () => {
    const pin = parsePin(readFileSync(path.join(REPO_ROOT, PIN_PATH), 'utf8'));
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pin.sandbox_check).toContain('PASS');
    expect(pin.sandbox_check).toContain(pin.version);
  });

  it('refuses a pin with no version, or whose line is not a PASS on its version', () => {
    expect(() => parsePin(JSON.stringify({ sandbox_check: 'PASS 2.1.280' }))).toThrow(/no version/);
    expect(() => parsePin(JSON.stringify({ version: '2.1.280', sandbox_check: 'FAIL: attended sandbox 2.1.280' }))).toThrow(/PASS line/);
    expect(() => parsePin(JSON.stringify({ version: '2.1.280', sandbox_check: 'PASS: attended sandbox on 2.1.139' }))).toThrow(/PASS line/);
  });

  it('reads the version from claude --version', () => {
    expect(parseClaudeVersion('2.1.280 (Claude Code)\n')).toBe('2.1.280');
    expect(parseClaudeVersion('command not found')).toBeNull();
  });
});

describe('CliPin', () => {
  it('is ok on the pinned version and names both versions on another', async () => {
    const file = pinFile(PIN);
    expect(await new CliPin({ pinFile: file, readVersion: async () => '2.1.280 (Claude Code)' }).state()).toEqual({ ok: true, version: '2.1.280' });
    const other = await new CliPin({ pinFile: file, readVersion: async () => '2.1.283 (Claude Code)' }).state();
    expect(other).toMatchObject({ ok: false, installed: '2.1.283', pinned: '2.1.280' });
    expect(other.ok ? '' : other.detail).toMatch(/2\.1\.283 is installed but the pin is 2\.1\.280.*pin-claude-code\.sh/);
  });

  it('fails closed when the pin or the version cannot be read', async () => {
    expect(await new CliPin({ pinFile: path.join(os.tmpdir(), 'no-such-pin.json'), readVersion: async () => '2.1.280' }).state()).toMatchObject({ ok: false, pinned: null });
    expect(
      await new CliPin({
        pinFile: pinFile(PIN),
        readVersion: async () => {
          throw new Error('spawn claude ENOENT');
        },
      }).state(),
    ).toMatchObject({ ok: false, installed: null, pinned: '2.1.280', detail: expect.stringMatching(/ENOENT/) });
  });

  it('reads claude --version once a minute', async () => {
    let clock = 0;
    let reads = 0;
    const pin = new CliPin({
      pinFile: pinFile(PIN),
      readVersion: async () => {
        reads += 1;
        return '2.1.280 (Claude Code)';
      },
      now: () => clock,
    });
    await pin.state();
    clock = VERSION_CACHE_MS - 1;
    await pin.state();
    expect(reads).toBe(1);
    clock = VERSION_CACHE_MS;
    await pin.state();
    expect(reads).toBe(2);
  });
});

describe('the attended adapter and the pin', () => {
  it('pauses with cli_version and starts no session when claude --version differs from the pin', async () => {
    let spawned = 0;
    const adapter = new AttendedAdapter({
      claudeBin: 'claude',
      install: async () => undefined,
      spawnFn: () => {
        spawned += 1;
        throw new Error('no session may start');
      },
      cliPin: new CliPin({ pinFile: pinFile(PIN), readVersion: async () => '2.1.283 (Claude Code)' }),
    });
    const run = adapter.run(spec, () => undefined, new AbortController().signal);
    await expect(run).rejects.toBeInstanceOf(SessionPaused);
    await expect(run).rejects.toMatchObject({ failingCheck: 'cli_version', message: expect.stringMatching(/2\.1\.283 is installed but the pin is 2\.1\.280/) });
    expect(spawned).toBe(0);
  });

  it('starts the session on the pinned version', async () => {
    let spawned = 0;
    const adapter = new AttendedAdapter({
      claudeBin: 'claude',
      install: async () => undefined,
      spawnFn: () => {
        spawned += 1;
        throw new Error('spawned');
      },
      cliPin: new CliPin({ pinFile: pinFile(PIN), readVersion: async () => '2.1.280 (Claude Code)' }),
    });
    await expect(adapter.run(spec, () => undefined, new AbortController().signal)).rejects.toThrow('spawned');
    expect(spawned).toBe(1);
  });

  it("is carried by the dispatcher's attended adapter, read from the code root", () => {
    const config = {
      codeRoot: '/code',
      repoRoot: '/repo',
      claudeBin: 'claude',
    } as unknown as DispatcherConfig;
    const adapter = createAdapter(config) as unknown as { cliPin: { options: { pinFile: string } } | null };
    expect(adapter.cliPin?.options.pinFile).toBe(path.join('/code', PIN_PATH));
  });
});

