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
  gitAuthArgs,
  lanePaths,
  outsideLane,
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
    expect(lanePaths('platform', 'code')).toEqual(['platform']);
    expect(lanePaths('platform', 'config')).toEqual([]);
  });

  it('reports files outside the allowed paths', () => {
    const allowed = ['seed-1/config', 'seed-1/content'];
    expect(outsideLane(['seed-1/config/spawn-table.json', 'seed-1/content/strings.json'], allowed)).toEqual([]);
    expect(outsideLane(['seed-1/config/spawn-table.json', 'seed-1/sim/index.ts', 'seed-1/configuration.md'], allowed)).toEqual(['seed-1/sim/index.ts', 'seed-1/configuration.md']);
    expect(outsideLane(['platform/site/index.html'], ['platform'])).toEqual([]);
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

  it('scopes the token to github.com', () => {
    const args = gitAuthArgs('token');
    expect(args[0]).toBe('-c');
    expect(args[1]).toMatch(/^http\.https:\/\/github\.com\/\.extraheader=AUTHORIZATION: basic /);
    expect(Buffer.from(args[1]!.split('basic ')[1]!, 'base64').toString()).toBe('x-access-token:token');
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
