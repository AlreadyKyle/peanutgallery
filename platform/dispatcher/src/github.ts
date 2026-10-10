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

// Conclusions a gate run reaches without having judged the change (docs/specs/money-safety.md):
// cancelled (stopped by a person or a newer run), startup_failure (the workflow never started, as
// when the account's Actions minutes are gone) and stale (GitHub gave up on it). A card is never
// rejected for one of these.
export const INFRASTRUCTURE_CONCLUSIONS: readonly string[] = ['cancelled', 'startup_failure', 'stale'];

export function isInfrastructureConclusion(conclusion: string): boolean {
  return INFRASTRUCTURE_CONCLUSIONS.includes(conclusion);
}

// The gate is the workflow .github/workflows/gate.yml, a kernel path; its last job, named gate, needs
// every other job, so the workflow run's conclusion is the gate's. The dispatcher reads workflow runs
// through the Actions API, because a fine-grained token cannot read check runs (GitHub answers 403)
// and the dispatcher's token holds Actions read (docs/PLAN.md §10 decision 30). Only Actions creates
// workflow runs, so no other app can post a passing gate.
export const GATE_WORKFLOW_PATH = '.github/workflows/gate.yml';

function isGateWorkflowRun(run: Record<string, unknown>): boolean {
  return run.path === GATE_WORKFLOW_PATH;
}

// Every gate workflow run on the sha must pass (a pull request and a push to main each start one).
// The API lists each run's latest attempt, so a re-run replaces the attempt it repeats. Missing: no
// gate run yet. Fail: any completed run concluded other than success, cancelled and startup_failure
// included. Pending: none failed and one is still queued or running. Pass: all completed with success.
export async function gateStatus(opts: GitHubOptions, sha: string): Promise<GateStatus> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/actions/runs?head_sha=${sha}&per_page=50`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github workflow runs: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const all = Array.isArray(result.json.workflow_runs) ? result.json.workflow_runs.filter(isRecord) : [];
  const runs = all.filter(isGateWorkflowRun);
  if (runs.length === 0) return { state: 'missing' };
  const failed = runs.find((run) => run.status === 'completed' && run.conclusion !== 'success');
  if (failed) return { state: 'fail', conclusion: String(failed.conclusion ?? 'unknown') };
  if (runs.some((run) => run.status !== 'completed')) return { state: 'pending' };
  return { state: 'pass' };
}

// The newest gate workflow run on the sha that completed with success, or null when there is none:
// the run whose artifacts the visual review reads (docs/specs/design-review.md).
export interface GateRun {
  id: number;
  htmlUrl: string | null;
}

export async function gateRunForSha(opts: GitHubOptions, sha: string): Promise<GateRun | null> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/actions/runs?head_sha=${sha}&per_page=50`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github workflow runs: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const all = Array.isArray(result.json.workflow_runs) ? result.json.workflow_runs.filter(isRecord) : [];
  const passed = all.filter((run) => isGateWorkflowRun(run) && run.status === 'completed' && run.conclusion === 'success' && typeof run.id === 'number');
  if (passed.length === 0) return null;
  const newest = passed.reduce((a, b) => ((b.id as number) > (a.id as number) ? b : a));
  return { id: newest.id as number, htmlUrl: typeof newest.html_url === 'string' ? newest.html_url : null };
}

export interface RunArtifact {
  id: number;
  name: string;
  expired: boolean;
  sizeInBytes: number;
}

// A workflow run's artifacts (the first hundred; the gate uploads at most one).
export async function listRunArtifacts(opts: GitHubOptions, runId: number): Promise<RunArtifact[]> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/actions/runs/${runId}/artifacts?per_page=100`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github run artifacts: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const artifacts = Array.isArray(result.json.artifacts) ? result.json.artifacts.filter(isRecord) : [];
  return artifacts
    .filter((artifact) => typeof artifact.id === 'number' && typeof artifact.name === 'string')
    .map((artifact) => ({
      id: artifact.id as number,
      name: artifact.name as string,
      expired: artifact.expired === true,
      sizeInBytes: typeof artifact.size_in_bytes === 'number' ? artifact.size_in_bytes : 0,
    }));
}

// An artifact's zip. GitHub answers the download with a 302 to a short-lived storage address, which
// is fetched without the token, so the token never leaves api.github.com. A zip larger than maxBytes
// is refused.
export async function downloadArtifact(opts: GitHubOptions, id: number, maxBytes: number): Promise<Uint8Array> {
  const fetchFn = opts.fetchFn ?? fetch;
  const first = await fetchFn(`${opts.apiBase ?? API_BASE}/repos/${opts.repo}/actions/artifacts/${id}/zip`, {
    method: 'GET',
    redirect: 'manual',
    signal: requestSignal(opts.timeoutMs, opts.signal),
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'backseat-dispatcher',
    },
  });
  const location = first.headers.get('location');
  await first.body?.cancel().catch(() => undefined);
  if (first.status !== 302 || !location) throw new Error(`github artifact ${id} download: http ${first.status}${location ? '' : ', no location'}`);
  if (!location.startsWith('https://')) throw new Error(`github artifact ${id} download: the location is not https`);
  const zip = await fetchFn(location, { method: 'GET', signal: requestSignal(opts.timeoutMs, opts.signal) });
  if (zip.status !== 200) throw new Error(`github artifact ${id} download: storage answered http ${zip.status}`);
  const declared = Number(zip.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new Error(`github artifact ${id} is ${declared} bytes, over the ${maxBytes}-byte limit`);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`github artifact ${id} is ${bytes.byteLength} bytes, over the ${maxBytes}-byte limit`);
  return bytes;
}

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
  signal?: AbortSignal;
}

// Polls until the gate completes; a missing workflow run keeps polling because Actions can take
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
  // A 5xx is as lost as a timeout: GitHub answers a merge that ran long with one while the merge goes
  // ahead, so the pull request is read before the merge is called refused.
  if (result.status >= 500) {
    return mergeStateAfterLostRequest(opts, number, new Error(`http ${result.status} ${apiMessage(result.json)}`.trim()), lost);
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

// What the Janitor's upkeep jobs read (docs/specs/agent-upkeep.md): the open pull requests one author
// opened, a file at a commit, a commit's verification, the newest completed run of a workflow on a
// branch and that run's jobs, and a comment.

export interface AuthorPull {
  number: number;
  title: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  createdAt: string;
  htmlUrl: string | null;
}

// The open pull requests the login opened, oldest first (the first hundred open pull requests).
export async function openPullsByAuthor(opts: GitHubOptions, login: string): Promise<AuthorPull[]> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/pulls?state=open&sort=created&direction=asc&per_page=100`);
  if (result.status !== 200 || !Array.isArray(result.json)) {
    throw new Error(`github open pull requests: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  return result.json
    .filter(isRecord)
    .filter((pull) => isRecord(pull.user) && pull.user.login === login)
    .map((pull) => {
      const head = isRecord(pull.head) ? pull.head : {};
      const base = isRecord(pull.base) ? pull.base : {};
      return {
        number: Number(pull.number),
        title: String(pull.title ?? ''),
        headSha: String(head.sha ?? ''),
        headRef: String(head.ref ?? ''),
        baseRef: String(base.ref ?? ''),
        createdAt: String(pull.created_at ?? ''),
        htmlUrl: typeof pull.html_url === 'string' ? pull.html_url : null,
      };
    })
    .filter((pull) => Number.isInteger(pull.number) && pull.headSha !== '')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number);
}

// A file's text at a commit, or null when the commit has no such file. The raw media type returns
// the bytes themselves, whatever the file's size.
export async function fileAtRef(opts: GitHubOptions, file: string, ref: string): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const route = file.split('/').map(encodeURIComponent).join('/');
  const response = await fetchFn(`${opts.apiBase ?? API_BASE}/repos/${opts.repo}/contents/${route}?ref=${encodeURIComponent(ref)}`, {
    method: 'GET',
    signal: requestSignal(opts.timeoutMs, opts.signal),
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'backseat-dispatcher',
    },
  });
  const body = await response.text();
  if (response.status === 404) return null;
  if (response.status !== 200) throw new Error(`github contents ${file}@${ref.slice(0, 12)}: http ${response.status}`);
  return body;
}

export interface CommitInfoRemote {
  verified: boolean;
  reason: string | null;
  // The committer date, which moves when the commit is rewritten, as a rebase does.
  committedAt: string | null;
}

export async function commitInfo(opts: GitHubOptions, sha: string): Promise<CommitInfoRemote> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/commits/${sha}`);
  if (result.status !== 200 || !isRecord(result.json) || !isRecord(result.json.commit)) {
    throw new Error(`github commit ${sha.slice(0, 12)}: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const commit = result.json.commit;
  const verification = isRecord(commit.verification) ? commit.verification : {};
  const committer = isRecord(commit.committer) ? commit.committer : {};
  return {
    verified: verification.verified === true,
    reason: typeof verification.reason === 'string' ? verification.reason : null,
    committedAt: typeof committer.date === 'string' ? committer.date : null,
  };
}

export interface WorkflowRunSummary {
  id: number;
  htmlUrl: string | null;
  headSha: string;
  conclusion: string | null;
}

// The newest completed run of a workflow file on a branch, or null when it has none.
export async function latestCompletedRun(opts: GitHubOptions, workflowFile: string, branch: string): Promise<WorkflowRunSummary | null> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=1`);
  if (result.status === 404) return null;
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github ${workflowFile} runs: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  const run = (Array.isArray(result.json.workflow_runs) ? result.json.workflow_runs : []).find(isRecord);
  if (!run || typeof run.id !== 'number') return null;
  return {
    id: run.id,
    htmlUrl: typeof run.html_url === 'string' ? run.html_url : null,
    headSha: String(run.head_sha ?? ''),
    conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
  };
}

export interface RunJob {
  name: string;
  conclusion: string | null;
  htmlUrl: string | null;
}

export async function runJobs(opts: GitHubOptions, runId: number): Promise<RunJob[]> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/actions/runs/${runId}/jobs?per_page=100`);
  if (result.status !== 200 || !isRecord(result.json)) {
    throw new Error(`github run ${runId} jobs: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  return (Array.isArray(result.json.jobs) ? result.json.jobs : []).filter(isRecord).map((job) => ({
    name: String(job.name ?? ''),
    conclusion: typeof job.conclusion === 'string' ? job.conclusion : null,
    htmlUrl: typeof job.html_url === 'string' ? job.html_url : null,
  }));
}

export interface IssueComment {
  body: string;
  createdAt: string;
}

// A pull request's comments (the first hundred).
export async function pullComments(opts: GitHubOptions, number: number): Promise<IssueComment[]> {
  const result = await request(opts, 'GET', `/repos/${opts.repo}/issues/${number}/comments?per_page=100`);
  if (result.status !== 200 || !Array.isArray(result.json)) {
    throw new Error(`github comments on ${number}: http ${result.status} ${apiMessage(result.json)}`.trim());
  }
  return result.json.filter(isRecord).map((comment) => ({ body: String(comment.body ?? ''), createdAt: String(comment.created_at ?? '') }));
}

export async function commentOnPull(opts: GitHubOptions, number: number, body: string): Promise<void> {
  const result = await request(opts, 'POST', `/repos/${opts.repo}/issues/${number}/comments`, { body });
  if (result.status !== 201) throw new Error(`github comment on ${number}: http ${result.status} ${apiMessage(result.json)}`.trim());
}
