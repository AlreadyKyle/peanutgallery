// Git worktrees for agent sessions: one worktree per card on branch card/<id8>-<lane>,
// created at the fetched main sha; only lane paths are staged; commits carry the agent author. The
// committed range and the repository's git configuration are checked after the session, since the
// session can run code that commits or writes git configuration itself.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, readlink, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CardFolder } from './adapters/types.js';
import type { CardLane } from './db.js';
import { HaltedError, haltReason } from './halt.js';
import { Mutex } from './lock.js';

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

// core.fsmonitor names a command git runs on status, add and diff; it is turned off the same way.
// The commit-graph file is not read, so a graph a session wrote cannot misreport history.
// No global attributes file is read either; the repository's own info/attributes is refused outright
// (gitconfig.ts), so no attribute can name a filter or diff driver.
export const GIT_SWITCHES: readonly string[] = ['-c', 'core.fsmonitor=false', '-c', 'core.commitGraph=false', '-c', 'core.attributesFile=/dev/null', ...NO_HOOKS];

// No system or user configuration is read, so only the repository's own configuration applies, and
// snapshotGitState watches that. Replace refs are ignored, so a replacement object a session wrote
// cannot make the tree git shows differ from the tree git pushes.
export const GIT_ENV: Readonly<Record<string, string>> = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' };

// A git command that runs longer is killed.
export const GIT_TIMEOUT_MS = 5 * 60_000;

export function gitArgs(args: readonly string[]): string[] {
  return [...GIT_SWITCHES, ...args];
}

export interface GitCall {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  killSignal: NodeJS.Signals;
}

// Runs git and resolves with its stdout, or rejects when it exits non-zero or is killed.
export type GitRunner = (call: GitCall) => Promise<string>;

export const defaultGitRunner: GitRunner = async (call) => {
  const { stdout } = await execFileAsync('git', call.args, {
    cwd: call.cwd,
    env: call.env,
    timeout: call.timeout,
    killSignal: call.killSignal,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
};

let runner: GitRunner = defaultGitRunner;

// Tests wrap the runner to see every call; null restores the default.
export function setGitRunner(next: GitRunner | null): void {
  runner = next ?? defaultGitRunner;
}

// The environment git starts from: what it needs to find programs, write temporary files and reach
// https hosts, and nothing else. Every inherited GIT_* variable (GIT_DIR, GIT_SSH_COMMAND, a
// GIT_CONFIG_* list) and every secret the dispatcher loaded from .env is left out.
export const GIT_ENV_NAMES: readonly string[] = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TZ', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];

export function gitBaseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && (GIT_ENV_NAMES.includes(name) || name.startsWith('LC_'))) base[name] = value;
  }
  return base;
}

// The folders git uses for a call in cwd, named in the environment so git never works them out
// itself. A commondir file, in the main repository or a worktree's folder, would otherwise send git to
// a copy of the repository the snapshot and the allowlist never read.
// - cwd holds a .git folder: that folder is both the git dir and the common dir.
// - cwd holds a .git file: it names <common>/worktrees/<name>, and the common dir is two levels up.
// - neither (git init or clone, a bare repository in tests): git may not search above cwd.
export async function gitDirEnv(cwd: string): Promise<NodeJS.ProcessEnv> {
  const top = path.resolve(cwd);
  const dotGit = path.join(top, '.git');
  let stat;
  try {
    stat = await lstat(dotGit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { GIT_CEILING_DIRECTORIES: path.dirname(top) };
  }
  if (stat.isDirectory()) return { GIT_DIR: dotGit, GIT_COMMON_DIR: dotGit, GIT_WORK_TREE: top };
  if (!stat.isFile()) throw new Error(`${dotGit} is neither a folder nor a file`);
  const pointer = /^gitdir: (.+)$/m.exec(await readFile(dotGit, 'utf8'))?.[1]?.trim();
  if (!pointer) throw new Error(`${dotGit} names no gitdir`);
  const admin = path.resolve(top, pointer);
  if (path.basename(path.dirname(admin)) !== 'worktrees') throw new Error(`${dotGit} does not point into a worktrees folder`);
  return { GIT_DIR: admin, GIT_COMMON_DIR: path.dirname(path.dirname(admin)), GIT_WORK_TREE: top };
}

// A halted dispatcher runs no git: the repository's configuration is untrusted until an operator has
// looked and restarted it.
async function gitRaw(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const halted = haltReason();
  if (halted) throw new HaltedError(halted);
  const dirs = await gitDirEnv(cwd);
  return runner({ args: gitArgs(args), cwd, env: { ...gitBaseEnv(process.env), ...env, ...dirs, ...GIT_ENV }, timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' });
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
// the workflows, the constitution, the board's own site, the public site's settings, its entry, the
// frame and routes of its pages, its money, ledger and legal surfaces and the snapshot they read
// (docs/specs/board-site.md), and the build, determinism and invariant harness of each folder. The
// same list is platform/gate/kernel-paths.txt, which the gate checks card branches against; a test
// keeps the two equal, and test/site-kernel.test.ts keeps the site's kernel files from importing a
// file a card can change.
export const KERNEL_PATHS: readonly string[] = [
  '.github',
  'CLAUDE.md',
  'docs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'platform/agents',
  'platform/board',
  'platform/dispatcher',
  'platform/gate',
  'platform/ops',
  'platform/supabase',
  'platform/site/build-sha.ts',
  'platform/site/index.html',
  'platform/site/netlify',
  'platform/site/netlify.toml',
  'platform/site/package.json',
  'platform/site/playwright.config.ts',
  'platform/site/scripts',
  'platform/site/src/App.tsx',
  'platform/site/src/components/DeployList.tsx',
  'platform/site/src/components/EventList.tsx',
  'platform/site/src/components/Funding.tsx',
  'platform/site/src/components/Guarded.tsx',
  'platform/site/src/components/LedgerSummary.tsx',
  'platform/site/src/components/Mark.tsx',
  'platform/site/src/components/Meter.tsx',
  'platform/site/src/components/MoneyIn.tsx',
  'platform/site/src/components/NotFound.tsx',
  'platform/site/src/components/PausedNotice.tsx',
  'platform/site/src/components/PoolStat.tsx',
  'platform/site/src/components/ReportFacts.tsx',
  'platform/site/src/components/StaleNotice.tsx',
  'platform/site/src/components/Stat.tsx',
  'platform/site/src/components/Stopped.tsx',
  'platform/site/src/components/Supporters.tsx',
  'platform/site/src/components/TextPage.tsx',
  'platform/site/src/lib/card-source.ts',
  'platform/site/src/lib/lines.ts',
  'platform/site/src/lib/env.ts',
  'platform/site/src/lib/format.ts',
  'platform/site/src/lib/legal.ts',
  'platform/site/src/lib/payment.ts',
  'platform/site/src/lib/reports-source.ts',
  'platform/site/src/lib/snapshot-keys.json',
  'platform/site/src/lib/source.ts',
  'platform/site/src/lib/studio.tsx',
  'platform/site/src/lib/supabase.ts',
  'platform/site/src/lib/terms-versions.ts',
  'platform/site/src/lib/terms.test.ts',
  'platform/site/src/lib/terms.ts',
  'platform/site/src/lib/thanks.ts',
  'platform/site/src/main.tsx',
  'platform/site/src/pages/Contribute.tsx',
  'platform/site/src/pages/Ledger.tsx',
  'platform/site/src/pages/Legal.tsx',
  'platform/site/src/pages/Thanks.tsx',
  'platform/site/vite.config.ts',
  'seed-1/CLAUDE.md',
  'seed-1/bots',
  'seed-1/index.html',
  'seed-1/netlify.toml',
  'seed-1/package.json',
  'seed-1/scripts',
  'seed-1/sim/hash.ts',
  'seed-1/sim/invariants.ts',
  'seed-1/sim/rng.ts',
  'seed-1/tests/bot.test.ts',
  'seed-1/tests/invariants.test.ts',
  'seed-1/tests/timeline.test.ts',
  'seed-1/tsconfig.json',
  'seed-1/vite.config.ts',
];

// File and folder names no agent may create or change at any depth: Claude Code loads a nested
// CLAUDE.md or .claude folder into later sessions, a nested package, test or deploy config can
// override the one the gate relies on, and a build tool loads its config (PostCSS, Babel, env files)
// from the folder it builds, running the code in it. Netlify deploys functions, edge functions, headers
// and forced redirects from a site's netlify and .netlify folders. The same list is
// platform/gate/kernel-names.txt; a test keeps the two equal. * matches any run of characters within
// one path segment.
export const KERNEL_NAMES: readonly string[] = [
  '.claude',
  'CLAUDE.md',
  'CLAUDE.local.md',
  '.mcp.json',
  '.gitattributes',
  '.gitmodules',
  '.npmrc',
  '.pnpmfile.*',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'vite.config.*',
  'vitest.config.*',
  'vitest.workspace.*',
  'tsconfig*.json',
  'postcss.config.*',
  '.postcssrc*',
  'tailwind.config.*',
  'babel.config.*',
  '.babelrc*',
  '.env*',
  'netlify.toml',
  '_headers',
  '_redirects',
  '.netlify',
  'netlify',
];

// Names hold letters, digits, dot, underscore, hyphen and * only (the test checks), so the dot is
// the one character to escape. * matches any character, a newline included, as the shell glob in
// kernel-guard.sh does, and case is ignored there and here.
const KERNEL_NAME_PATTERNS: readonly RegExp[] = KERNEL_NAMES.map((name) => new RegExp(`^${name.replace(/\./g, '\\.').replace(/\*/g, '[\\s\\S]*')}$`, 'i'));

function under(file: string, dir: string): boolean {
  return file === dir || file.startsWith(`${dir}/`);
}

// A kernel path, or a path with a kernel name as any of its segments. Case is ignored: a
// case-insensitive checkout (macOS) reads claude.md as CLAUDE.md and Platform/Gate as platform/gate.
export function isKernelPath(file: string): boolean {
  const lower = file.toLowerCase();
  return (
    KERNEL_PATHS.some((kernel) => under(lower, kernel.toLowerCase())) ||
    file.split('/').some((segment) => KERNEL_NAME_PATTERNS.some((pattern) => pattern.test(segment)))
  );
}

// The config lane's folders. They hold data the game reads at runtime and the build copies into
// dist/ verbatim, so the lane accepts .json files only: a page or script there would be served from
// the game's origin without the code lane's typecheck and tests.
export const CONFIG_LANE_PATHS: readonly string[] = ['seed-1/config', 'seed-1/content'];
export const CONFIG_LANE_EXTENSION = '.json';

// Config lane may touch data only, and only seed-1 has a config lane. Code lane may touch its
// folder, which for platform is the site alone. An empty list means the lane does not exist for
// the folder.
export function lanePaths(folder: CardFolder, lane: CardLane): string[] {
  if (lane === 'code') return folder === 'platform' ? ['platform/site'] : [folder];
  return folder === 'seed-1' ? [...CONFIG_LANE_PATHS] : [];
}

// The kernel paths that lie inside the allowed paths, named in the session prompt.
export function protectedPaths(allowed: readonly string[]): string[] {
  return KERNEL_PATHS.filter((kernel) => allowed.some((dir) => under(kernel, dir)));
}

// Files outside the allowed paths, kernel files inside them, and, when the allowed paths are the
// config lane's, any file that is not .json.
export function outsideLane(files: readonly string[], allowed: readonly string[]): string[] {
  const configLane = allowed.length > 0 && allowed.every((dir) => CONFIG_LANE_PATHS.includes(dir));
  return files.filter(
    (file) => !allowed.some((dir) => under(file, dir)) || isKernelPath(file) || (configLane && !file.endsWith(CONFIG_LANE_EXTENSION)),
  );
}

export interface Worktree {
  path: string;
  branch: string;
  // The main sha the worktree was created at; the card's one commit must sit directly on it.
  baseSha: string;
}

const MAIN_REF = 'refs/remotes/origin/main';

// Fetches origin's main into its remote-tracking ref by full name, so a tag or branch named
// origin/main cannot stand in for it, and returns its commit sha.
export async function fetchMain(repoRoot: string, authEnv: NodeJS.ProcessEnv): Promise<string> {
  await git(['fetch', 'origin', `+refs/heads/main:${MAIN_REF}`], repoRoot, authEnv);
  return git(['rev-parse', '--verify', `${MAIN_REF}^{commit}`], repoRoot);
}

// The worktree starts at the sha rather than the remote-tracking ref, so git writes no upstream
// configuration for the branch.
// Worktree creation and removal touch refs, the worktree list and the remote-tracking ref that every
// card shares, so two cards never run them at once.
const repoLock = new Mutex();

export async function createWorktree(repoRoot: string, root: string, cardId: string, lane: CardLane, authEnv: NodeJS.ProcessEnv): Promise<Worktree> {
  return repoLock.run(async () => {
    const target = worktreePath(root, cardId);
    const branch = branchName(cardId, lane);
    await mkdir(root, { recursive: true });
    if (existsSync(target)) {
      await removeWorktreeUnlocked(repoRoot, target, null);
    }
    await git(['worktree', 'prune'], repoRoot);
    const baseSha = await fetchMain(repoRoot, authEnv);
    await git(['worktree', 'add', '-B', branch, target, baseSha], repoRoot);
    return { path: target, branch, baseSha };
  });
}

// A scratch checkout of origin/main for one job run (docs/specs/agent-workflows.md): detached, on no
// branch, under the worktree root as job-<id8>, and removed after the run.
export function scratchPath(root: string, runId: string): string {
  return path.join(root, `job-${shortId(runId)}`);
}

export async function createScratchWorktree(repoRoot: string, root: string, runId: string, authEnv: NodeJS.ProcessEnv): Promise<{ path: string; baseSha: string }> {
  return repoLock.run(async () => {
    const target = scratchPath(root, runId);
    await mkdir(root, { recursive: true });
    if (existsSync(target)) await removeWorktreeUnlocked(repoRoot, target, null);
    await git(['worktree', 'prune'], repoRoot);
    const baseSha = await fetchMain(repoRoot, authEnv);
    await git(['worktree', 'add', '--detach', target, baseSha], repoRoot);
    return { path: target, baseSha };
  });
}

// A file's text at a commit, or null when the commit has no such file.
export async function readFileAtSha(repoRoot: string, sha: string, file: string): Promise<string | null> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a commit sha: ${sha}`);
  if (file.startsWith('/') || file.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error(`not a repository path: ${file}`);
  try {
    await git(['cat-file', '-e', `${sha}:${file}`], repoRoot);
  } catch {
    return null;
  }
  return gitRaw(['show', `${sha}:${file}`], repoRoot);
}

export async function removeWorktree(repoRoot: string, target: string, branch: string | null): Promise<void> {
  await repoLock.run(() => removeWorktreeUnlocked(repoRoot, target, branch));
}

async function removeWorktreeUnlocked(repoRoot: string, target: string, branch: string | null): Promise<void> {
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

// On success, paths lists every path the commit changes, sorted, so the range GitHub reports can be
// compared with it before the merge.
export type CommitCheck = { ok: true; paths: string[] } | { ok: false; check: 'history' | 'lane_violation' | 'file_mode'; detail: string };

export interface CommitExpectation {
  baseSha: string;
  sha: string;
  allowed: readonly string[];
}

const SYMLINK_MODE = '120000';
const GITLINK_MODE = '160000';

export interface RawEntry {
  srcMode: string;
  dstMode: string;
  path: string;
}

// `diff-tree -r -z --raw` output: ":<src mode> <dst mode> <src sha> <dst sha> <status>" then the
// path, each ended by NUL. With renames off every entry carries one path.
export function parseRawDiff(output: string): RawEntry[] {
  const fields = output.split('\0');
  const entries: RawEntry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = fields[i] ?? '';
    if (!meta.startsWith(':')) continue;
    const [srcMode = '', dstMode = ''] = meta.slice(1).split(' ');
    entries.push({ srcMode, dstMode, path: fields[i + 1] ?? '' });
  }
  return entries;
}

// The pushed commit must be HEAD, the only commit on top of the base, with one parent, and change
// only regular files inside the lane. A session that committed itself, moved a kernel file into the
// lane or committed a symlink or submodule fails here, before anything is pushed.
export async function headSha(worktree: string): Promise<string> {
  return git(['rev-parse', '--verify', 'HEAD^{commit}'], worktree);
}

export async function verifyCardCommit(worktree: string, expected: CommitExpectation): Promise<CommitCheck> {
  const head = await headSha(worktree);
  if (head !== expected.sha) return { ok: false, check: 'history', detail: `HEAD is ${head}, not the dispatcher's commit ${expected.sha}` };
  const parents = (await git(['rev-list', '--parents', '-n', '1', expected.sha], worktree)).split(' ').slice(1);
  if (parents.length !== 1 || parents[0] !== expected.baseSha) {
    return { ok: false, check: 'history', detail: `commit ${expected.sha} has parents ${parents.join(', ') || 'none'}, not the base ${expected.baseSha}` };
  }
  const count = await git(['rev-list', '--count', `${expected.baseSha}..${expected.sha}`], worktree);
  if (count !== '1') return { ok: false, check: 'history', detail: `${count} commits sit on the base ${expected.baseSha}, not 1` };
  const entries = parseRawDiff(await gitRaw(['-c', 'core.quotePath=false', 'diff-tree', '-r', '-z', '--raw', '--no-renames', expected.baseSha, expected.sha], worktree));
  const stray = outsideLane(
    entries.map((entry) => entry.path),
    expected.allowed,
  );
  if (stray.length > 0) return { ok: false, check: 'lane_violation', detail: `committed changes outside the lane: ${stray.join(', ')}` };
  const special = entries.filter((entry) => [entry.srcMode, entry.dstMode].some((mode) => mode === SYMLINK_MODE || mode === GITLINK_MODE));
  if (special.length > 0) {
    return { ok: false, check: 'file_mode', detail: `symlinks or submodules committed: ${special.map((entry) => `${entry.path} (${entry.srcMode} -> ${entry.dstMode})`).join(', ')}` };
  }
  return { ok: true, paths: [...new Set(entries.map((entry) => entry.path))].sort() };
}

// The repository folder git reads configuration from: <repo>/.git, or the common folder a .git
// file points to.
export async function commonGitDir(repoRoot: string): Promise<string> {
  const dotGit = path.join(repoRoot, '.git');
  if ((await lstat(dotGit)).isDirectory()) return dotGit;
  const pointer = /^gitdir: (.+)$/m.exec(await readFile(dotGit, 'utf8'))?.[1]?.trim();
  if (!pointer) throw new Error(`${dotGit} is neither a folder nor a gitdir file`);
  const gitDir = path.resolve(repoRoot, pointer);
  const common = await readFile(path.join(gitDir, 'commondir'), 'utf8').catch(() => null);
  return common === null ? gitDir : path.resolve(gitDir, common.trim());
}

// One entry's state: missing, a symlink and its target, a folder and its names, or a file and its
// bytes.
async function entryState(file: string): Promise<Buffer> {
  let stat;
  try {
    stat = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.from('missing');
    throw error;
  }
  if (stat.isSymbolicLink()) return Buffer.from(`symlink ${await readlink(file)}`);
  if (stat.isDirectory()) return Buffer.from(`folder ${(await readdir(file)).sort().join('\0')}`);
  if (stat.isFile()) return Buffer.concat([Buffer.from('file '), await readFile(file)]);
  return Buffer.from(`other ${stat.mode}`);
}

// The worktree's own folder under <common>/worktrees, named by its .git file. A changed .git file
// changes the snapshot by itself, so reading the pointer here is safe.
export async function worktreeAdminDir(common: string, worktree: string): Promise<string> {
  const pointer = await readFile(path.join(worktree, '.git'), 'utf8')
    .then((text) => /^gitdir: (.+)$/m.exec(text)?.[1]?.trim() ?? null)
    .catch(() => null);
  return pointer ? path.resolve(worktree, pointer) : path.join(common, 'worktrees', path.basename(worktree));
}

// A sha256 over what git reads as configuration for the worktree: the common folder's config,
// config.worktree, info/attributes, info/exclude, info/grafts and the hooks listing, the worktree's own
// config.worktree, commondir and gitdir, and the worktree's .git file. It is read with node fs only,
// since running git against a tampered repository is what this guards. Taken before a session and
// again after, a difference means the session wrote git configuration that a later git call would
// act on.
export async function snapshotGitState(repoRoot: string, worktree: string): Promise<string> {
  const common = await commonGitDir(repoRoot);
  const admin = await worktreeAdminDir(common, worktree);
  const entries: Array<[string, string]> = [
    ['config', path.join(common, 'config')],
    ['config.worktree', path.join(common, 'config.worktree')],
    ['commondir', path.join(common, 'commondir')],
    ['objects/info/alternates', path.join(common, 'objects', 'info', 'alternates')],
    ['objects/info/http-alternates', path.join(common, 'objects', 'info', 'http-alternates')],
    ['info/attributes', path.join(common, 'info', 'attributes')],
    ['info/exclude', path.join(common, 'info', 'exclude')],
    ['info/grafts', path.join(common, 'info', 'grafts')],
    ['hooks', path.join(common, 'hooks')],
    ['worktree config.worktree', path.join(admin, 'config.worktree')],
    ['worktree commondir', path.join(admin, 'commondir')],
    ['worktree gitdir', path.join(admin, 'gitdir')],
    ['worktree .git', path.join(worktree, '.git')],
  ];
  const hash = createHash('sha256');
  for (const [label, file] of entries) {
    const state = await entryState(file);
    hash.update(`${label}\0${state.length}\0`);
    hash.update(state);
  }
  return hash.digest('hex');
}
