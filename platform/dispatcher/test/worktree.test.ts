import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, cp, mkdtemp, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HaltedError, haltDispatcher, resetHalt } from '../src/halt.js';
import {
  AGENT_EMAIL,
  branchName,
  changedFiles,
  commitLane,
  commitMessage,
  commitTitle,
  commitTrailers,
  createWorktree,
  defaultGitRunner,
  git,
  GIT_ENV,
  GIT_SWITCHES,
  GIT_TIMEOUT_MS,
  gitArgs,
  gitAuthEnv,
  isKernelPath,
  KERNEL_NAMES,
  KERNEL_PATHS,
  NO_HOOKS,
  lanePaths,
  outsideLane,
  parseStatus,
  protectedPaths,
  removeWorktree,
  setGitRunner,
  shortId,
  singleLineTitle,
  snapshotGitState,
  verifyCardCommit,
  worktreePath,
  type CommitInput,
  type GitCall,
} from '../src/worktree.js';

const CARD_ID = '4c2f5a1e-7b3d-4e8a-9f01-2a3b4c5d6e7f';

const input: CommitInput = {
  cardId: CARD_ID,
  title: 'spawn table row gatherer: baseCost changes from 10 to 11',
  lane: 'config',
  executor: 'Builder A',
  acceptance: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11',
};

describe('pure helpers', () => {
  it('derives the short id, branch and worktree path from the card id', () => {
    expect(shortId(CARD_ID)).toBe('4c2f5a1e');
    expect(branchName(CARD_ID, 'config')).toBe('card/4c2f5a1e-config');
    expect(branchName(CARD_ID, 'code')).toBe('card/4c2f5a1e-code');
    expect(worktreePath('/w', CARD_ID)).toBe(path.join('/w', 'card-4c2f5a1e'));
  });

  it('scopes lanes to their folders', () => {
    expect(lanePaths('seed-1', 'config')).toEqual(['seed-1/config', 'seed-1/content']);
    expect(lanePaths('seed-1', 'code')).toEqual(['seed-1']);
    expect(lanePaths('platform', 'code')).toEqual(['platform/site']);
    expect(lanePaths('platform', 'config')).toEqual([]);
  });

  function gateList(name: string): string[] {
    const file = readFileSync(path.resolve(import.meta.dirname, '..', '..', 'gate', name), 'utf8');
    return file.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  it('keeps the kernel list equal to the gate file', () => {
    expect([...KERNEL_PATHS]).toEqual(gateList('kernel-paths.txt'));
  });

  it('keeps the kernel names equal to the gate file, with * as the only wildcard', () => {
    expect([...KERNEL_NAMES]).toEqual(gateList('kernel-names.txt'));
    for (const name of KERNEL_NAMES) expect(name).toMatch(/^[A-Za-z0-9._*-]+$/);
  });

  it('treats a kernel name at any depth as a kernel path', () => {
    expect(isKernelPath('seed-1/content/CLAUDE.md')).toBe(true);
    expect(isKernelPath('seed-1/render/.claude/settings.json')).toBe(true);
    expect(isKernelPath('seed-1/vitest.config.ts')).toBe(true);
    expect(isKernelPath('seed-1/config/vitest.workspace.json')).toBe(true);
    expect(isKernelPath('platform/site/src/.npmrc')).toBe(true);
    // pnpm 11 loads .pnpmfile.mjs as well as .pnpmfile.cjs.
    expect(isKernelPath('.pnpmfile.cjs')).toBe(true);
    expect(isKernelPath('.pnpmfile.mjs')).toBe(true);
    expect(isKernelPath('seed-1/.pnpmfile.mjs')).toBe(true);
    expect(isKernelPath('platform/gate/ship-gate.sh')).toBe(true);
    expect(isKernelPath('seed-1/content/CLAUDE.md.txt')).toBe(false);
    expect(isKernelPath('seed-1/content/claude/notes.json')).toBe(false);
    expect(isKernelPath('seed-1/render/vite.configs/a.ts')).toBe(false);
    expect(isKernelPath('seed-1/config/spawn-table.json')).toBe(false);
  });

  it('matches kernel names and paths without regard to case, as a case-insensitive checkout reads them', () => {
    expect(isKernelPath('seed-1/content/claude.md')).toBe(true);
    expect(isKernelPath('.Claude/settings.json')).toBe(true);
    expect(isKernelPath('seed-1/Vite.Config.ts')).toBe(true);
    expect(isKernelPath('.GitHub/workflows/x.yml')).toBe(true);
    expect(isKernelPath('Platform/Gate/ship-gate.sh')).toBe(true);
    expect(isKernelPath('SEED-1/SIM/INVARIANTS.TS')).toBe(true);
    expect(outsideLane(['seed-1/content/claude.md', 'seed-1/Content/strings.json'], lanePaths('seed-1', 'config'))).toEqual([
      'seed-1/content/claude.md',
      'seed-1/Content/strings.json',
    ]);
  });

  it('lets * in a kernel name match any character, a newline included, as the shell glob does', () => {
    expect(isKernelPath('seed-1/vite.config.\n.ts')).toBe(true);
    expect(isKernelPath('seed-1/vitest.config.a\nb')).toBe(true);
  });

  it('refuses kernel files in every lane and names the ones inside a lane', () => {
    expect(outsideLane(['seed-1/sim/invariants.ts', 'seed-1/sim/sim.ts', 'seed-1/bots/greedy.ts'], lanePaths('seed-1', 'code'))).toEqual(['seed-1/sim/invariants.ts', 'seed-1/bots/greedy.ts']);
    expect(outsideLane(['platform/gate/ship-gate.sh', 'platform/site/netlify.toml', 'platform/site/src/App.tsx'], lanePaths('platform', 'code'))).toEqual(['platform/gate/ship-gate.sh', 'platform/site/netlify.toml']);
    expect(outsideLane(['platform/site/scripts/live-check.mjs', 'platform/site/scripts-notes.md'], lanePaths('platform', 'code'))).toEqual(['platform/site/scripts/live-check.mjs']);
    expect(outsideLane(['seed-1/sim/invariants.tsx'], lanePaths('seed-1', 'code'))).toEqual([]);
    expect(outsideLane(['seed-1/content/CLAUDE.md', 'seed-1/config/spawn-table.json'], lanePaths('seed-1', 'config'))).toEqual(['seed-1/content/CLAUDE.md']);
    expect(outsideLane(['seed-1/render/.claude/settings.json', 'seed-1/vitest.config.ts', 'seed-1/render/main.ts'], lanePaths('seed-1', 'code'))).toEqual([
      'seed-1/render/.claude/settings.json',
      'seed-1/vitest.config.ts',
    ]);
    expect(outsideLane(['platform/site/src/CLAUDE.md', 'platform/site/src/App.tsx'], lanePaths('platform', 'code'))).toEqual(['platform/site/src/CLAUDE.md']);
    expect(protectedPaths(lanePaths('seed-1', 'config'))).toEqual([]);
    expect(protectedPaths(lanePaths('seed-1', 'code'))).toContain('seed-1/sim/invariants.ts');
  });

  it('reports files outside the allowed paths', () => {
    const allowed = ['seed-1/config', 'seed-1/content'];
    expect(outsideLane(['seed-1/config/spawn-table.json', 'seed-1/content/strings.json'], allowed)).toEqual([]);
    expect(outsideLane(['seed-1/config/spawn-table.json', 'seed-1/sim/index.ts', 'seed-1/configuration.md'], allowed)).toEqual(['seed-1/sim/index.ts', 'seed-1/configuration.md']);
    expect(outsideLane(['platform/site/index.html'], ['platform/site'])).toEqual([]);
  });

  it('parses a rename or copy entry into both names, in either status column', () => {
    expect(parseStatus('R  seed-1/content/x.json\0seed-1/tests/invariants.test.ts\0 M seed-1/config/a.json\0')).toEqual([
      'seed-1/content/x.json',
      'seed-1/tests/invariants.test.ts',
      'seed-1/config/a.json',
    ]);
    expect(parseStatus('C  b.json\0a.json\0 R d.json\0c.json\0?? e.json\0')).toEqual(['b.json', 'a.json', 'd.json', 'c.json', 'e.json']);
  });

  it('keeps titles on one line and within the limit', () => {
    expect(singleLineTitle('raise\nthe\tcost   now')).toBe('raise the cost now');
    expect(singleLineTitle(`${'a'.repeat(80)}`)).toHaveLength(72);
    expect(singleLineTitle('x'.repeat(80)).endsWith('…')).toBe(true);
  });

  it('writes the commit title, trailers and message in the documented shape', () => {
    expect(commitTitle(input)).toBe('card 4c2f5a1e: spawn table row gatherer: baseCost changes from 10 to 11');
    expect(commitTrailers(input)).toBe(
      [`Card-Id: ${CARD_ID}`, 'Lane: config', 'Executor: Builder A', `Acceptance: ${input.acceptance}`].join('\n'),
    );
    expect(commitMessage(input)).toBe(`${commitTitle(input)}\n\n${commitTrailers(input)}\n`);
  });

  it('scopes the token to github.com and passes it in the environment, never as an argument', () => {
    const env = gitAuthEnv('token');
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    expect(env.GIT_CONFIG_VALUE_0).toMatch(/^AUTHORIZATION: basic /);
    expect(Buffer.from(env.GIT_CONFIG_VALUE_0!.split('basic ')[1]!, 'base64').toString()).toBe('x-access-token:token');
    expect(Object.values(env).join(' ')).not.toContain('-c');
  });
});

describe('commitLane in a temporary repository', () => {
  let dir: string;
  let repo: string;
  const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-worktree-'));
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
    repo = path.join(dir, 'repo');
    await mkdir(path.join(repo, 'seed-1', 'config'), { recursive: true });
    await mkdir(path.join(repo, 'seed-1', 'sim'), { recursive: true });
    await git(['init', '-q', '--initial-branch=main', repo], dir);
    await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":10}]}\n', 'utf8');
    await writeFile(path.join(repo, 'seed-1', 'sim', 'index.ts'), 'export const version = 1;\n', 'utf8');
    await git(['add', '-A'], repo);
    await git(['-c', 'user.name=Dispatcher test', `-c`, `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'initial'], repo);
  });

  afterAll(async () => {
    if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
    if (savedNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = savedNoSystem;
    await rm(dir, { recursive: true, force: true });
  });

  it('reports nothing to commit when the lane paths are unchanged or absent', async () => {
    expect(await commitLane(repo, ['seed-1/config', 'seed-1/content'], input)).toEqual({ committed: false });
    expect(await commitLane(repo, ['seed-1/content'], input)).toEqual({ committed: false });
  });

  it('reads the first status entry whole and reports a rename by both its names', async () => {
    await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":12}]}\n', 'utf8');
    expect(await changedFiles(repo)).toEqual(['seed-1/config/spawn-table.json']);
    await git(['mv', 'seed-1/sim/index.ts', 'seed-1/sim/main.ts'], repo);
    expect((await changedFiles(repo)).sort()).toEqual(['seed-1/config/spawn-table.json', 'seed-1/sim/index.ts', 'seed-1/sim/main.ts']);
    await git(['config', 'status.renames', 'copies'], repo);
    expect((await changedFiles(repo)).sort()).toEqual(['seed-1/config/spawn-table.json', 'seed-1/sim/index.ts', 'seed-1/sim/main.ts']);
    await git(['config', '--unset', 'status.renames'], repo);
    await git(['mv', 'seed-1/sim/main.ts', 'seed-1/sim/index.ts'], repo);
    await git(['checkout', '--', 'seed-1/config/spawn-table.json'], repo);
    expect(await changedFiles(repo)).toEqual([]);
  });

  it('stages only the lane paths and commits as the agent author with the trailers', async () => {
    await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":11}]}\n', 'utf8');
    await writeFile(path.join(repo, 'seed-1', 'sim', 'index.ts'), 'export const version = 2;\n', 'utf8');
    expect((await changedFiles(repo)).sort()).toEqual(['seed-1/config/spawn-table.json', 'seed-1/sim/index.ts']);
    const result = await commitLane(repo, ['seed-1/config', 'seed-1/content'], input);
    expect(result.committed).toBe(true);
    const committed = await git(['show', '--name-only', '--format=%an%n%ae%n%cn%n%ce%n%B', 'HEAD'], repo);
    const lines = committed.split('\n');
    expect(lines.slice(0, 4)).toEqual(['Builder A (AI agent)', AGENT_EMAIL, 'Builder A (AI agent)', AGENT_EMAIL]);
    expect(committed).toContain(commitTitle(input));
    expect(committed).toContain(`Card-Id: ${CARD_ID}`);
    expect(committed).toContain('Executor: Builder A');
    expect(committed).toContain('seed-1/config/spawn-table.json');
    expect(committed).not.toContain('seed-1/sim/index.ts');
    expect(await changedFiles(repo)).toEqual(['seed-1/sim/index.ts']);
  });
});

describe('git hooks', () => {
  let dir: string;
  let repo: string;
  let marker: string;
  const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  const HOOKS = ['pre-commit', 'commit-msg', 'post-commit', 'post-checkout', 'reference-transaction'];

  // Each planted hook records that it ran and exits 1, so a hook that runs also fails the command.
  async function plantHooks(hooksDir: string): Promise<void> {
    await mkdir(hooksDir, { recursive: true });
    for (const hook of HOOKS) {
      await writeFile(path.join(hooksDir, hook), `#!/bin/sh\necho "${hook}" >> "${marker}"\nexit 1\n`, { encoding: 'utf8', mode: 0o755 });
    }
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-hooks-'));
    marker = path.join(dir, 'hooks-ran.txt');
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    await writeFile(process.env.GIT_CONFIG_GLOBAL, `[user]\n\tname = Dispatcher test\n\temail = ${AGENT_EMAIL}\n`, 'utf8');
    repo = path.join(dir, 'repo');
    await mkdir(path.join(repo, 'seed-1', 'config'), { recursive: true });
    await git(['init', '-q', '--initial-branch=main', repo], dir);
    await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":10}]}\n', 'utf8');
    await git(['add', '-A'], repo);
    await git(['-c', 'user.name=Dispatcher test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'initial'], repo);
    // Both places a hook can come from: the default hooks folder, and a hooks path the
    // repository's own config names.
    await plantHooks(path.join(repo, '.git', 'hooks'));
    await plantHooks(path.join(dir, 'planted-hooks'));
    await git(['config', 'core.hooksPath', path.join(dir, 'planted-hooks')], repo);
  });

  afterAll(async () => {
    if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
    if (savedNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = savedNoSystem;
    await rm(dir, { recursive: true, force: true });
  });

  it('puts the fsmonitor and hooks switches before every subcommand', () => {
    expect(NO_HOOKS).toEqual(['-c', 'core.hooksPath=/dev/null']);
    const switches = ['-c', 'core.fsmonitor=false', '-c', 'core.commitGraph=false', '-c', 'core.attributesFile=/dev/null', '-c', 'core.hooksPath=/dev/null'];
    expect(GIT_SWITCHES).toEqual(switches);
    expect(gitArgs(['status', '--porcelain'])).toEqual([...switches, 'status', '--porcelain']);
    expect(gitArgs(['push', 'origin'])).toEqual([...switches, 'push', 'origin']);
  });

  it('runs a planted hook when git is called without the switch, so the test can see one', () => {
    expect(() => execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'control'], { cwd: repo, stdio: 'pipe' })).toThrow();
    expect(readFileSync(marker, 'utf8')).toContain('pre-commit');
  });

  it('runs no hook on add, diff, commit, rev-parse, status or worktree add', async () => {
    await rm(marker, { force: true });
    await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":11}]}\n', 'utf8');
    expect(await changedFiles(repo)).toEqual(['seed-1/config/spawn-table.json']);
    const result = await commitLane(repo, ['seed-1/config'], input);
    expect(result.committed).toBe(true);
    await git(['worktree', 'add', '--detach', path.join(dir, 'probe'), 'HEAD'], repo);
    expect(existsSync(path.join(dir, 'probe', 'seed-1', 'config', 'spawn-table.json'))).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('the committed range and the git state', () => {
  let dir: string;
  let repo: string;
  let base: string;
  const allowed = lanePaths('seed-1', 'config');
  const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  const ident = ['-c', 'user.name=Agent', '-c', `user.email=${AGENT_EMAIL}`];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-range-'));
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
    const origin = path.join(dir, 'origin.git');
    repo = path.join(dir, 'repo');
    await git(['init', '-q', '--bare', '--initial-branch=main', origin], dir);
    await git(['init', '-q', '--initial-branch=main', repo], dir);
    await mkdir(path.join(repo, 'seed-1', 'config'), { recursive: true });
    await mkdir(path.join(repo, 'seed-1', 'content'), { recursive: true });
    await mkdir(path.join(repo, 'seed-1', 'sim'), { recursive: true });
    await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":10}]}\n', 'utf8');
    await writeFile(path.join(repo, 'seed-1', 'sim', 'invariants.ts'), 'export const invariants = [1];\n', 'utf8');
    await writeFile(path.join(repo, 'seed-1', 'content', 'strings.json'), '{"title":"Dust"}\n', 'utf8');
    await git(['add', '-A'], repo);
    await git([...ident, 'commit', '-q', '-m', 'initial'], repo);
    await git(['remote', 'add', 'origin', origin], repo);
    await git(['push', '-q', 'origin', 'main'], repo);
    base = await git(['rev-parse', 'HEAD'], repo);
  });

  afterAll(async () => {
    setGitRunner(null);
    if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
    if (savedNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = savedNoSystem;
    await rm(dir, { recursive: true, force: true });
  });

  // A fresh card worktree on the base for each case.
  async function fresh(id8: string) {
    return createWorktree(repo, path.join(dir, 'worktrees'), `${id8}-0000-4000-8000-000000000000`, 'config', {});
  }

  async function commitAll(worktree: string, message: string): Promise<string> {
    await git(['add', '-A'], worktree);
    await git([...ident, 'commit', '-q', '-m', message], worktree);
    return git(['rev-parse', 'HEAD'], worktree);
  }

  it('creates the worktree at the fetched main sha, returns the sha and writes no branch config', async () => {
    const worktree = await fresh('aaaaaaaa');
    expect(worktree.baseSha).toBe(base);
    expect(await git(['rev-parse', 'HEAD'], worktree.path)).toBe(base);
    expect(readFileSync(path.join(repo, '.git', 'config'), 'utf8')).not.toContain('[branch');
    await removeWorktree(repo, worktree.path, worktree.branch);
  });

  it('passes one clean lane commit on the base', async () => {
    const worktree = await fresh('bbbbbbbb');
    await writeFile(path.join(worktree.path, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":11}]}\n', 'utf8');
    const sha = await commitAll(worktree.path, 'card');
    expect(await verifyCardCommit(worktree.path, { baseSha: base, sha, allowed })).toEqual({ ok: true, paths: ['seed-1/config/spawn-table.json'] });
    await removeWorktree(repo, worktree.path, worktree.branch);
  });

  it('refuses two commits, and a commit that is not HEAD, as history', async () => {
    const worktree = await fresh('cccccccc');
    await writeFile(path.join(worktree.path, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":11}]}\n', 'utf8');
    const first = await commitAll(worktree.path, 'agent');
    await writeFile(path.join(worktree.path, 'seed-1', 'content', 'strings.json'), '{"title":"Dusk"}\n', 'utf8');
    const second = await commitAll(worktree.path, 'card');
    expect(await verifyCardCommit(worktree.path, { baseSha: base, sha: second, allowed })).toMatchObject({ ok: false, check: 'history' });
    expect(await verifyCardCommit(worktree.path, { baseSha: base, sha: first, allowed })).toMatchObject({ ok: false, check: 'history' });
    await removeWorktree(repo, worktree.path, worktree.branch);
  });

  it('refuses a kernel file renamed into the lane as a lane violation naming the kernel path', async () => {
    const worktree = await fresh('dddddddd');
    await git(['mv', 'seed-1/sim/invariants.ts', 'seed-1/content/invariants.json'], worktree.path);
    const sha = await commitAll(worktree.path, 'card');
    const result = await verifyCardCommit(worktree.path, { baseSha: base, sha, allowed });
    expect(result).toEqual({ ok: false, check: 'lane_violation', detail: 'committed changes outside the lane: seed-1/sim/invariants.ts' });
    await removeWorktree(repo, worktree.path, worktree.branch);
  });

  it('refuses a symlink and a gitlink inside the lane as file_mode', async () => {
    const linked = await fresh('eeeeeeee');
    await symlink('../../.github', path.join(linked.path, 'seed-1', 'content', 'gh'));
    const linkSha = await commitAll(linked.path, 'card');
    expect(await verifyCardCommit(linked.path, { baseSha: base, sha: linkSha, allowed })).toMatchObject({
      ok: false,
      check: 'file_mode',
      detail: expect.stringContaining('seed-1/content/gh'),
    });
    await removeWorktree(repo, linked.path, linked.branch);

    const gitlink = await fresh('ffffffff');
    await git(['update-index', '--add', '--cacheinfo', `160000,${base},seed-1/content/sub`], gitlink.path);
    await git([...ident, 'commit', '-q', '-m', 'card'], gitlink.path);
    const subSha = await git(['rev-parse', 'HEAD'], gitlink.path);
    expect(await verifyCardCommit(gitlink.path, { baseSha: base, sha: subSha, allowed })).toMatchObject({
      ok: false,
      check: 'file_mode',
      detail: expect.stringContaining('160000'),
    });
    await removeWorktree(repo, gitlink.path, gitlink.branch);
  });

  it('changes the snapshot when a session plants core.fsmonitor, and no dispatcher git call runs it', async () => {
    const worktree = await fresh('abababab');
    const before = await snapshotGitState(repo, worktree.path);
    expect(await snapshotGitState(repo, worktree.path)).toBe(before);
    const marker = path.join(dir, 'fsmonitor-ran.txt');
    const monitor = path.join(dir, 'monitor.sh');
    await writeFile(monitor, `#!/bin/sh\necho ran >> "${marker}"\nexit 1\n`, { encoding: 'utf8', mode: 0o755 });
    const configFile = path.join(repo, '.git', 'config');
    const clean = readFileSync(configFile, 'utf8');
    await appendFile(configFile, `[core]\n\tfsmonitor = ${monitor}\n`, 'utf8');
    try {
      expect(await snapshotGitState(repo, worktree.path)).not.toBe(before);
      // Control: git without the switch runs the planted monitor.
      execFileSync('git', ['status', '--porcelain'], { cwd: worktree.path, stdio: 'pipe' });
      expect(existsSync(marker)).toBe(true);
      await rm(marker, { force: true });
      await writeFile(path.join(worktree.path, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[]}\n', 'utf8');
      expect(await changedFiles(worktree.path)).toEqual(['seed-1/config/spawn-table.json']);
      expect(existsSync(marker)).toBe(false);
    } finally {
      await writeFile(configFile, clean, 'utf8');
    }
    expect(await snapshotGitState(repo, worktree.path)).toBe(before);
    const exclude = path.join(repo, '.git', 'info', 'exclude');
    const excludeText = readFileSync(exclude, 'utf8');
    await appendFile(exclude, '*.json\n', 'utf8');
    expect(await snapshotGitState(repo, worktree.path)).not.toBe(before);
    await writeFile(exclude, excludeText, 'utf8');
    await writeFile(path.join(repo, '.git', 'config.worktree'), '[gpg]\n\tprogram = /tmp/sign\n', 'utf8');
    expect(await snapshotGitState(repo, worktree.path)).not.toBe(before);
    await rm(path.join(repo, '.git', 'config.worktree'));
    expect(await snapshotGitState(repo, worktree.path)).toBe(before);
    for (const planted of [path.join(repo, '.git', 'commondir'), path.join(repo, '.git', 'objects', 'info', 'alternates'), path.join(repo, '.git', 'objects', 'info', 'http-alternates')]) {
      await writeFile(planted, `${path.join(dir, 'elsewhere')}\n`, 'utf8');
      expect(await snapshotGitState(repo, worktree.path), planted).not.toBe(before);
      await rm(planted);
    }
    expect(await snapshotGitState(repo, worktree.path)).toBe(before);
    await writeFile(path.join(worktree.path, '.git'), `gitdir: ${path.join(dir, 'elsewhere')}\n`, 'utf8');
    expect(await snapshotGitState(repo, worktree.path)).not.toBe(before);
    await rm(worktree.path, { recursive: true, force: true });
    await removeWorktree(repo, worktree.path, worktree.branch);
  });

  it('ignores a commondir that points git at a planted copy of the repository with a filter in it', async () => {
    const marker = path.join(dir, 'filter-ran.txt');
    const evil = path.join(repo, 'seed-1', 'content', 'evil.git');
    const commondir = path.join(repo, '.git', 'commondir');
    try {
      await cp(path.join(repo, '.git'), evil, { recursive: true });
      await appendFile(path.join(evil, 'config'), `[filter "x"]\n\tclean = "echo ran >> '${marker}'; cat"\n\tsmudge = "echo ran >> '${marker}'; cat"\n`, 'utf8');
      await mkdir(path.join(evil, 'info'), { recursive: true });
      await writeFile(path.join(evil, 'info', 'attributes'), '* filter=x\n', 'utf8');
      await writeFile(commondir, `${evil}\n`, 'utf8');
      // Control: git without the dispatcher's environment follows commondir and runs the filter.
      await writeFile(path.join(repo, 'control.txt'), 'control\n', 'utf8');
      execFileSync('git', ['add', '--', 'control.txt'], { cwd: repo, stdio: 'pipe' });
      expect(readFileSync(marker, 'utf8')).toContain('ran');
      await rm(marker, { force: true });
      await writeFile(path.join(repo, 'dispatcher.txt'), 'dispatcher\n', 'utf8');
      await git(['add', '--', 'dispatcher.txt'], repo);
      expect(await git(['rev-parse', '--git-common-dir'], repo)).toBe(path.join(repo, '.git'));
      expect(existsSync(marker)).toBe(false);
    } finally {
      await rm(commondir, { force: true });
      execFileSync('git', ['rm', '-q', '--cached', '--ignore-unmatch', 'control.txt', 'dispatcher.txt'], { cwd: repo, stdio: 'pipe' });
      await rm(path.join(repo, 'control.txt'), { force: true });
      await rm(path.join(repo, 'dispatcher.txt'), { force: true });
      await rm(evil, { recursive: true, force: true });
    }
  });

  it('runs no git at all once the dispatcher is halted', async () => {
    const calls: GitCall[] = [];
    setGitRunner((call) => {
      calls.push(call);
      return defaultGitRunner(call);
    });
    haltDispatcher('git_tamper: test');
    try {
      await expect(git(['status'], repo)).rejects.toThrow(HaltedError);
      await expect(changedFiles(repo)).rejects.toThrow('the dispatcher is halted (git_tamper: test); no git runs until it restarts');
      expect(calls).toEqual([]);
    } finally {
      resetHalt();
      setGitRunner(null);
    }
  });

  it('runs every git call with the switches, a clean config environment and a timeout that kills', async () => {
    const calls: GitCall[] = [];
    setGitRunner((call) => {
      calls.push(call);
      return defaultGitRunner(call);
    });
    // Inherited git variables and the dispatcher's secrets never reach git; GIT_DIR would even
    // point every command at another repository.
    const saved = { GIT_DIR: process.env.GIT_DIR, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
    process.env.GIT_DIR = path.join(dir, 'nowhere.git');
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-service-role';
    try {
      const worktree = await fresh('cdcdcdcd');
      await writeFile(path.join(worktree.path, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":12}]}\n', 'utf8');
      await changedFiles(worktree.path);
      const commit = await commitLane(worktree.path, allowed, input);
      if (!commit.committed) throw new Error('expected a commit');
      await verifyCardCommit(worktree.path, { baseSha: worktree.baseSha, sha: commit.sha, allowed });
      await removeWorktree(repo, worktree.path, worktree.branch);
    } finally {
      setGitRunner(null);
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    for (const expected of ['fetch', 'rev-parse', 'worktree', 'status', 'add', 'diff', 'commit', 'rev-list', 'diff-tree', 'branch']) {
      expect(calls.some((call) => call.args.includes(expected))).toBe(true);
    }
    for (const call of calls) {
      expect(call.args.slice(0, GIT_SWITCHES.length)).toEqual([...GIT_SWITCHES]);
      expect(call.env).toMatchObject(GIT_ENV);
      // Only the git variables the dispatcher sets itself: the fixed environment, and a commit's author.
      // Only the git variables the dispatcher sets itself: the fixed environment, the repository's own
      // folders, and a commit's author.
      expect(
        Object.keys(call.env).filter(
          (name) => name.startsWith('GIT_') && !(name in GIT_ENV) && !/^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)$/.test(name) && !/^GIT_(DIR|COMMON_DIR|WORK_TREE)$/.test(name),
        ),
      ).toEqual([]);
      expect(call.env.GIT_DIR).not.toBe(path.join(dir, 'nowhere.git'));
      // git writes the worktree's gitdir as a real path (/private/var on macOS, where /var links to it);
      // the worktree is gone by now, so the prefix is dropped rather than resolved.
      const real = (value: string | undefined) => (value ?? '').replace(/^\/private(?=\/)/, '');
      expect(real(call.env.GIT_COMMON_DIR)).toBe(real(path.join(repo, '.git')));
      expect(real(call.env.GIT_WORK_TREE)).toBe(real(call.cwd));
      expect(real(call.env.GIT_DIR)).toBe(real(call.cwd === repo ? path.join(repo, '.git') : path.join(repo, '.git', 'worktrees', 'card-cdcdcdcd')));
      expect(call.env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
      expect(call.timeout).toBe(GIT_TIMEOUT_MS);
      expect(call.killSignal).toBe('SIGKILL');
    }
    expect(GIT_ENV).toEqual({ GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' });
    expect(GIT_TIMEOUT_MS).toBe(5 * 60_000);
  });
});
