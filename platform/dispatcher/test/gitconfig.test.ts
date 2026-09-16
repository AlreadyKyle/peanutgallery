import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StartupError } from '../src/exit-code.js';
import { gitConfigViolations, parseGitConfig, refusedKeys } from '../src/gitconfig.js';
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
