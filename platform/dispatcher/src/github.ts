// GitHub: push the card branch, open the pull request, poll the gate check-run for the exact
// head sha, and squash-merge with a sha guard. The dispatcher is the merge enforcer.
import { errorMessage } from './log.js';
import { git, gitAuthEnv } from './worktree.js';
import { sleep } from './time.js';

export interface GitHubOptions {
  token: string;
  repo: string;
  fetchFn?: typeof fetch;
  apiBase?: string;
  // Per request; a request with no answer by then is aborted and throws.
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const GATE_CHECK_NAME = 'gate';
export const REQUEST_TIMEOUT_MS = 30_000;
const API_BASE = 'https://api.github.com';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// The request's own timeout, joined with the caller's signal when there is one.
export function requestSignal(timeoutMs: number | undefined, signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

async function request(opts: GitHubOptions, method: string, route: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const response = await fetchFn(`${opts.apiBase ?? API_BASE}${route}`, {
    method,
    signal: requestSignal(opts.timeoutMs, opts.signal),
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

// Card branches belong to the dispatcher; a stale branch from an interrupted run is overwritten. The
// verified commit is pushed by sha, never HEAD, so nothing that moves HEAD afterwards is published.
export async function pushBranch(worktree: string, branch: string, token: string, sha: string): Promise<void> {
  await git(['push', '--force', 'origin', `${sha}:refs/heads/${branch}`], worktree, gitAuthEnv(token));
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

// The GitHub Actions app. Any app with checks:write can post a check run named gate, so only the
// ones Actions created count. Among workflows only gate.yml defines a job named gate: the gate
// tests read every file in .github/workflows (a kernel path) and fail on a second one, so an
// Actions run named gate comes from gate.yml.
export const ACTIONS_APP_SLUG = 'github-actions';

function isActionsGateRun(run: Record<string, unknown>): boolean {
  return run.name === GATE_CHECK_NAME && isRecord(run.app) && run.app.slug === ACTIONS_APP_SLUG;
}

// Every Actions gate run on the sha must pass. The API's default filter keeps each run's latest
// attempt, so a re-run replaces the attempt it repeats. Missing: no Actions gate run yet. Fail: any
// completed run concluded other than success, cancelled included. Pending: none failed and one is
// still running. Pass: all completed with success.
export async function gateStatus(opts: GitHubOptions, sha: string): Promise<GateStatus> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/commits/${sha}/check-runs?check_name=${GATE_CHECK_NAME}&per_page=50`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github check-runs: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const runs = (Array.isArray(result.json.check_runs) ? result.json.check_runs.filter(isRecord) : []).filter(isActionsGateRun);
  if (runs.length === 0) return { state: 'missing' };
  const failed = runs.find((run) => run.status === 'completed' && run.conclusion !== 'success');
  if (failed) return { state: 'fail', conclusion: String(failed.conclusion ?? 'unknown') };
  if (runs.some((run) => run.status !== 'completed')) return { state: 'pending' };
  return { state: 'pass' };
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

// Closes a pull request the dispatcher will not merge. A pull request already closed or merged is
// left as it is.
export async function closePullRequest(opts: GitHubOptions, number: number): Promise<void> {
  const result = await request(opts, 'PATCH', `/repos/${opts.repo}/pulls/${number}`, { state: 'closed' });
  if (result.status !== 200) throw new Error(`github close pull request ${number}: http ${result.status} ${apiMessage(result.json)}`.trim());
}

export interface PullState {
  headSha: string | null;
  merged: boolean;
  mergeCommitSha: string | null;
}

export async function readPullRequest(opts: GitHubOptions, number: number): Promise<PullState> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/pulls/${number}`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github pull request ${number}: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const head = isRecord(result.json.head) ? result.json.head : {};
  return {
    headSha: typeof head.sha === 'string' ? head.sha : null,
    merged: result.json.merged === true,
    mergeCommitSha: typeof result.json.merge_commit_sha === 'string' ? result.json.merge_commit_sha : null,
  };
}

export interface BranchPull {
  number: number;
  merged: boolean;
  mergeCommitSha: string | null;
  open: boolean;
}

// The newest pull request whose head is the branch, in any state. For a card that reached gated this
// is the pull request of its latest claim: gated follows the push and the pull request, and an older
// pull request for the same branch is either that one reused or older than it.
export async function findPullForBranch(opts: GitHubOptions, branch: string): Promise<BranchPull | null> {
  const owner = opts.repo.split('/')[0] ?? '';
  const head = encodeURIComponent(`${owner}:${branch}`);
  const result = await request(opts, 'GET', `/repos/${opts.repo}/pulls?state=all&head=${head}&sort=created&direction=desc&per_page=1`);
  if (result.status !== 200 || !Array.isArray(result.json)) {
    throw new Error(`github pull requests for ${branch}: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const pull = result.json.find(isRecord);
  if (!pull || typeof pull.number !== 'number') return null;
  return {
    number: pull.number,
    merged: typeof pull.merged_at === 'string' && pull.merged_at.length > 0,
    mergeCommitSha: typeof pull.merge_commit_sha === 'string' ? pull.merge_commit_sha : null,
    open: pull.state === 'open',
  };
}

export async function mainHead(opts: GitHubOptions): Promise<string> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/git/ref/heads/main`);
  const object = isRecord(result.json) && isRecord(result.json.object) ? result.json.object : {};
  if (result.status !== 200 || typeof object.sha !== 'string') {
    throw new Error(`github ref main: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  return object.sha;
}

export interface RangeFile {
  path: string;
  status: string;
  previousPath: string | null;
}

export interface RemoteRange {
  aheadBy: number;
  behindBy: number;
  mergeBaseSha: string | null;
  commits: string[];
  files: RangeFile[];
}

// GitHub lists at most this many files in a compare; a longer list is not complete.
export const COMPARE_FILE_LIMIT = 300;

export async function compareRange(opts: GitHubOptions, base: string, head: string): Promise<RemoteRange> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/compare/${base}...${head}`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github compare ${base}...${head}: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const json = result.json;
  const mergeBase = isRecord(json.merge_base_commit) && typeof json.merge_base_commit.sha === 'string' ? json.merge_base_commit.sha : null;
  const commits = Array.isArray(json.commits) ? json.commits.filter(isRecord).map((commit) => String(commit.sha ?? '')) : [];
  const files = Array.isArray(json.files)
    ? json.files.filter(isRecord).map((file) => ({
        path: String(file.filename ?? ''),
        status: String(file.status ?? ''),
        previousPath: typeof file.previous_filename === 'string' ? file.previous_filename : null,
      }))
    : [];
  return { aheadBy: Number(json.ahead_by ?? -1), behindBy: Number(json.behind_by ?? -1), mergeBaseSha: mergeBase, commits, files };
}

// Every entry's mode in a commit's tree, by path. A truncated tree is refused: a mode it left out
// cannot be checked.
export async function treeModes(opts: GitHubOptions, sha: string): Promise<Map<string, string>> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/git/trees/${sha}?recursive=1`);
  if (result.status !== 200 || !isRecord(result.json) || !Array.isArray(result.json.tree)) {
    throw new Error(`github tree ${sha}: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  if (result.json.truncated === true) throw new Error(`github tree ${sha}: truncated`);
  return new Map(result.json.tree.filter(isRecord).map((entry) => [String(entry.path ?? ''), String(entry.mode ?? '')]));
}

export const PULL_HEAD_TIMEOUT_MS = 60_000;
export const PULL_HEAD_INTERVAL_MS = 2_000;

// An existing pull request can report its old head for a moment after a force-push. Polls until the
// head is the pushed sha; false when it is not by the deadline.
export async function waitForPullHead(opts: GitHubOptions, number: number, sha: string, poll: PollOptions = { timeoutMs: PULL_HEAD_TIMEOUT_MS, intervalMs: PULL_HEAD_INTERVAL_MS }): Promise<boolean> {
  const deadline = Date.now() + poll.timeoutMs;
  for (;;) {
    if ((await readPullRequest(opts, number)).headSha === sha) return true;
    if (poll.signal?.aborted || Date.now() >= deadline) return false;
    await sleep(poll.intervalMs, poll.signal);
  }
}

// unknown marks a merge request that was lost and a pull request that did not show merged in time:
// GitHub may still merge it, so the card must not be treated as refused.
export type MergeResult = { ok: true; sha: string } | { ok: false; status: number; reason: string; unknown?: true };

export const MERGE_STATE_TIMEOUT_MS = 60_000;
export const MERGE_STATE_INTERVAL_MS = 2_000;

// When the merge request itself fails (a network error or a timeout), GitHub may still have merged.
// The pull request is read until it shows merged or the deadline passes; a read that fails is tried
// again at the next interval.
async function mergeStateAfterLostRequest(opts: GitHubOptions, number: number, cause: unknown, poll: PollOptions): Promise<MergeResult> {
  const deadline = Date.now() + poll.timeoutMs;
  let lastReadError: unknown = null;
  for (;;) {
    try {
      const pull = await readPullRequest(opts, number);
      if (pull.merged && pull.mergeCommitSha) return { ok: true, sha: pull.mergeCommitSha };
      lastReadError = null;
    } catch (error) {
      lastReadError = error;
    }
    if (poll.signal?.aborted || Date.now() >= deadline) break;
    await sleep(poll.intervalMs, poll.signal);
  }
  const unread = lastReadError === null ? '' : `, and its last read failed (${errorMessage(lastReadError)})`;
  return {
    ok: false,
    status: 0,
    unknown: true,
    reason: `the merge request failed (${errorMessage(cause)}) and pull request ${number} did not show merged within ${poll.timeoutMs / 1000} s${unread}`,
  };
}

export async function mergePullRequest(
  opts: GitHubOptions,
  number: number,
  headSha: string,
  commit: { title: string; message: string },
  lost: PollOptions = { timeoutMs: MERGE_STATE_TIMEOUT_MS, intervalMs: MERGE_STATE_INTERVAL_MS },
): Promise<MergeResult> {
  let result: { status: number; json: unknown };
  try {
    result = await request(opts, 'PUT', `/repos/${opts.repo}/pulls/${number}/merge`, {
      sha: headSha,
      merge_method: 'squash',
      commit_title: commit.title,
      commit_message: commit.message,
    });
  } catch (error) {
    return mergeStateAfterLostRequest(opts, number, error, lost);
  }
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
