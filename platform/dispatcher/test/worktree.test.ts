import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT_EMAIL,
  branchName,
  changedFiles,
  commitLane,
  commitMessage,
  commitTitle,
  commitTrailers,
  git,
  gitArgs,
  gitAuthEnv,
  KERNEL_PATHS,
  NO_HOOKS,
  lanePaths,
  outsideLane,
  protectedPaths,
  shortId,
  singleLineTitle,
  worktreePath,
  type CommitInput,
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

  it('keeps the kernel list equal to the gate file', () => {
    const file = readFileSync(path.resolve(import.meta.dirname, '..', '..', 'gate', 'kernel-paths.txt'), 'utf8');
    const listed = file.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'));
    expect([...KERNEL_PATHS]).toEqual(listed);
  });

  it('refuses kernel files in every lane and names the ones inside a lane', () => {
    expect(outsideLane(['seed-1/sim/invariants.ts', 'seed-1/sim/sim.ts', 'seed-1/bots/greedy.ts'], lanePaths('seed-1', 'code'))).toEqual(['seed-1/sim/invariants.ts', 'seed-1/bots/greedy.ts']);
    expect(outsideLane(['platform/gate/ship-gate.sh', 'platform/site/netlify.toml', 'platform/site/src/App.tsx'], lanePaths('platform', 'code'))).toEqual(['platform/gate/ship-gate.sh', 'platform/site/netlify.toml']);
    expect(outsideLane(['seed-1/sim/invariants.tsx'], lanePaths('seed-1', 'code'))).toEqual([]);
    expect(protectedPaths(lanePaths('seed-1', 'config'))).toEqual([]);
    expect(protectedPaths(lanePaths('seed-1', 'code'))).toContain('seed-1/sim/invariants.ts');
  });

  it('reports files outside the allowed paths', () => {
    const allowed = ['seed-1/config', 'seed-1/content'];
    expect(outsideLane(['seed-1/config/spawn-table.json', 'seed-1/content/strings.json'], allowed)).toEqual([]);
    expect(outsideLane(['seed-1/config/spawn-table.json', 'seed-1/sim/index.ts', 'seed-1/configuration.md'], allowed)).toEqual(['seed-1/sim/index.ts', 'seed-1/configuration.md']);
    expect(outsideLane(['platform/site/index.html'], ['platform/site'])).toEqual([]);
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

  it('reads the first status entry whole and reports a rename by its new name', async () => {
    await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), '{"rows":[{"id":"gatherer","baseCost":12}]}\n', 'utf8');
    expect(await changedFiles(repo)).toEqual(['seed-1/config/spawn-table.json']);
    await git(['mv', 'seed-1/sim/index.ts', 'seed-1/sim/main.ts'], repo);
    expect((await changedFiles(repo)).sort()).toEqual(['seed-1/config/spawn-table.json', 'seed-1/sim/main.ts']);
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
    await git(['commit', '-q', '-m', 'initial'], repo);
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

  it('puts the hooks switch before every subcommand', () => {
    expect(NO_HOOKS).toEqual(['-c', 'core.hooksPath=/dev/null']);
    expect(gitArgs(['status', '--porcelain'])).toEqual(['-c', 'core.hooksPath=/dev/null', 'status', '--porcelain']);
    expect(gitArgs(['push', 'origin'])).toEqual(['-c', 'core.hooksPath=/dev/null', 'push', 'origin']);
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
