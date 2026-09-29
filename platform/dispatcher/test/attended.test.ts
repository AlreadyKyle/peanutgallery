import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { rolePromptFile } from '../src/session.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttendedAdapter, CHILD_ENV_SWITCHES, DISALLOWED_TOOLS, HOME_DENY, allowedToolRules, attendedSettings, baseToolNames, childEnv, claudeArgs, realPath, refusedTools } from '../src/adapters/attended.js';
import type { AgentEvent, SessionSpec } from '../src/adapters/types.js';

const fixture = readFileSync(new URL('./fixtures/sample-stream.jsonl', import.meta.url), 'utf8');

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
  killed = false;
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
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

// A child that, like Claude Code, keeps running after SIGINT until it has written its result line,
// and exits on SIGTERM or SIGKILL.
class InterruptibleChild extends FakeChild {
  signals: string[] = [];
  override kill(signal?: NodeJS.Signals | number): boolean {
    const name = typeof signal === 'string' ? signal : 'SIGTERM';
    this.signals.push(name);
    if (name === 'SIGINT') return true;
    return super.kill(signal);
  }
}

function adapterWith(child: FakeChild, capture?: { bin?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv }, interruptGraceMs?: number) {
  return new AttendedAdapter({
    claudeBin: 'claude',
    interruptGraceMs,
    spawnFn: (bin, args, options) => {
      if (capture) Object.assign(capture, { bin, args, cwd: options.cwd, env: options.env });
      return child as unknown as ChildProcess;
    },
  });
}

describe('refusedTools and preflight', () => {
  it('names web, sub-agent and MCP tools', () => {
    expect(refusedTools(['Read', 'WebFetch', 'Bash', 'mcp__github__create_issue', 'Agent', 'Task', 'WebSearch'])).toEqual([
      'WebFetch',
      'mcp__github__create_issue',
      'Agent',
      'Task',
      'WebSearch',
    ]);
    expect(refusedTools(['Read', 'Edit'])).toEqual([]);
  });

  it('refuses a role whose tools_json names an excluded tool', async () => {
    const adapter = new AttendedAdapter({ claudeBin: 'claude' });
    await expect(adapter.preflight({ ...spec, roleTools: ['Read', 'WebFetch'] })).rejects.toThrow('excluded tools: WebFetch');
    await expect(adapter.preflight({ ...spec, roleTools: ['mcp__x__y'] })).rejects.toThrow('mcp__x__y');
    await expect(adapter.preflight(spec)).resolves.toBeUndefined();
  });

  it('refuses a session without budget', async () => {
    const adapter = new AttendedAdapter({ claudeBin: 'claude' });
    await expect(adapter.preflight({ ...spec, maxBudgetUsd: 0 })).rejects.toThrow('budget');
  });
});

describe('allowedToolRules', () => {
  it('scopes Bash to the package scripts of the card folder', () => {
    const rules = allowedToolRules(['Read', 'Bash'], 'seed-1');
    expect(rules).toEqual([
      'Read',
      'Bash(pnpm --filter @backseat/seed-1 test:*)',
      'Bash(pnpm --filter @backseat/seed-1 typecheck:*)',
      'Bash(pnpm --filter @backseat/seed-1 bot:*)',
    ]);
    expect(rules).not.toContain('Bash');
    expect(allowedToolRules(['Bash'], 'platform').some((rule) => rule.includes('@backseat/site'))).toBe(true);
  });
});

describe('baseToolNames', () => {
  it('collapses Bash rules to the tool name and removes duplicates', () => {
    expect(baseToolNames(['Read', 'Bash(pnpm test)', 'Bash', 'Edit'])).toEqual(['Read', 'Bash', 'Edit']);
  });
});

describe('childEnv and claudeArgs', () => {
  it('keeps only the allowlisted names and adds the two switches', () => {
    const env = childEnv({
      PATH: '/bin',
      HOME: '/home/agent',
      LANG: 'en_CA.UTF-8',
      LC_ALL: 'C',
      CLAUDECODE: '1',
      CLAUDE_CONFIG_DIR: '/x',
      ANTHROPIC_API_KEY: 'secret',
      ANTHROPIC_BASE_URL: 'https://proxy.local',
    });
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/agent',
      LANG: 'en_CA.UTF-8',
      LC_ALL: 'C',
      ANTHROPIC_BASE_URL: 'https://proxy.local',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
  });

  it('passes no dispatcher secret to the child', () => {
    const secrets = {
      ANTHROPIC_API_KEY: 'a',
      SUPABASE_SERVICE_ROLE_KEY: 'b',
      SUPABASE_ANON_KEY: 'c',
      GITHUB_TOKEN: 'd',
      NETLIFY_AUTH_TOKEN: 'e',
      STRIPE_SECRET_KEY: 'f',
      STRIPE_WEBHOOK_SECRET: 'g',
      OPENAI_API_KEY: 'h',
      GOOGLE_AI_API_KEY: 'i',
      CLAUDE_CODE_OAUTH_TOKEN: 'j',
      PRICE_TABLE_JSON: '{}',
      BOARD_EMAILS: 'board@mobmachine.games',
    };
    const env = childEnv({ PATH: '/bin', ...secrets });
    for (const name of Object.keys(secrets)) {
      expect(env, name).not.toHaveProperty(name);
    }
    expect(Object.values(env)).not.toContain('a');
  });

  it('builds the documented command line', () => {
    const args = claudeArgs(spec, null);
    expect(args.slice(0, 2)).toEqual(['-p', spec.prompt]);
    for (const flag of ['--output-format', '--verbose', '--no-session-persistence', '--max-turns', '--max-budget-usd', '--model', '--permission-mode', '--setting-sources', '--strict-mcp-config', '--mcp-config', '--allowedTools', '--disallowedTools']) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('3.0000');
    expect(args).toContain('--disable-slash-commands');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Edit,Write,Glob,Grep,Bash');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}');
    expect(args.slice(args.indexOf('--disallowedTools') + 1)).toEqual([...DISALLOWED_TOOLS]);
  });
});

describe('AttendedAdapter.run', () => {
  it('spawns claude in the worktree with a scrubbed environment and streams events', async () => {
    const child = new FakeChild();
    const capture: { bin?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv } = {};
    const adapter = adapterWith(child, capture);
    const events: AgentEvent[] = [];
    const run = adapter.run(spec, (event) => void events.push(event), new AbortController().signal);
    child.stdout.write(fixture);
    child.finish(0);
    const result = await run;
    expect(capture.bin).toBe('claude');
    expect(capture.cwd).toBe(spec.worktree);
    expect(capture.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    expect(Object.keys(capture.env ?? {}).filter((key) => key.startsWith('CLAUDE') && !(key in CHILD_ENV_SWITCHES))).toEqual([]);
    expect(result).toMatchObject({ exitCode: 0, killed: false, killReason: null, turns: 3, endSubtype: 'success', totalCostUsd: 0.0517, numTurns: 3, isError: false });
    expect(events.filter((e) => e.type === 'turn_usage')).toHaveLength(3);
    expect(events.at(-1)?.type).toBe('end');
  });

  it('kills the session when the signal aborts', async () => {
    const child = new FakeChild();
    const adapter = adapterWith(child);
    const controller = new AbortController();
    const run = adapter.run(spec, () => undefined, controller.signal);
    child.stdout.write(`${fixture.split('\n')[0]}\n`);
    controller.abort('ceiling');
    const result = await run;
    expect(child.killed).toBe(true);
    expect(result.killed).toBe(true);
    expect(result.killReason).toBe('ceiling');
  });

  describe('interrupting a session', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends SIGINT first, SIGTERM after the grace period and SIGKILL five seconds later', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const child = new InterruptibleChild();
      const adapter = adapterWith(child);
      const controller = new AbortController();
      const run = adapter.run(spec, () => undefined, controller.signal);
      controller.abort('ceiling');
      expect(child.signals).toEqual(['SIGINT']);
      vi.advanceTimersByTime(14_999);
      expect(child.signals).toEqual(['SIGINT']);
      // The fake exits on SIGTERM; mark it alive again to see the SIGKILL that follows a child that ignores it.
      child.kill = (signal?: NodeJS.Signals | number) => {
        child.signals.push(String(signal));
        return true;
      };
      vi.advanceTimersByTime(1);
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM']);
      vi.advanceTimersByTime(4_999);
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM']);
      vi.advanceTimersByTime(1);
      expect(child.signals).toEqual(['SIGINT', 'SIGTERM', 'SIGKILL']);
      child.finish(137);
      const result = await run;
      expect(result).toMatchObject({ killed: true, killReason: 'ceiling' });
    });

    it('sends nothing more once the child has exited after SIGINT', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const child = new InterruptibleChild();
      const controller = new AbortController();
      const run = adapterWith(child).run(spec, () => undefined, controller.signal);
      controller.abort('wall_clock');
      child.finish(130);
      await run;
      vi.advanceTimersByTime(60_000);
      expect(child.signals).toEqual(['SIGINT']);
    });

    it('parses the result line the child writes after SIGINT', async () => {
      const probe = readFileSync(new URL('./fixtures/probe.jsonl', import.meta.url), 'utf8').split('\n').filter((line) => line.length > 0);
      const result = probe.find((line) => line.startsWith('{"type":"result"'))!;
      const child = new InterruptibleChild();
      const events: AgentEvent[] = [];
      const controller = new AbortController();
      const run = adapterWith(child, undefined, 1000).run(spec, (event) => void events.push(event), controller.signal);
      child.stdout.write(`${probe.filter((line) => line !== result).join('\n')}\n`);
      await new Promise((resolve) => setImmediate(resolve));
      controller.abort('stopped');
      expect(child.signals).toEqual(['SIGINT']);
      child.stdout.write(`${result}\n`);
      child.finish(0);
      const outcome = await run;
      expect(outcome).toMatchObject({ killed: true, killReason: 'stopped', endSubtype: 'success' });
      const end = events.find((event) => event.type === 'end');
      expect(end?.type === 'end' && end.modelUsage.length).toBeGreaterThan(0);
      expect(child.signals).toEqual(['SIGINT']);
    });
  });

  it('reports a failure when claude exits without a result line', async () => {
    const child = new FakeChild();
    const adapter = adapterWith(child);
    const run = adapter.run(spec, () => undefined, new AbortController().signal);
    child.stderr.write('claude: authentication is required');
    child.finish(1);
    const result = await run;
    expect(result.isError).toBe(true);
    expect(result.exitCode).toBe(1);
  });
});

describe('role prompt delivery', () => {
  it('appends the role prompt to the system prompt when one is given', () => {
    const args = claudeArgs(spec, 'You are Builder A.');
    const at = args.indexOf('--append-system-prompt');
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe('You are Builder A.');
    expect(at).toBeLessThan(args.indexOf('--permission-mode'));
  });

  it('omits the flag when there is no role prompt', () => {
    expect(claudeArgs(spec, null)).not.toContain('--append-system-prompt');
  });

  it('resolves the role prompt inside the worktree and rejects escapes', () => {
    const role = { prompt_path: 'platform/agents/prompts/builder-a.md' } as Parameters<typeof rolePromptFile>[0];
    expect(rolePromptFile(role, '/repo/.worktrees/card-1')).toBe('/repo/.worktrees/card-1/platform/agents/prompts/builder-a.md');
    expect(rolePromptFile({ prompt_path: '' } as Parameters<typeof rolePromptFile>[0], '/repo/wt')).toBeNull();
    expect(() => rolePromptFile({ prompt_path: '../outside.md' } as Parameters<typeof rolePromptFile>[0], '/repo/wt')).toThrow(/escapes/);
  });
});

describe('the session process group', () => {
  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function gone(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!alive(pid)) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return !alive(pid);
  }

  it('kills a background process the session left behind when the session ends', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'backseat-group-'));
    const pidFile = path.join(dir, 'grandchild.pid');
    const bin = path.join(dir, 'fake-claude.sh');
    // Like test code a session ran: a background process that outlives the command that started it.
    writeFileSync(bin, `#!/bin/sh\nsleep 30 >/dev/null 2>&1 &\necho $! > "${pidFile}"\nexit 0\n`, { mode: 0o755 });
    let grandchild = 0;
    try {
      const adapter = new AttendedAdapter({ claudeBin: bin });
      const result = await adapter.run({ ...spec, worktree: dir }, async () => undefined, new AbortController().signal);
      expect(result.exitCode).toBe(0);
      grandchild = Number(readFileSync(pidFile, 'utf8').trim());
      expect(grandchild).toBeGreaterThan(0);
      expect(await gone(grandchild, 2000)).toBe(true);
    } finally {
      if (grandchild > 0 && alive(grandchild)) process.kill(grandchild, 'SIGKILL');
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the attended sandbox', () => {
  const paths = { worktree: '/work/card-4c2f5a1e', repoRoot: '/Users/board/peanutgallery', home: '/Users/board', tmpdir: '/var/folders/tmp', uid: 501 };

  // These paths do not exist on the machine running the test, so they are taken as already resolved.
  const asIs = (target: string) => target;

  it('runs Bash sandboxed with no host, no way out and no socket but tsx IPC, reading only the worktree, the git data, the pnpm store, the corepack cache and the temp folder', () => {
    const settings = attendedSettings(paths, asIs) as { sandbox: Record<string, unknown>; permissions: { deny: string[] } };
    expect(settings.sandbox).toEqual({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      network: { allowedDomains: [], allowUnixSockets: ['/tmp/claude-501/tsx-501', '/private/tmp/claude-501/tsx-501', '/var/folders/tmp/tsx-501'] },
      filesystem: {
        denyRead: ['/Users/board', '/Users/board/peanutgallery'],
        allowRead: ['/work/card-4c2f5a1e', '/Users/board/peanutgallery/.git', '/Users/board/Library/pnpm/store', '/Users/board/.cache/node/corepack', '/Users/board/Library/Caches/node/corepack', '/var/folders/tmp'],
        allowWrite: ['/work/card-4c2f5a1e', '/var/folders/tmp'],
      },
    });
  });

  it('runs git in the session with no global or system configuration', async () => {
    const child = new FakeChild();
    const capture: { env?: NodeJS.ProcessEnv } = {};
    const adapter = new AttendedAdapter({
      claudeBin: 'claude',
      spawnFn: (_bin, _args, options) => {
        capture.env = options.env;
        setImmediate(() => child.finish(0));
        return child as unknown as ChildProcess;
      },
    });
    await adapter.run(spec, () => undefined, new AbortController().signal);
    expect(capture.env).toMatchObject({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  });

  it('denies the Read, Glob and Grep tools the credential paths, the .env files and the dispatcher, and Edit the git folder', () => {
    const { permissions } = attendedSettings(paths, asIs) as { permissions: { deny: string[] } };
    for (const rel of ['.ssh/**', '.config/**', 'Library/Keychains/**', '.claude/**', '.claude.json', '.netrc']) expect(HOME_DENY).toContain(rel);
    expect(permissions.deny).toEqual([...HOME_DENY.map((rel) => `Read(~/${rel})`), 'Read(//Users/board/peanutgallery/.env*)', 'Read(//Users/board/peanutgallery/platform/dispatcher/**)', 'Edit(//Users/board/peanutgallery/.git/**)']);
  });

  // On the Mac host the dispatcher runs from its code clone, whose .env holds the service-role key, the
  // studio key and the GitHub tokens, and does git in a separate work clone; the role jobs' adapter
  // runs there (main.ts), so the code clone, the host's env folder, the dumps and every .env file under
  // the home folder are denied too.
  it('denies the Read, Glob and Grep tools the code clone, the host env folder, the dumps and every .env file under the home folder', () => {
    const host = { ...paths, worktree: '/Users/board/peanutgallery-host/work-worktrees/job-1a2b3c4d', repoRoot: '/Users/board/peanutgallery-host/work', codeRoot: '/Users/board/peanutgallery-host/code' };
    const { permissions } = attendedSettings(host, asIs) as { permissions: { deny: string[] } };
    for (const rule of [
      'Read(//Users/board/peanutgallery-host/code/.env*)',
      'Read(//Users/board/peanutgallery-host/code/platform/dispatcher/**)',
      'Read(//Users/board/peanutgallery-host/work/.env*)',
      'Read(//Users/board/peanutgallery-host/work/platform/dispatcher/**)',
      'Read(~/peanutgallery-host/env/**)',
      'Read(~/peanutgallery-dumps/**)',
      'Read(~/**/.env)',
      'Read(~/**/.env.*)',
      'Read(~/**/*.env)',
    ]) {
      expect(permissions.deny, rule).toContain(rule);
    }
  });

  it('resolves a path through its symlinks, keeping a tail that does not exist yet', () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backseat-realpath-')));
    try {
      mkdirSync(path.join(dir, 'real', 'clone'), { recursive: true });
      symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
      expect(realPath(path.join(dir, 'link', 'clone'))).toBe(path.join(dir, 'real', 'clone'));
      expect(realPath(path.join(dir, 'link', 'clone', 'not-yet', 'x'))).toBe(path.join(dir, 'real', 'clone', 'not-yet', 'x'));
      expect(realPath('/')).toBe('/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Claude Code 2.1.280 denies a denyRead folder again after the allowRead paths when one of them holds
  // it, which would deny the git data re-allowed inside it (docs/specs/carry-over.md).
  it('never re-allows a path that holds a denied folder, so the git data inside it stays readable', () => {
    const scratch = { worktree: '/tmp-real/T/check/peanutgallery-worktrees/card-sandbox', repoRoot: '/tmp-real/T/check/peanutgallery', home: '/Users/board', tmpdir: '/tmp-real/T', uid: 501 };
    const { sandbox } = attendedSettings(scratch, asIs) as { sandbox: { filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[] } } };
    expect(sandbox.filesystem.denyRead).toEqual(['/Users/board', '/tmp-real/T/check/peanutgallery']);
    expect(sandbox.filesystem.allowRead).toEqual([
      '/tmp-real/T/check/peanutgallery-worktrees/card-sandbox',
      '/tmp-real/T/check/peanutgallery/.git',
      '/Users/board/Library/pnpm/store',
      '/Users/board/.cache/node/corepack',
      '/Users/board/Library/Caches/node/corepack',
    ]);
    // Writes are not re-denied that way, so the temp folder stays writable.
    expect(sandbox.filesystem.allowWrite).toEqual(['/tmp-real/T/check/peanutgallery-worktrees/card-sandbox', '/tmp-real/T']);
    for (const allow of sandbox.filesystem.allowRead) {
      for (const deny of sandbox.filesystem.denyRead) expect(deny === allow || deny.startsWith(`${allow}/`), `${allow} holds ${deny}`).toBe(false);
    }
  });

  it('names every sandbox path resolved, and the repository rules both as given and as resolved', () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backseat-sandbox-link-')));
    try {
      mkdirSync(path.join(dir, 'home', 'peanutgallery', '.git'), { recursive: true });
      mkdirSync(path.join(dir, 'home', 'peanutgallery-worktrees', 'card-4c2f5a1e'), { recursive: true });
      symlinkSync(path.join(dir, 'home'), path.join(dir, 'home-link'));
      const linked = path.join(dir, 'home-link');
      const settings = attendedSettings({ worktree: path.join(linked, 'peanutgallery-worktrees', 'card-4c2f5a1e'), repoRoot: path.join(linked, 'peanutgallery'), home: linked, tmpdir: '/var/folders/tmp', uid: 501 }) as {
        sandbox: { filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[] } };
        permissions: { deny: string[] };
      };
      const home = path.join(dir, 'home');
      expect(settings.sandbox.filesystem.denyRead).toEqual([home, path.join(home, 'peanutgallery')]);
      expect(settings.sandbox.filesystem.allowRead.slice(0, 2)).toEqual([path.join(home, 'peanutgallery-worktrees', 'card-4c2f5a1e'), path.join(home, 'peanutgallery', '.git')]);
      expect(settings.sandbox.filesystem.allowWrite[0]).toBe(path.join(home, 'peanutgallery-worktrees', 'card-4c2f5a1e'));
      expect(settings.permissions.deny).toContain(`Read(/${path.join(linked, 'peanutgallery')}/.env*)`);
      expect(settings.permissions.deny).toContain(`Read(/${path.join(home, 'peanutgallery')}/.env*)`);
      expect(settings.permissions.deny).toContain(`Edit(/${path.join(home, 'peanutgallery')}/.git/**)`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scopes Edit and Write to the worktree, and passes the settings on the command line', () => {
    expect(allowedToolRules(['Read', 'Edit', 'Write'], 'seed-1', '/work/card-4c2f5a1e')).toEqual(['Read', 'Edit(//work/card-4c2f5a1e/**)', 'Write(//work/card-4c2f5a1e/**)']);
    const args = claudeArgs(spec, null, '{"sandbox":{}}', '/work/card-4c2f5a1e');
    expect(args[args.indexOf('--settings') + 1]).toBe('{"sandbox":{}}');
    expect(args.indexOf('--settings')).toBeGreaterThan(args.indexOf('--setting-sources'));
    expect(args).toContain('Edit(//work/card-4c2f5a1e/**)');
  });

  it('installs the dependencies before it starts a session that can run Bash, and runs every session with the sandbox settings', async () => {
    const worktree = mkdtempSync(path.join(os.tmpdir(), 'backseat-attended-'));
    writeFileSync(path.join(worktree, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    const order: string[] = [];
    const child = new FakeChild();
    try {
      const adapter = new AttendedAdapter({
        claudeBin: 'claude',
        repoRoot: '/Users/board/peanutgallery',
        home: '/Users/board',
        tmpdir: '/var/folders/tmp',
        install: async (dir) => {
          order.push(`install ${dir}`);
        },
        spawnFn: (_bin, args) => {
          order.push('spawn');
          const settings = JSON.parse(args[args.indexOf('--settings') + 1]!) as { sandbox: { filesystem: { allowWrite: string[] } } };
          order.push(`writes ${settings.sandbox.filesystem.allowWrite.join(',')}`);
          setImmediate(() => child.finish(0));
          return child as unknown as ChildProcess;
        },
      });
      await adapter.run({ ...spec, worktree }, () => undefined, new AbortController().signal);
      expect(order).toEqual([`install ${worktree}`, 'spawn', `writes ${realPath(worktree)},${realPath('/var/folders/tmp')}`]);
      order.length = 0;
      const second = new FakeChild();
      const readOnly = new AttendedAdapter({
        claudeBin: 'claude',
        install: async () => {
          order.push('install');
        },
        spawnFn: () => {
          setImmediate(() => second.finish(0));
          return second as unknown as ChildProcess;
        },
      });
      await readOnly.run({ ...spec, worktree, roleTools: ['Read', 'Glob', 'Grep'] }, () => undefined, new AbortController().signal);
      expect(order).toEqual([]);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });
});

