// Git worktrees for agent sessions: one worktree per card on branch card/<id8>-<lane>,
// created from origin/main; only lane paths are staged; commits carry the agent author.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CardFolder } from './adapters/types.js';
import type { CardLane } from './db.js';

const execFileAsync = promisify(execFile);

export const AGENT_EMAIL = 'agents@peanutgallery.games';
const TITLE_LIMIT = 72;
const SPACE = 32;
const DELETE = 127;

// Every git command runs with hooks off. Hooks run with the environment of the git process, which
// is the dispatcher's, secrets included, and agent-written code shares the dispatcher's OS user,
// so a hook it planted in the repository must never run. The command-line setting overrides any
// core.hooksPath in the repository's own config.
export const NO_HOOKS: readonly string[] = ['-c', 'core.hooksPath=/dev/null'];

export function gitArgs(args: readonly string[]): string[] {
  return [...NO_HOOKS, ...args];
}

async function gitRaw(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', gitArgs(args), { cwd, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

export async function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return (await gitRaw(args, cwd, env)).trim();
}

// The token reaches git as configuration in the environment, scoped to github.com so it never
// reaches another host. An argument would sit in /proc/<pid>/cmdline, which any process on the
// machine can read with ps; a process's environment is readable only by its own user.
export function gitAuthEnv(token: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

export function shortId(cardId: string): string {
  return cardId.replace(/-/g, '').slice(0, 8);
}

export function branchName(cardId: string, lane: CardLane): string {
  return `card/${shortId(cardId)}-${lane}`;
}

export function worktreePath(root: string, cardId: string): string {
  return path.join(root, `card-${shortId(cardId)}`);
}

// Paths no agent may change in any lane: the gate, the dispatcher, the database, the role specs,
// the workflows, the constitution, and the build and invariant harness of each folder. The same
// list is platform/gate/kernel-paths.txt, which the gate checks card branches against; a test
// keeps the two equal.
export const KERNEL_PATHS: readonly string[] = [
  '.github',
  'CLAUDE.md',
  'docs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'platform/agents',
  'platform/dispatcher',
  'platform/gate',
  'platform/ops',
  'platform/supabase',
  'platform/site/build-sha.ts',
  'platform/site/netlify.toml',
  'platform/site/package.json',
  'platform/site/playwright.config.ts',
  'platform/site/scripts',
  'platform/site/vite.config.ts',
  'seed-1/CLAUDE.md',
  'seed-1/bots',
  'seed-1/netlify.toml',
  'seed-1/package.json',
  'seed-1/scripts',
  'seed-1/sim/invariants.ts',
  'seed-1/tests/bot.test.ts',
  'seed-1/tests/invariants.test.ts',
  'seed-1/tsconfig.json',
  'seed-1/vite.config.ts',
];

// File and folder names no agent may create or change at any depth: Claude Code loads a nested
// CLAUDE.md or .claude folder into later sessions, and a nested package, test or deploy config can
// override the one the gate relies on. The same list is platform/gate/kernel-names.txt; a test keeps
// the two equal. * matches any run of characters within one path segment.
export const KERNEL_NAMES: readonly string[] = [
  '.claude',
  'CLAUDE.md',
  'CLAUDE.local.md',
  '.mcp.json',
  '.gitattributes',
  '.gitmodules',
  '.npmrc',
  '.pnpmfile.cjs',
  'package.json',
  'vite.config.*',
  'vitest.config.*',
  'vitest.workspace.*',
  'netlify.toml',
];

// Names hold letters, digits, dot, underscore, hyphen and * only (the test checks), so the dot is
// the one character to escape.
const KERNEL_NAME_PATTERNS: readonly RegExp[] = KERNEL_NAMES.map((name) => new RegExp(`^${name.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`));

function under(file: string, dir: string): boolean {
  return file === dir || file.startsWith(`${dir}/`);
}

// A kernel path, or a path with a kernel name as any of its segments.
export function isKernelPath(file: string): boolean {
  return KERNEL_PATHS.some((kernel) => under(file, kernel)) || file.split('/').some((segment) => KERNEL_NAME_PATTERNS.some((pattern) => pattern.test(segment)));
}

// Config lane may touch data only, and only seed-1 has a config lane. Code lane may touch its
// folder, which for platform is the site alone. An empty list means the lane does not exist for
// the folder.
export function lanePaths(folder: CardFolder, lane: CardLane): string[] {
  if (lane === 'code') return folder === 'platform' ? ['platform/site'] : [folder];
  return folder === 'seed-1' ? ['seed-1/config', 'seed-1/content'] : [];
}

// The kernel paths that lie inside the allowed paths, named in the session prompt.
export function protectedPaths(allowed: readonly string[]): string[] {
  return KERNEL_PATHS.filter((kernel) => allowed.some((dir) => under(kernel, dir)));
}

// Files outside the allowed paths, and kernel files inside them.
export function outsideLane(files: readonly string[], allowed: readonly string[]): string[] {
  return files.filter((file) => !allowed.some((dir) => under(file, dir)) || isKernelPath(file));
}

export interface Worktree {
  path: string;
  branch: string;
}

export async function createWorktree(repoRoot: string, root: string, cardId: string, lane: CardLane, authEnv: NodeJS.ProcessEnv): Promise<Worktree> {
  const target = worktreePath(root, cardId);
  const branch = branchName(cardId, lane);
  await mkdir(root, { recursive: true });
  if (existsSync(target)) {
    await removeWorktree(repoRoot, target, null);
  }
  await git(['fetch', 'origin', 'main'], repoRoot, authEnv);
  await git(['worktree', 'add', '-B', branch, target, 'origin/main'], repoRoot);
  return { path: target, branch };
}

export async function removeWorktree(repoRoot: string, target: string, branch: string | null): Promise<void> {
  if (existsSync(target)) {
    await git(['worktree', 'remove', '--force', target], repoRoot).catch(() => rm(target, { recursive: true, force: true }));
  }
  await git(['worktree', 'prune'], repoRoot);
  if (branch) {
    await git(['branch', '-D', branch], repoRoot).catch(() => undefined);
  }
}

// Paths from `git status --porcelain -z`, read untrimmed because the first entry begins with
// a status character that may be a space. Entries are "XY path"; a rename or copy (R or C in
// either column) is followed by a second entry holding the original path, and both are reported,
// so a kernel file moved into a lane folder is still seen.
export function parseStatus(output: string): string[] {
  const entries = output.split('\0').filter((entry) => entry.length > 0);
  const files: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] ?? '';
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      const original = entries[i + 1];
      if (original !== undefined) files.push(original);
      i += 1;
    }
  }
  return files;
}

// Rename detection is off whatever the repository's config says, so a rename arrives as a delete
// and an add; parseStatus still reads a rename entry correctly if one appears.
export async function changedFiles(worktree: string): Promise<string[]> {
  return parseStatus(await gitRaw(['status', '--porcelain', '--no-renames', '--untracked-files=all', '-z'], worktree));
}

// Control characters become spaces so the title stays one line; runs of whitespace collapse.
export function singleLineTitle(title: string): string {
  const printable = Array.from(title, (ch) => {
    const code = ch.charCodeAt(0);
    return code < SPACE || code === DELETE ? ' ' : ch;
  }).join('');
  const clean = printable.replace(/\s+/g, ' ').trim();
  return clean.length > TITLE_LIMIT ? `${clean.slice(0, TITLE_LIMIT - 1)}…` : clean;
}

export interface CommitInput {
  cardId: string;
  title: string;
  lane: CardLane;
  executor: string;
  acceptance: string;
}

export function commitTitle(input: CommitInput): string {
  return `card ${shortId(input.cardId)}: ${singleLineTitle(input.title)}`;
}

export function commitTrailers(input: CommitInput): string {
  return [`Card-Id: ${input.cardId}`, `Lane: ${input.lane}`, `Executor: ${input.executor}`, `Acceptance: ${input.acceptance}`].join('\n');
}

export function commitMessage(input: CommitInput): string {
  return `${commitTitle(input)}\n\n${commitTrailers(input)}\n`;
}

export type CommitResult = { committed: true; sha: string } | { committed: false };

// Only lane paths present in the worktree are staged; git refuses a pathspec that matches
// nothing, and a folder may lack one of its lane directories.
export async function commitLane(worktree: string, allowed: readonly string[], input: CommitInput): Promise<CommitResult> {
  const present = allowed.filter((dir) => existsSync(path.join(worktree, dir)));
  if (present.length === 0) return { committed: false };
  await git(['add', '-A', '--', ...present], worktree);
  const staged = await git(['diff', '--cached', '--name-only'], worktree);
  if (staged.length === 0) return { committed: false };
  const author = `${input.executor} (AI agent)`;
  const messageFile = path.join(os.tmpdir(), `backseat-commit-${shortId(input.cardId)}-${process.pid}.txt`);
  await writeFile(messageFile, commitMessage(input), 'utf8');
  try {
    await git(['commit', '--quiet', '-F', messageFile], worktree, {
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: AGENT_EMAIL,
      GIT_COMMITTER_NAME: author,
      GIT_COMMITTER_EMAIL: AGENT_EMAIL,
    });
  } finally {
    await rm(messageFile, { force: true });
  }
  return { committed: true, sha: await git(['rev-parse', 'HEAD'], worktree) };
}
