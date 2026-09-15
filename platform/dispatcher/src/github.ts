// GitHub: push the card branch, open the pull request, poll the gate check-run for the exact
// head sha, and squash-merge with a sha guard. The dispatcher is the merge enforcer.
import { git, gitAuthArgs } from './worktree.js';
import { sleep } from './time.js';

export interface GitHubOptions {
  token: string;
  repo: string;
  fetchFn?: typeof fetch;
  apiBase?: string;
}

export const GATE_CHECK_NAME = 'gate';
const API_BASE = 'https://api.github.com';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function request(opts: GitHubOptions, method: string, route: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const response = await fetchFn(`${opts.apiBase ?? API_BASE}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'backseat-dispatcher',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const textBody = await response.text();
  let json: unknown = null;
  if (textBody.length > 0) {
    try {
      json = JSON.parse(textBody);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

function apiMessage(json: unknown): string {
  return isRecord(json) && typeof json.message === 'string' ? json.message : '';
}

// Card branches belong to the dispatcher; a stale branch from an interrupted run is overwritten.
export async function pushBranch(worktree: string, branch: string, token: string): Promise<void> {
  await git([...gitAuthArgs(token), 'push', '--force', 'origin', `HEAD:refs/heads/${branch}`], worktree);
}

export interface PullRequest {
  number: number;
  headSha: string;
}

export async function openPullRequest(opts: GitHubOptions, input: { head: string; title: string; body: string }): Promise<PullRequest> {
  const created = await request(opts, 'POST', `/repos/${opts.repo}/pulls`, { title: input.title, head: input.head, base: 'main', body: input.body });
  if (created.status === 201 && isRecord(created.json)) {
    return toPullRequest(created.json);
  }
  if (created.status === 422) {
    const owner = opts.repo.split('/')[0] ?? '';
    const existing = await request(opts, 'GET', `/repos/${opts.repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.head}`)}`);
    if (existing.status === 200 && Array.isArray(existing.json) && existing.json.length > 0 && isRecord(existing.json[0])) {
      return toPullRequest(existing.json[0]);
    }
  }
  throw new Error(`github open pull request: http ${created.status} ${apiMessage(created.json)}`.trim());
}

function toPullRequest(json: Record<string, unknown>): PullRequest {
  const head = isRecord(json.head) ? json.head : {};
  if (typeof json.number !== 'number' || typeof head.sha !== 'string') {
    throw new Error('github open pull request: response is missing number or head sha');
  }
  return { number: json.number, headSha: head.sha };
}

export type GateStatus = { state: 'pass' } | { state: 'fail'; conclusion: string } | { state: 'pending' } | { state: 'missing' };

export async function gateStatus(opts: GitHubOptions, sha: string): Promise<GateStatus> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/commits/${sha}/check-runs?check_name=${GATE_CHECK_NAME}&per_page=50`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github check-runs: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const runs = Array.isArray(result.json.check_runs) ? result.json.check_runs.filter(isRecord) : [];
  const gate = runs.find((run) => run.name === GATE_CHECK_NAME);
  if (!gate) return { state: 'missing' };
  if (gate.status !== 'completed') return { state: 'pending' };
  return gate.conclusion === 'success' ? { state: 'pass' } : { state: 'fail', conclusion: String(gate.conclusion ?? 'unknown') };
}

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
  signal?: AbortSignal;
}

// Polls until the gate completes; a missing check-run keeps polling because Actions can take
// a moment to register it after the push.
export async function waitForGate(opts: GitHubOptions, sha: string, poll: PollOptions): Promise<GateStatus> {
  const deadline = Date.now() + poll.timeoutMs;
  let status = await gateStatus(opts, sha);
  while (status.state === 'pending' || status.state === 'missing') {
    if (poll.signal?.aborted || Date.now() >= deadline) return status;
    await sleep(poll.intervalMs, poll.signal);
    status = await gateStatus(opts, sha);
  }
  return status;
}

export type MergeResult = { ok: true; sha: string } | { ok: false; status: number; reason: string };

export async function mergePullRequest(
  opts: GitHubOptions,
  number: number,
  headSha: string,
  commit: { title: string; message: string },
): Promise<MergeResult> {
  const result = await request(opts, 'PUT', `/repos/${opts.repo}/pulls/${number}/merge`, {
    sha: headSha,
    merge_method: 'squash',
    commit_title: commit.title,
    commit_message: commit.message,
  });
  if (result.status === 200 && isRecord(result.json) && typeof result.json.sha === 'string') {
    return { ok: true, sha: result.json.sha };
  }
  if (result.status === 409) {
    return { ok: false, status: 409, reason: `head sha ${headSha} no longer matches the pull request` };
  }
  if (result.status === 405) {
    return { ok: false, status: 405, reason: apiMessage(result.json) || 'pull request is not mergeable' };
  }
  return { ok: false, status: result.status, reason: apiMessage(result.json) || `http ${result.status}` };
}

export type RevertResult = { ok: true; sha: string } | { ok: false; reason: string };

// Takes a squash merge back out of main with a new commit whose tree is the merge commit's
// parent tree and whose parent is the merge commit. The ref update is fast-forward only, so it is
// refused when main has moved past the merge; nothing is ever force-pushed.
export async function revertMerge(opts: GitHubOptions, mergeSha: string, message: string): Promise<RevertResult> {
  const merged = await request(opts, 'GET', `/repos/${opts.repo}/git/commits/${mergeSha}`);
  if (merged.status !== 200 || !isRecord(merged.json)) {
    return { ok: false, reason: `read merge commit ${mergeSha}: http ${merged.status} ${apiMessage(merged.json)}`.trim() };
  }
  const parents = Array.isArray(merged.json.parents) ? merged.json.parents.filter(isRecord) : [];
  const parentSha = parents[0]?.sha;
  if (parents.length !== 1 || typeof parentSha !== 'string') {
    return { ok: false, reason: `merge commit ${mergeSha} has ${parents.length} parents; only a squash merge is reverted` };
  }
  const parent = await request(opts, 'GET', `/repos/${opts.repo}/git/commits/${parentSha}`);
  const tree = isRecord(parent.json) && isRecord(parent.json.tree) ? parent.json.tree.sha : undefined;
  if (parent.status !== 200 || typeof tree !== 'string') {
    return { ok: false, reason: `read parent commit ${parentSha}: http ${parent.status} ${apiMessage(parent.json)}`.trim() };
  }
  const created = await request(opts, 'POST', `/repos/${opts.repo}/git/commits`, { message, tree, parents: [mergeSha] });
  const sha = isRecord(created.json) ? created.json.sha : undefined;
  if (created.status !== 201 || typeof sha !== 'string') {
    return { ok: false, reason: `create revert commit: http ${created.status} ${apiMessage(created.json)}`.trim() };
  }
  const moved = await request(opts, 'PATCH', `/repos/${opts.repo}/git/refs/heads/main`, { sha, force: false });
  if (moved.status !== 200) {
    return { ok: false, reason: `main was not moved to the revert commit ${sha}: http ${moved.status} ${apiMessage(moved.json)}`.trim() };
  }
  return { ok: true, sha };
}
