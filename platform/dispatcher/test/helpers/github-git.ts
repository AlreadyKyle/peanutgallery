// GitHub's compare and trees answers computed from a real bare repository, so pipeline tests can
// check the pushed range the way GitHub reports it.
import { execFileSync } from 'node:child_process';
import type { Reply } from './mock-fetch.js';

function git(origin: string, args: string[]): string {
  return execFileSync('git', args, { cwd: origin, stdio: 'pipe' }).toString();
}

const API = 'https://api.github.com/repos/owner/repo';
const COMPARE = /^https:\/\/api\.github\.com\/repos\/owner\/repo\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/;
const TREES = /^https:\/\/api\.github\.com\/repos\/owner\/repo\/git\/trees\/([0-9a-f]+)\?recursive=1$/;

export interface CompareFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

// GitHub's statuses for git's name-status letters; renames are detected, as GitHub does.
export function compareReply(origin: string, base: string, head: string, extraFiles: CompareFile[] = []): Reply {
  const fields = git(origin, ['diff', '--name-status', '-z', '-M', base, head]).split('\0');
  const files: CompareFile[] = [];
  for (let i = 0; i < fields.length - 1; ) {
    const status = fields[i] ?? '';
    if (status.startsWith('R')) {
      files.push({ filename: fields[i + 2] ?? '', status: 'renamed', previous_filename: fields[i + 1] ?? '' });
      i += 3;
    } else {
      files.push({ filename: fields[i + 1] ?? '', status: status === 'A' ? 'added' : status === 'D' ? 'removed' : 'modified' });
      i += 2;
    }
  }
  const commits = git(origin, ['rev-list', '--reverse', `${base}..${head}`]).split('\n').filter(Boolean);
  const behind = Number(git(origin, ['rev-list', '--count', `${head}..${base}`]).trim());
  const mergeBase = git(origin, ['merge-base', base, head]).trim();
  return {
    status: 200,
    json: { ahead_by: commits.length, behind_by: behind, merge_base_commit: { sha: mergeBase }, commits: commits.map((sha) => ({ sha })), files: [...files, ...extraFiles] },
  };
}

export function treeReply(origin: string, sha: string): Reply {
  const tree = git(origin, ['ls-tree', '-r', '-t', '-z', sha])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta = '', path = ''] = line.split('\t');
      const [mode = '', type = '', object = ''] = meta.split(' ');
      return { path, mode, type, sha: object };
    });
  return { status: 200, json: { sha, tree, truncated: false } };
}

// Answers compare and trees requests for the repository, or undefined for any other URL.
export function githubGitRoute(origin: string, extraFiles: CompareFile[] = []): (method: string, url: string) => Reply | undefined {
  return (method, url) => {
    if (method !== 'GET' || !url.startsWith(API)) return undefined;
    const compare = COMPARE.exec(url);
    if (compare) return compareReply(origin, compare[1]!, compare[2]!, extraFiles);
    const trees = TREES.exec(url);
    if (trees) return treeReply(origin, trees[1]!);
    return undefined;
  };
}
