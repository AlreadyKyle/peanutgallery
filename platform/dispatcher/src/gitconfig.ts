// The repository's own git configuration, read with node fs and held to an allowlist. The dispatcher
// runs git with system and global configuration off (worktree.ts), so these files are all the
// configuration its git reads. Only the keys git writes for a clone, a fetch, a worktree and a branch
// are allowed; anything else, and above all a key that runs a program (gpg.program, filter drivers,
// core.fsmonitor, credential helpers), redirects network traffic (url.*, http.proxy) or pulls in
// another file (include, includeIf), is refused. A line the parser cannot read is refused too.
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { commonGitDir, worktreeAdminDir } from './worktree.js';

export interface ConfigEntry {
  key: string;
  line: number;
}

export interface ParsedConfig {
  entries: ConfigEntry[];
  errors: string[];
}

// [section], [section "subsection"], and the old [section.subsection], optionally followed by a
// variable on the same line.
const SECTION = /^\[\s*([A-Za-z0-9.-]+)\s*(?:"((?:[^"\\]|\\.)*)")?\s*\](.*)$/;
const VARIABLE = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=.*)?$/;

function endsWithContinuation(line: string): boolean {
  const trailing = /\\+$/.exec(line)?.[0].length ?? 0;
  return trailing % 2 === 1;
}

// Keys come out as git names them: section and variable in lower case, a quoted subsection as written,
// the old dotted subsection in lower case.
export function parseGitConfig(text: string): ParsedConfig {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const entries: ConfigEntry[] = [];
  const errors: string[] = [];
  let prefix: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const number = i + 1;
    let raw = lines[i] ?? '';
    while (endsWithContinuation(raw) && i + 1 < lines.length) {
      i += 1;
      raw = `${raw.slice(0, -1)}${lines[i] ?? ''}`;
    }
    let line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      const section = SECTION.exec(line);
      if (!section) {
        errors.push(`line ${number}: cannot read "${line}"`);
        prefix = null;
        continue;
      }
      const name = section[1] ?? '';
      const dot = name.indexOf('.');
      if (section[2] !== undefined) prefix = `${name.toLowerCase()}.${section[2].replace(/\\(.)/g, '$1')}.`;
      else if (dot >= 0) prefix = `${name.slice(0, dot).toLowerCase()}.${name.slice(dot + 1).toLowerCase()}.`;
      else prefix = `${name.toLowerCase()}.`;
      line = (section[3] ?? '').trim();
      if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    }
    const variable = VARIABLE.exec(line);
    if (!variable) {
      errors.push(`line ${number}: cannot read "${line}"`);
      continue;
    }
    if (prefix === null) {
      errors.push(`line ${number}: a variable before any section`);
      continue;
    }
    entries.push({ key: `${prefix}${(variable[1] ?? '').toLowerCase()}`, line: number });
  }
  return { entries, errors };
}

// What git 2.39 (Debian bookworm, the dispatcher image) and current macOS git write for init, clone,
// fetch, worktree add and branch -D, plus any per-branch key. lfs.repositoryformatversion is data that
// git-lfs install writes; its filters live in the global configuration, which the dispatcher's git
// never reads.
//
// Per-branch keys are allowed whatever their name, since gh, GitHub Desktop and IDEs write their own
// (branch.<name>.gh-merge-base, branch.<name>.vscode-merge-base) on a founder's checkout. No
// branch.<name>.<key> runs a program or redirects traffic: git's own (remote, pushRemote, merge,
// mergeOptions, rebase, description) are read by pull, merge and a push with no remote named, none of
// which the dispatcher runs. A remote or pushRemote naming anything but origin points at a
// remote.<name>.* definition, which is refused, and pushBranch and fetchMain name origin explicitly.
// The two-part branch.* settings (autoSetupMerge and the like) are not per-branch and stay refused.
const ALLOWED: readonly RegExp[] = [
  /^core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks)$/,
  /^remote\.origin\.(url|fetch)$/,
  /^branch\..+\.[a-z][a-z0-9-]*$/,
  /^extensions\.(objectformat|refstorage)$/,
  /^lfs\.repositoryformatversion$/,
];

export function refusedKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => !ALLOWED.some((pattern) => pattern.test(key)));
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function names(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

// Files that send git's configuration, attributes or objects somewhere else, or that git would run.
// Git itself writes none of them for the dispatcher's use, so their presence is refused:
// - a commondir in the main repository, which points git at another common folder;
// - info/attributes, which can name a filter or diff driver for every path;
// - info/grafts, which rewrites history as git reads it;
// - objects/info/alternates and http-alternates, which read objects from elsewhere;
// - a hook other than git's own *.sample files;
// - a config.worktree in any worktree's folder;
// - a worktree commondir other than git's "../..".
export async function gitLayoutViolations(repoRoot: string): Promise<string[]> {
  const common = await commonGitDir(repoRoot);
  const label = (file: string) => path.relative(repoRoot, file) || file;
  const violations: string[] = [];
  const refusedFiles = [
    path.join(repoRoot, '.git', 'commondir'),
    path.join(common, 'info', 'attributes'),
    path.join(common, 'info', 'grafts'),
    path.join(common, 'objects', 'info', 'alternates'),
    path.join(common, 'objects', 'info', 'http-alternates'),
  ];
  for (const file of [...new Set(refusedFiles)]) {
    if (await exists(file)) violations.push(`${label(file)}: present`);
  }
  for (const hook of await names(path.join(common, 'hooks'))) {
    if (!hook.endsWith('.sample')) violations.push(`${label(path.join(common, 'hooks', hook))}: a hook that is not a sample`);
  }
  for (const name of await names(path.join(common, 'worktrees'))) {
    const admin = path.join(common, 'worktrees', name);
    if (await exists(path.join(admin, 'config.worktree'))) violations.push(`${label(path.join(admin, 'config.worktree'))}: present`);
    const commondir = await readIfPresent(path.join(admin, 'commondir'));
    if (commondir !== null && commondir.trim() !== '../..') violations.push(`${label(path.join(admin, 'commondir'))}: not ../..`);
  }
  return violations;
}

// Every refused file (gitLayoutViolations), and every refused key and unreadable line in the common
// config, the common config.worktree and, for a worktree, its own config.worktree, as
// "<file> line <n>: <key>". Empty means allowed.
export async function gitConfigViolations(repoRoot: string, worktree: string | null): Promise<string[]> {
  const common = await commonGitDir(repoRoot);
  const files = [path.join(common, 'config'), path.join(common, 'config.worktree')];
  if (worktree) files.push(path.join(await worktreeAdminDir(common, worktree), 'config.worktree'));
  const violations: string[] = await gitLayoutViolations(repoRoot);
  for (const file of files) {
    const text = await readIfPresent(file);
    if (text === null) continue;
    const label = path.relative(repoRoot, file) || file;
    const parsed = parseGitConfig(text);
    for (const error of parsed.errors) violations.push(`${label} ${error}`);
    const refused = new Set(refusedKeys(parsed.entries.map((entry) => entry.key)));
    for (const entry of parsed.entries) {
      if (refused.has(entry.key)) violations.push(`${label} line ${entry.line}: ${entry.key}`);
    }
  }
  return violations;
}

// remote.origin.url, read the same way, for the startup check.
export async function originUrl(repoRoot: string): Promise<string | null> {
  const text = await readIfPresent(path.join(await commonGitDir(repoRoot), 'config'));
  if (text === null) return null;
  const lines = text.split(/\r?\n/);
  let inOrigin = false;
  for (const raw of lines) {
    const line = raw.trim();
    const section = SECTION.exec(line);
    if (section) {
      inOrigin = (section[1] ?? '').toLowerCase() === 'remote' && section[2] === 'origin';
      continue;
    }
    const url = /^url\s*=\s*(.*)$/i.exec(line);
    if (inOrigin && url) return (url[1] ?? '').trim().replace(/^"(.*)"$/, '$1');
  }
  return null;
}
