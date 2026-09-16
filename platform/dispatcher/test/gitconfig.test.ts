import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StartupError } from '../src/exit-code.js';
import { gitConfigViolations, parseGitConfig, refusedKeys } from '../src/gitconfig.js';
import { pushBranch } from '../src/github.js';
import { checkRepositoryGit } from '../src/startup.js';
import { AGENT_EMAIL, createWorktree, git, removeWorktree } from '../src/worktree.js';

describe('parseGitConfig', () => {
  it('reads sections, subsections, the dotted form, same-line variables, continuations and comments', () => {
    const text = [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tbare = false ; a comment',
      '# a comment line',
      '[remote "origin"]',
      '\turl = https://github.com/owner/repo.git',
      '[branch.Main]',
      '\tremote = origin',
      '[gpg] program = /tmp/sign',
      '[alias]',
      '\tlong = "one \\',
      'two"',
      '\tSolo',
    ].join('\n');
    const parsed = parseGitConfig(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries.map((entry) => entry.key)).toEqual([
      'core.repositoryformatversion',
      'core.bare',
      'remote.origin.url',
      'branch.main.remote',
      'gpg.program',
      'alias.long',
      'alias.solo',
    ]);
  });

  it('reports a line it cannot read and a variable before any section', () => {
    expect(parseGitConfig('bare = true\n').errors).toEqual(['line 1: a variable before any section']);
    expect(parseGitConfig('[core\n').errors).toEqual(['line 1: cannot read "[core"']);
    expect(parseGitConfig('[core]\n\t= x\n').errors).toEqual(['line 2: cannot read "= x"']);
  });
});

describe('refusedKeys', () => {
  it('allows the keys git writes on clone, fetch, worktree add and branch -D', () => {
    expect(
      refusedKeys([
        'core.repositoryformatversion',
        'core.filemode',
        'core.bare',
        'core.logallrefupdates',
        'core.ignorecase',
        'core.precomposeunicode',
        'remote.origin.url',
        'remote.origin.fetch',
        'branch.main.remote',
        'branch.card/4c2f5a1e-code.merge',
        'branch.main.gh-merge-base',
        'branch.main.vscode-merge-base',
        'branch.feature.x.anything',
        'branch.main.pushremote',
        'extensions.objectformat',
        'lfs.repositoryformatversion',
      ]),
    ).toEqual([]);
  });

  it('refuses every key that runs a program, redirects traffic or pulls in other configuration', () => {
    const refused = [
      'include.path',
      'includeif.gitdir:/tmp/.path',
      'extensions.worktreeconfig',
      'gpg.program',
      'gpg.ssh.program',
      'commit.gpgsign',
      'tag.gpgsign',
      'filter.lfs.process',
      'diff.json.textconv',
      'credential.helper',
      'http.proxy',
      'https.proxy',
      'url.https://evil.example/.insteadof',
      'protocol.ext.allow',
      'core.sshcommand',
      'core.askpass',
      'core.fsmonitor',
      'core.hookspath',
      'core.gitproxy',
      'core.pager',
      'core.editor',
      'remote.origin.uploadpack',
      'remote.origin.receivepack',
      'remote.origin.proxy',
      'remote.evil.url',
      'remote.pushdefault',
      'branch.autosetupmerge',
      'user.name',
    ];
    expect(refusedKeys(refused)).toEqual(refused);
  });
});

describe('the repository git configuration', () => {
  let dir: string;
  let repo: string;
  let clean: string;
  const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-gitconfig-'));
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
    const origin = path.join(dir, 'origin.git');
    const seed = path.join(dir, 'seed');
    repo = path.join(dir, 'repo');
    await git(['init', '-q', '--bare', '--initial-branch=main', origin], dir);
    await git(['init', '-q', '--initial-branch=main', seed], dir);
    await mkdir(path.join(seed, 'seed-1', 'config'), { recursive: true });
    await writeFile(path.join(seed, 'seed-1', 'config', 'spawn-table.json'), '{}\n', 'utf8');
    await git(['add', '-A'], seed);
    await git(['-c', 'user.name=Test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'initial'], seed);
    await git(['push', '-q', origin, 'main'], seed);
    // What the dispatcher's own git leaves behind: a clone, a fetch, a card worktree, a push, and
    // the worktree and branch removed again.
    await git(['clone', '-q', origin, repo], dir);
    const worktree = await createWorktree(repo, path.join(dir, 'worktrees'), '4c2f5a1e-7b3d-4e8a-9f01-2a3b4c5d6e7f', 'config', {});
    await writeFile(path.join(worktree.path, 'seed-1', 'config', 'spawn-table.json'), '{"a":1}\n', 'utf8');
    await git(['add', '-A'], worktree.path);
    await git(['-c', 'user.name=Test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'card'], worktree.path);
    await git(['push', '-q', 'origin', `HEAD:refs/heads/${worktree.branch}`], worktree.path);
    await removeWorktree(repo, worktree.path, worktree.branch);
    clean = await readFile(path.join(repo, '.git', 'config'), 'utf8');
  });

  afterAll(async () => {
    if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
    if (savedNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = savedNoSystem;
    await rm(dir, { recursive: true, force: true });
  });

  async function restore(): Promise<void> {
    await writeFile(path.join(repo, '.git', 'config'), clean, 'utf8');
    await rm(path.join(repo, '.git', 'config.worktree'), { force: true });
  }

  it('allows the per-branch keys gh, GitHub Desktop and IDEs write, so an attended checkout starts', async () => {
    try {
      await appendFile(
        path.join(repo, '.git', 'config'),
        '[branch "main"]\n\tgh-merge-base = main\n\tvscode-merge-base = origin/main\n\tanything = at all\n\tpushRemote = elsewhere\n',
        'utf8',
      );
      expect(await gitConfigViolations(repo, null)).toEqual([]);
    } finally {
      await restore();
    }
  });

  // pushBranch names origin on the command line, so git never reads branch.<name>.pushRemote for the
  // dispatcher's push, and the remote it could name has no remote.<name>.* keys the allowlist lets in.
  it('pushes a card to origin even when the branch names another push remote, whose definition is refused', async () => {
    const worktree = await createWorktree(repo, path.join(dir, 'worktrees'), '5d5d5d5d-7b3d-4e8a-9f01-2a3b4c5d6e7f', 'config', {});
    try {
      await appendFile(path.join(repo, '.git', 'config'), `[branch "${worktree.branch}"]\n\tpushRemote = elsewhere\n`, 'utf8');
      expect(await gitConfigViolations(repo, worktree.path)).toEqual([]);
      await writeFile(path.join(worktree.path, 'seed-1', 'config', 'spawn-table.json'), '{"b":2}\n', 'utf8');
      await git(['add', '-A'], worktree.path);
      await git(['-c', 'user.name=Test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'card'], worktree.path);
      const sha = await git(['rev-parse', 'HEAD'], worktree.path);
      await pushBranch(worktree.path, worktree.branch, 'token', sha);
      expect(await git(['rev-parse', `refs/heads/${worktree.branch}`], path.join(dir, 'origin.git'))).toBe(sha);

      await appendFile(path.join(repo, '.git', 'config'), '[remote "elsewhere"]\n\turl = https://evil.example/repo.git\n\tpushurl = https://evil.example/repo.git\n', 'utf8');
      expect(await gitConfigViolations(repo, worktree.path)).toEqual([
        expect.stringMatching(/line \d+: remote\.elsewhere\.url$/),
        expect.stringMatching(/line \d+: remote\.elsewhere\.pushurl$/),
      ]);
    } finally {
      await restore();
      await removeWorktree(repo, worktree.path, worktree.branch);
    }
  });

  // Files that redirect where git reads configuration, attributes or objects, or that git would run.
  const PLANTS: Array<[string, (worktreeAdmin: string) => Promise<string>]> = [
    ['a commondir in the main repository', async () => plant(path.join(repo, '.git', 'commondir'), `${path.join(dir, 'evil.git')}\n`)],
    ['info/attributes', async () => plant(path.join(repo, '.git', 'info', 'attributes'), '* filter=x\n')],
    ['objects/info/alternates', async () => plant(path.join(repo, '.git', 'objects', 'info', 'alternates'), `${path.join(dir, 'evil.git', 'objects')}\n`)],
    ['objects/info/http-alternates', async () => plant(path.join(repo, '.git', 'objects', 'info', 'http-alternates'), 'https://evil.example/objects\n')],
    ['a hook that is not a sample', async () => plant(path.join(repo, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nexit 0\n')],
    ['a worktree config.worktree', async (admin) => plant(path.join(admin, 'config.worktree'), '[core]\n\tbare = false\n')],
    ['a worktree commondir that is not ../..', async (admin) => plant(path.join(admin, 'commondir'), `${path.join(dir, 'evil.git')}\n`)],
  ];

  const planted: string[] = [];
  async function plant(file: string, content: string): Promise<string> {
    await mkdir(path.dirname(file), { recursive: true });
    const before = await readFile(file, 'utf8').catch(() => null);
    planted.push(before === null ? `rm:${file}` : `restore:${file}:${before}`);
    await writeFile(file, content, 'utf8');
    return file;
  }
  async function unplant(): Promise<void> {
    for (const entry of planted.splice(0).reverse()) {
      if (entry.startsWith('rm:')) await rm(entry.slice(3), { force: true });
      else {
        const [, file, ...content] = entry.split(':');
        await writeFile(file!, content.join(':'), 'utf8');
      }
    }
  }

  it.each(PLANTS)('refuses to start with %s, and passes again once it is gone', async (_name, place) => {
    await git(['remote', 'set-url', 'origin', 'https://github.com/owner/repo.git'], repo);
    clean = await readFile(path.join(repo, '.git', 'config'), 'utf8');
    // Added locally: origin now names github.com, which the test does not fetch.
    const worktree = { path: path.join(dir, 'worktrees', 'plant-6e6e6e6e'), branch: null };
    await git(['worktree', 'add', '--detach', worktree.path, 'HEAD'], repo);
    const admin = path.join(repo, '.git', 'worktrees', path.basename(worktree.path));
    try {
      await expect(checkRepositoryGit(repo, 'owner/repo')).resolves.toBeUndefined();
      const file = await place(admin);
      const refused = await checkRepositoryGit(repo, 'owner/repo').catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(StartupError);
      expect((refused as StartupError).fatal).toBe(true);
      expect((refused as StartupError).message).toContain(path.relative(repo, file));
      expect(await gitConfigViolations(repo, worktree.path)).not.toEqual([]);
      await unplant();
      await expect(checkRepositoryGit(repo, 'owner/repo')).resolves.toBeUndefined();
    } finally {
      await unplant();
      await removeWorktree(repo, worktree.path, worktree.branch);
    }
  });

  it('finds nothing to refuse in what git itself wrote', async () => {
    expect(await gitConfigViolations(repo, null)).toEqual([]);
  });

  it('refuses a planted include, and any key in the common config.worktree', async () => {
    try {
      await appendFile(path.join(repo, '.git', 'config'), '[include]\n\tpath = ../evil\n', 'utf8');
      await writeFile(path.join(repo, '.git', 'config.worktree'), '[gpg]\n\tprogram = /tmp/sign\n', 'utf8');
      const violations = await gitConfigViolations(repo, null);
      expect(violations).toHaveLength(2);
      expect(violations[0]).toMatch(/\.git\/config line \d+: include\.path$/);
      expect(violations[1]).toMatch(/\.git\/config\.worktree line 2: gpg\.program$/);
    } finally {
      await restore();
    }
  });

  it('refuses to start, fatally, with an include, a remote that is not the repository, or an unreadable line', async () => {
    await git(['remote', 'set-url', 'origin', 'https://github.com/owner/repo.git'], repo);
    clean = await readFile(path.join(repo, '.git', 'config'), 'utf8');
    await expect(checkRepositoryGit(repo, 'owner/repo')).resolves.toBeUndefined();

    await appendFile(path.join(repo, '.git', 'config'), '[include]\n\tpath = ../evil\n', 'utf8');
    const refused = await checkRepositoryGit(repo, 'owner/repo').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(StartupError);
    expect((refused as StartupError).fatal).toBe(true);
    expect((refused as StartupError).message).toMatch(/^the repository's git configuration is refused: .*include\.path/);
    await restore();

    await expect(checkRepositoryGit(repo, 'someone/else')).rejects.toThrow("remote.origin.url is https://github.com/owner/repo.git, not https://github.com/someone/else(.git)");

    await appendFile(path.join(repo, '.git', 'config'), '[core\n', 'utf8');
    await expect(checkRepositoryGit(repo, 'owner/repo')).rejects.toThrow(/cannot read "\[core"/);
    await restore();
  });
});
