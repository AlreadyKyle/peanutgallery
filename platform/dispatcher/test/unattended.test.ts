import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { childEnv, claudeArgs } from '../src/adapters/claude-cli.js';
import { STUDIO_KEY_ENV, UnattendedAdapter, unattendedEnv } from '../src/adapters/unattended.js';
import type { AgentEvent, SessionSpec } from '../src/adapters/types.js';

const fixture = readFileSync(new URL('./fixtures/sample-stream.jsonl', import.meta.url), 'utf8');
const STUDIO_KEY = 'studio-org-key';

const spec: SessionSpec = {
  cardId: '4c2f5a1e-7b3d-4e8a-9f01-2a3b4c5d6e7f',
  worktree: '/repo/.worktrees/card-4c2f5a1e',
  prompt: 'Card 4c2f5a1e: gatherer cost',
  systemPromptFile: null,
  model: 'claude-sonnet-5',
  roleTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
  folder: 'seed-1',
  maxTurns: 60,
  maxBudgetUsd: 3,
};

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kill(signal?: NodeJS.Signals | number): boolean {
    this.signalCode = typeof signal === 'string' ? signal : 'SIGTERM';
    this.stdout.end();
    this.emit('close', null, this.signalCode);
    return true;
  }
  finish(code: number): void {
    this.exitCode = code;
    this.stdout.end();
    this.emit('close', code, null);
  }
}

// The dispatcher's own environment as the founder's machine would have it: the founder's key,
// every other secret, and the shell basics.
const DISPATCHER_ENV: NodeJS.ProcessEnv = {
  PATH: '/bin',
  HOME: '/home/agent',
  LANG: 'en_CA.UTF-8',
  LC_ALL: 'C',
  ANTHROPIC_BASE_URL: 'https://proxy.local',
  ANTHROPIC_API_KEY: 'founder-key',
  STUDIO_ANTHROPIC_API_KEY: STUDIO_KEY,
  SUPABASE_SERVICE_ROLE_KEY: 'b',
  SUPABASE_ANON_KEY: 'c',
  GITHUB_TOKEN: 'd',
  NETLIFY_AUTH_TOKEN: 'e',
  STRIPE_SECRET_KEY: 'f',
  STRIPE_WEBHOOK_SECRET: 'g',
  OPENAI_API_KEY: 'h',
  GOOGLE_AI_API_KEY: 'i',
  CLAUDE_CODE_OAUTH_TOKEN: 'j',
  CLAUDECODE: 'k',
  CLAUDE_CONFIG_DIR: '/x',
  PRICE_TABLE_JSON: '{}',
  BOARD_EMAILS: 'board@peanutgallery.games',
};
const SECRET_NAMES = Object.keys(DISPATCHER_ENV).filter((name) => !['PATH', 'HOME', 'LANG', 'LC_ALL', 'ANTHROPIC_BASE_URL'].includes(name));

describe('UnattendedAdapter', () => {
  it('runs in unattended mode', () => {
    expect(new UnattendedAdapter({ claudeBin: 'claude', studioApiKey: STUDIO_KEY }).mode).toBe('unattended');
  });

  it('refuses to exist without a studio key', () => {
    expect(STUDIO_KEY_ENV).toBe('STUDIO_ANTHROPIC_API_KEY');
    for (const studioApiKey of ['', '   ', '\n']) {
      expect(() => new UnattendedAdapter({ claudeBin: 'claude', studioApiKey })).toThrow('STUDIO_ANTHROPIC_API_KEY is required in unattended mode');
    }
  });
});

describe('unattendedEnv', () => {
  it('is the attended allowlist plus the studio key as ANTHROPIC_API_KEY', () => {
    const env = unattendedEnv(DISPATCHER_ENV, STUDIO_KEY);
    expect(env).toEqual({ ...childEnv(DISPATCHER_ENV), ANTHROPIC_API_KEY: STUDIO_KEY });
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/agent',
      LANG: 'en_CA.UTF-8',
      LC_ALL: 'C',
      ANTHROPIC_BASE_URL: 'https://proxy.local',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ANTHROPIC_API_KEY: STUDIO_KEY,
    });
  });

  it("never carries the dispatcher's own ANTHROPIC_API_KEY, the studio key under its own name, or any other secret", () => {
    const env = unattendedEnv(DISPATCHER_ENV, STUDIO_KEY);
    expect(env.ANTHROPIC_API_KEY).toBe(STUDIO_KEY);
    expect(Object.values(env)).not.toContain('founder-key');
    expect(env).not.toHaveProperty('STUDIO_ANTHROPIC_API_KEY');
    for (const name of SECRET_NAMES.filter((n) => n !== 'ANTHROPIC_API_KEY')) {
      expect(env, name).not.toHaveProperty(name);
    }
    for (const value of SECRET_NAMES.map((name) => DISPATCHER_ENV[name]).filter((v) => v !== STUDIO_KEY)) {
      expect(Object.values(env)).not.toContain(value);
    }
  });
});

describe('UnattendedAdapter.run', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [name, value] of Object.entries(DISPATCHER_ENV)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('spawns the attended command line with the studio key as the only credential', async () => {
    const child = new FakeChild();
    const capture: { bin?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv } = {};
    const adapter = new UnattendedAdapter({
      claudeBin: 'claude',
      studioApiKey: STUDIO_KEY,
      spawnFn: (bin, args, options) => {
        Object.assign(capture, { bin, args, cwd: options.cwd, env: options.env });
        return child as unknown as ChildProcess;
      },
    });
    const events: AgentEvent[] = [];
    const run = adapter.run(spec, (event) => void events.push(event), new AbortController().signal);
    child.stdout.write(fixture);
    child.finish(0);
    const result = await run;

    expect(capture.bin).toBe('claude');
    expect(capture.cwd).toBe(spec.worktree);
    expect(capture.args).toEqual(claudeArgs(spec, null));
    expect(capture.env?.ANTHROPIC_API_KEY).toBe(STUDIO_KEY);
    expect(capture.env).toEqual(unattendedEnv(process.env, STUDIO_KEY));
    expect(Object.values(capture.env ?? {})).not.toContain('founder-key');
    for (const name of SECRET_NAMES.filter((n) => n !== 'ANTHROPIC_API_KEY')) {
      expect(capture.env, name).not.toHaveProperty(name);
    }
    expect(result).toMatchObject({ exitCode: 0, killed: false, turns: 3, endSubtype: 'success', isError: false });
    expect(events[0]).toMatchObject({ type: 'start', apiKeySource: 'none' });
    expect(events.at(-1)?.type).toBe('end');
  });
});
