// The life of one claimed card: worktree, pre-check, agent session (or the card's stored patch, when
// an earlier managed session's patch was accepted), git state check, post-check,
// commit, range check, push, pull request, gate, remote range check, merge, deploy, smoke; then live
// with a ship event, or rejected with the failing check. A merged change that fails its deploy or
// smoke, or whose verification throws before a verdict, is reverted on main, and the previous green
// deploy is restored unless the deploy itself failed. A merged change the dispatcher cannot finish
// verifying or recording, or a merge whose outcome is unknown, is left gated, and recovery.ts resolves
// it at startup. The board is alerted whenever a card stops short of live for a reason other than the
// dispatcher stopping before the merge.
import { lstat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseChecks, evaluateCheck, AcceptanceGrammarError, type ConfigCheck } from './acceptance.js';
import type { AgentAdapter, CardFolder } from './adapters/types.js';
import type { Alerter } from './alert.js';
import type { DispatcherConfig } from './config.js';
import type { Card, Db, Role } from './db.js';
import { gitConfigViolations } from './gitconfig.js';
import {
  COMPARE_FILE_LIMIT,
  compareRange,
  findPullForBranch,
  mainHead,
  MERGE_STATE_INTERVAL_MS,
  MERGE_STATE_TIMEOUT_MS,
  mergePullRequest,
  openPullRequest,
  PULL_HEAD_INTERVAL_MS,
  PULL_HEAD_TIMEOUT_MS,
  pushBranch,
  revertMerge,
  treeModes,
  waitForGate,
  waitForPullHead,
  type GitHubOptions,
} from './github.js';
import { applyStoredPatch, type PatchStore } from './patch.js';
import { haltDispatcher, haltReason } from './halt.js';
import { mergeLock } from './lock.js';
import { errorMessage, type Logger } from './log.js';
import { restoreDeploy, siteUrl, waitForDeploy, type NetlifyOptions } from './netlify.js';
import { runAgentSession, type SessionOutcome } from './session.js';
import { mergedServedFiles, runSmoke, SMOKE_GATE_TIMEOUT_MS, type SmokeResult } from './smoke.js';
import { retry } from './time.js';
import {
  changedFiles,
  commitLane,
  commitTitle,
  commitTrailers,
  createWorktree,
  GIT_TIMEOUT_MS,
  gitAuthEnv,
  headSha,
  lanePaths,
  outsideLane,
  removeWorktree,
  shortId,
  singleLineTitle,
  snapshotGitState,
  verifyCardCommit,
  type Worktree,
} from './worktree.js';

export interface PipelineTimings {
  gateTimeoutMs: number;
  gateIntervalMs: number;
  deployTimeoutMs: number;
  deployIntervalMs: number;
  prHeadTimeoutMs: number;
  prHeadIntervalMs: number;
  // How long the pull request is read after a merge request is lost.
  mergeStateTimeoutMs: number;
  mergeStateIntervalMs: number;
  // The first wait before a request or a write is tried again; it doubles each time.
  retryDelayMs: number;
}

export interface PipelineDeps {
  db: Db;
  adapter: AgentAdapter;
  config: DispatcherConfig;
  log: Logger;
  alert: Alerter;
  stopSignal: AbortSignal;
  now: () => Date;
  fetchFn?: typeof fetch;
  // Where accepted managed-session patches are kept (card_patches); null in attended mode.
  patches?: PatchStore | null;
  timings?: Partial<PipelineTimings>;
}

export const GATE_TIMEOUT_MS = 20 * 60_000;
export const GATE_INTERVAL_MS = 15_000;
export const DEPLOY_TIMEOUT_MS = 10 * 60_000;
export const DEPLOY_INTERVAL_MS = 10_000;
export const SHIP_WRITE_RETRIES = 3;
// Tries for a GitHub or Netlify request that throws: the first and two more.
export const REQUEST_TRIES = 3;

const DEFAULT_TIMINGS: PipelineTimings = {
  gateTimeoutMs: GATE_TIMEOUT_MS,
  gateIntervalMs: GATE_INTERVAL_MS,
  deployTimeoutMs: DEPLOY_TIMEOUT_MS,
  deployIntervalMs: DEPLOY_INTERVAL_MS,
  prHeadTimeoutMs: PULL_HEAD_TIMEOUT_MS,
  prHeadIntervalMs: PULL_HEAD_INTERVAL_MS,
  mergeStateTimeoutMs: MERGE_STATE_TIMEOUT_MS,
  mergeStateIntervalMs: MERGE_STATE_INTERVAL_MS,
  retryDelayMs: 1000,
};

// The network git calls (the card fetch, the push, the smoke fetch), each up to its timeout.
const NETWORK_GIT_CALLS = 3;
// The smoke test's page requests and its wait for the gate at the merge sha.
const SMOKE_WINDOW_MS = SMOKE_GATE_TIMEOUT_MS + 3 * 60_000;
// Every retry wait: requests, writes and the rollback.
const RETRY_BUDGET_MS = 2 * 60_000;
const STUCK_MARGIN_MS = 10 * 60_000;

// The longest a card should stay in the pipeline: the session's wall clock, the network git calls,
// the pull request head wait, the gate, the lost-merge poll, its own deploy and smoke and those of one
// card ahead of it on the merge lock, the retries, and ten minutes more.
export function stuckAfterMs(sessionMaxMinutes: number): number {
  const verify = DEPLOY_TIMEOUT_MS + SMOKE_WINDOW_MS;
  return (
    sessionMaxMinutes * 60_000 +
    NETWORK_GIT_CALLS * GIT_TIMEOUT_MS +
    PULL_HEAD_TIMEOUT_MS +
    GATE_TIMEOUT_MS +
    MERGE_STATE_TIMEOUT_MS +
    2 * verify +
    RETRY_BUDGET_MS +
    STUCK_MARGIN_MS
  );
}

function timings(deps: PipelineDeps): PipelineTimings {
  return { ...DEFAULT_TIMINGS, ...deps.timings };
}

class CardStop extends Error {
  readonly stage: 'rejected' | 'paused';
  readonly failingCheck: string;
  constructor(stage: 'rejected' | 'paused', failingCheck: string, detail: string) {
    super(detail);
    this.name = 'CardStop';
    this.stage = stage;
    this.failingCheck = failingCheck;
  }
}

// A card that stays gated for recovery or the board. The message is the alert.
class LeftGated extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeftGated';
  }
}

function mergedPending(card: Card, mergeSha: string, clause: string): LeftGated {
  return new LeftGated(`Card ${shortId(card.id)} merged as ${mergeSha.slice(0, 8)} ${clause}. It is left gated and is checked again when the dispatcher starts.`);
}

const PAUSING_OUTCOMES: Partial<Record<SessionOutcome, string>> = {
  ceiling: 'ceiling',
  turn_cap: 'turn_cap',
  board_session_lapsed: 'board_session',
  paused_by_board: 'paused_by_board',
  unknown_model: 'unknown_model',
  wall_clock: 'wall_clock',
  stopped: 'dispatcher_stopped',
};

export function siteIdFor(config: DispatcherConfig, folder: CardFolder): string {
  return folder === 'seed-1' ? config.netlifySiteIdSeed : config.netlifySiteIdPlatform;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

// The largest file a check reads.
const CHECK_FILE_MAX_BYTES = 1_048_576;

// A checked path that is not a regular file (a symlink a change planted, a device) fails the check
// and is never read through.
async function checksHold(worktree: string, checks: readonly ConfigCheck[]): Promise<boolean> {
  for (const check of checks) {
    let doc: unknown;
    try {
      const file = path.join(worktree, check.file);
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > CHECK_FILE_MAX_BYTES) return false;
      doc = await readJson(file);
    } catch {
      return false;
    }
    if (!evaluateCheck(check, doc)) return false;
  }
  return true;
}

export async function runCardPipeline(card: Card, deps: PipelineDeps): Promise<void> {
  const { db, config } = deps;
  let role: Role | null = null;
  let worktree: Worktree | null = null;
  try {
    role = await db.getRole(card.executor_role_id ?? '');
    const checks = parseAcceptance(card);
    const allowed = allowedPaths(card);
    worktree = await prepareWorktree(card, deps);
    await preCheck(worktree, checks);
    const before = await snapshotGitState(config.repoRoot, worktree.path);
    const reused = await reuseStoredPatch(card, worktree, allowed, deps);
    const sessionError = reused
      ? null
      : await agentSession(card, role, worktree, deps).then(
          () => null,
          (error: unknown) => error,
        );
    // Checked before any git runs again, whatever the session's outcome.
    await assertGitTrusted(card, worktree.path, before, deps, 'after the session');
    if (sessionError) throw sessionError;
    await postCheck(worktree, checks);
    const commit = await commitAndOpenPullRequest(card, role, worktree, before, allowed, checks, deps);
    await finalize(card, deps, 'gated', null);
    await waitForGatePass(card, role, commit, deps);
    const roleId = role.id;
    await mergeLock.run(async () => {
      await confirmRemoteRange(commit, allowed, deps);
      const merged = await merge(card, roleId, commit, deps);
      await verifyMerged(card, roleId, merged.sha, checks, deps, { shaRecorded: merged.recorded });
    });
  } catch (error) {
    await settleFailure(card, role?.id ?? null, error, deps);
  } finally {
    if (worktree) await discardWorktree(worktree.path, worktree.branch, deps);
  }
}

// A card the previous process merged but did not see through. A smoke test that already passed is
// only recorded. Otherwise, while main is still at the merge, its deploy and smoke test run again with
// the pipeline's rollback; once main has moved, nothing runs and the board decides.
export async function resumeMerged(card: Card, deps: PipelineDeps): Promise<void> {
  const roleId = card.executor_role_id;
  const delay = timings(deps).retryDelayMs;
  try {
    const sha = card.commit_sha;
    if (!sha) throw new Error(`card ${card.id} has no commit_sha to verify`);
    await mergeLock.run(async () => {
      let passed: Record<string, unknown> | null;
      let head: string;
      try {
        passed = await retry(() => deps.db.findEvent(card.id, 'smoke_pass'), REQUEST_TRIES, delay);
        head = passed?.sha === sha ? sha : await retry(() => mainHead(githubOptions(deps)), REQUEST_TRIES, delay);
      } catch (error) {
        throw new LeftGated(`Card ${shortId(card.id)} was merged as ${sha.slice(0, 8)} but its state could not be read (${errorMessage(error)}). It is left gated for the board.`);
      }
      if (passed?.sha === sha) {
        deps.log.info('pipeline', `card ${card.id} passed smoke before the restart; recording it`, { sha });
        const verdict = { deployId: String(passed.deploy_id ?? ''), baseUrl: String(passed.url ?? ''), smoke: { ok: true, summary: String(passed.smoke ?? '') } };
        await recordShip(card, roleId, sha, verdict, deps, false);
        return;
      }
      if (head !== sha) {
        throw new LeftGated(`Card ${shortId(card.id)} was merged as ${sha.slice(0, 8)} but main has moved to ${head.slice(0, 8)} since. It is left gated for the board; no smoke test or rollback ran.`);
      }
      let checks: ConfigCheck[] = [];
      try {
        checks = parseChecks(card.acceptance_test);
      } catch (error) {
        deps.log.warn('pipeline', `card ${card.id} acceptance test no longer parses; smoke checks the build only`, { error: errorMessage(error) });
      }
      await verifyMerged(card, roleId, sha, checks, deps);
    });
  } catch (error) {
    await settleFailure(card, roleId, error, deps);
  }
}

// The merge sha of a gated card with none recorded: the newest pull request for its branch, when it
// merged.
export async function findCardMerge(card: Card, deps: PipelineDeps): Promise<string | null> {
  const branch = card.branch;
  if (!branch) return null;
  const pull = await retry(() => findPullForBranch(githubOptions(deps), branch), REQUEST_TRIES, timings(deps).retryDelayMs);
  return pull?.merged && pull.mergeCommitSha ? pull.mergeCommitSha : null;
}

// Records how a card stopped. Every write here is best effort: a database failure is logged and
// named in the alert, and never stops the alert.
async function settleFailure(card: Card, roleId: string | null, error: unknown, deps: PipelineDeps): Promise<void> {
  const { log } = deps;
  if (error instanceof LeftGated) {
    log.warn('pipeline', `card ${card.id} left gated`, { detail: error.message });
    await deps.alert.notify(error.message);
    return;
  }
  if (error instanceof CardStop) {
    log.warn('pipeline', `card ${card.id} ${error.stage}`, { check: error.failingCheck, detail: error.message });
    const unwritten = await attempt(deps, `card ${card.id} stage`, () => finalize(card, deps, error.stage, error.failingCheck));
    if (error.failingCheck !== 'dispatcher_stopped' || unwritten) {
      await deps.alert.notify(`Card ${shortId(card.id)} ${error.stage} (${error.failingCheck}): ${singleLineTitle(card.title)}. ${error.message}${unwrittenNote(unwritten)}`);
    }
    return;
  }
  const detail = errorMessage(error);
  log.error('pipeline', `card ${card.id} failed`, { detail });
  await attempt(deps, `card ${card.id} error event`, () => deps.db.insertEvent(card.id, roleId, 'error', { step: 'pipeline', message: detail }));
  const unwritten = await attempt(deps, `card ${card.id} stage`, () => finalize(card, deps, 'rejected', 'dispatcher_error'));
  await deps.alert.notify(`Card ${shortId(card.id)} rejected (dispatcher_error): ${singleLineTitle(card.title)}. ${detail}${unwrittenNote(unwritten)}`);
}

function unwrittenNote(unwritten: string | null): string {
  return unwritten ? ` The stage was not written (${unwritten}).` : '';
}

// Runs a write and returns null, or the error message when it threw (logged).
async function attempt(deps: PipelineDeps, what: string, write: () => Promise<unknown>): Promise<string | null> {
  try {
    await write();
    return null;
  } catch (error) {
    deps.log.error('pipeline', `${what} write failed`, { error: errorMessage(error) });
    return errorMessage(error);
  }
}

// A write after the merge: the first try and SHIP_WRITE_RETRIES more, with a doubling wait.
async function retrying<T>(deps: PipelineDeps, write: () => Promise<T>): Promise<T> {
  return retry(write, 1 + SHIP_WRITE_RETRIES, timings(deps).retryDelayMs);
}

// A request to GitHub or Netlify that throws is tried again, up to REQUEST_TRIES in all.
async function requesting<T>(deps: PipelineDeps, request: () => Promise<T>): Promise<T> {
  return retry(request, REQUEST_TRIES, timings(deps).retryDelayMs);
}

// Why git cannot be trusted with this worktree any more, or null: a key the allowlist refuses (named),
// or a changed snapshot. A state that cannot be read counts as changed.
async function gitTrustProblem(repoRoot: string, worktree: string, before: string): Promise<string | null> {
  try {
    const refused = await gitConfigViolations(repoRoot, worktree);
    if (refused.length > 0) return `refused git configuration: ${refused.join('; ')}`;
    if ((await snapshotGitState(repoRoot, worktree)) !== before) return 'the git configuration, hooks or worktree link changed';
    return null;
  } catch (error) {
    return `the git state could not be read (${errorMessage(error)})`;
  }
}

async function assertGitTrusted(card: Card, worktree: string, before: string, deps: PipelineDeps, when: string): Promise<void> {
  const problem = await gitTrustProblem(deps.config.repoRoot, worktree, before);
  if (problem) throw haltForTamper(card, deps, when, problem);
}

// Agent code changed what git reads as configuration. The process halts: no git runs again and no
// card is claimed until an operator has looked and restarted the dispatcher, and startup refuses the
// repository while its configuration is still refused.
function haltForTamper(card: Card, deps: PipelineDeps, when: string, problem: string): CardStop {
  const reason = `git_tamper: ${problem} (${when}, card ${shortId(card.id)})`;
  haltDispatcher(reason);
  deps.log.error('pipeline', reason, { repo: deps.config.repoRoot });
  return new CardStop(
    'rejected',
    'git_tamper',
    `${problem}, ${when}. The dispatcher claims no card and runs no git until it restarts, and it will not start while the configuration is refused; check .git/config, .git/config.worktree, .git/info and .git/hooks in ${deps.config.repoRoot}.`,
  );
}

// Once halted, a worktree is removed with fs only; the worktree entry and the branch wait for the
// next process.
async function discardWorktree(target: string, branch: string | null, deps: PipelineDeps): Promise<void> {
  if (haltReason()) {
    await rm(target, { recursive: true, force: true }).catch((error: unknown) =>
      deps.log.warn('pipeline', 'worktree folder removal failed', { path: target, error: errorMessage(error) }),
    );
    return;
  }
  await removeWorktree(deps.config.repoRoot, target, branch).catch((error: unknown) =>
    deps.log.warn('pipeline', 'worktree removal failed', { path: target, error: errorMessage(error) }),
  );
}

function parseAcceptance(card: Card): ConfigCheck[] {
  try {
    return parseChecks(card.acceptance_test);
  } catch (error) {
    if (error instanceof AcceptanceGrammarError) throw new CardStop('rejected', 'acceptance_grammar', error.message);
    throw error;
  }
}

// A folder without the requested lane has no paths an agent may edit.
function allowedPaths(card: Card): string[] {
  const allowed = lanePaths(card.folder, card.lane);
  if (allowed.length === 0) throw new CardStop('rejected', 'lane_unsupported', `folder ${card.folder} has no ${card.lane} lane`);
  return allowed;
}

async function prepareWorktree(card: Card, deps: PipelineDeps): Promise<Worktree> {
  const worktree = await createWorktree(deps.config.repoRoot, deps.config.worktreeRoot, card.id, card.lane, gitAuthEnv(deps.config.githubToken));
  await deps.db.updateCard(card.id, { branch: worktree.branch });
  deps.log.info('pipeline', `worktree ready for card ${card.id}`, { path: worktree.path, branch: worktree.branch, base: worktree.baseSha });
  return worktree;
}

// The check must be false on origin/main before the session; a card whose check already holds
// has nothing to build.
async function preCheck(worktree: Worktree, checks: readonly ConfigCheck[]): Promise<void> {
  if (checks.length > 0 && (await checksHold(worktree.path, checks))) {
    throw new CardStop('rejected', 'acceptance_already_true', 'the acceptance check already holds on main');
  }
}

// A card whose earlier managed session had its patch accepted (then paused, or re-queued when main
// moved) is rebuilt from that patch at the new base, with no session and no new ledger row. A patch
// that no longer applies is discarded and the card pauses, so the board's resume runs a new session.
async function reuseStoredPatch(card: Card, worktree: Worktree, allowed: readonly string[], deps: PipelineDeps): Promise<boolean> {
  if (!deps.patches) return false;
  const outcome = await applyStoredPatch(deps.patches, card.id, worktree.path, allowed);
  if (outcome.kind === 'none') return false;
  if (outcome.kind === 'conflict') {
    await attempt(deps, `card ${card.id} patch_conflict event`, () =>
      deps.db.insertEvent(card.id, card.executor_role_id, 'error', { step: 'patch_conflict', sha256: outcome.sha256, detail: outcome.detail }),
    );
    throw new CardStop('paused', 'patch_conflict', `the stored patch ${outcome.sha256.slice(0, 12)} no longer applies on main (${outcome.detail}); it was discarded, so resuming the card runs a new session`);
  }
  await deps.db.insertEvent(card.id, card.executor_role_id, 'message', { step: 'patch_reused', sha256: outcome.sha256, base_sha: outcome.baseSha, files: outcome.files });
  deps.log.info('pipeline', `card ${card.id} rebuilt from its stored patch; no session`, { sha256: outcome.sha256, base: worktree.baseSha, stored_base: outcome.baseSha });
  return true;
}

async function agentSession(card: Card, role: Role, worktree: Worktree, deps: PipelineDeps): Promise<void> {
  const studio = await deps.db.getStudioState();
  const run = await runAgentSession(card, role, worktree.path, studio, {
    db: deps.db,
    adapter: deps.adapter,
    priceTable: deps.config.priceTable,
    sessionMaxTurns: deps.config.sessionMaxTurns,
    boardSessionTtlMin: deps.config.boardSessionTtlMin,
    watchIntervalMs: deps.config.tickMs,
    fallbackModel: deps.config.modelBuilder,
    sessionMaxMs: deps.config.sessionMaxMinutes * 60_000,
    alert: deps.alert,
    log: deps.log,
    stopSignal: deps.stopSignal,
    now: deps.now,
  });
  deps.log.info('pipeline', `session for card ${card.id} ended`, { outcome: run.outcome, turns: run.turns, detail: run.detail });
  if (run.outcome === 'completed') return;
  const pausing = PAUSING_OUTCOMES[run.outcome];
  if (pausing) throw new CardStop('paused', pausing, run.detail);
  if (run.outcome === 'refused') throw new CardStop('rejected', 'tool_allowlist', run.detail);
  await deps.db.insertEvent(card.id, role.id, 'error', { step: 'session', message: run.detail });
  throw new CardStop('rejected', 'session', run.detail);
}

async function postCheck(worktree: Worktree, checks: readonly ConfigCheck[]): Promise<void> {
  if (checks.length > 0 && !(await checksHold(worktree.path, checks))) {
    throw new CardStop('rejected', 'acceptance', 'the acceptance check does not hold after the session');
  }
}

interface CommitInfo {
  sha: string;
  baseSha: string;
  // Every path the commit changes, as the local range check saw them.
  paths: string[];
  branch: string;
  prNumber: number;
  title: string;
  trailers: string;
}

async function commitAndOpenPullRequest(
  card: Card,
  role: Role,
  worktree: Worktree,
  before: string,
  allowed: readonly string[],
  checks: readonly ConfigCheck[],
  deps: PipelineDeps,
): Promise<CommitInfo> {
  const head = await headSha(worktree.path);
  if (head !== worktree.baseSha) {
    throw new CardStop('rejected', 'history', `the session moved HEAD from ${worktree.baseSha} to ${head}`);
  }
  const changed = await changedFiles(worktree.path);
  const stray = outsideLane(changed, allowed);
  if (stray.length > 0) {
    throw new CardStop('rejected', 'lane_violation', `changes outside the ${card.lane} lane: ${stray.join(', ')}`);
  }
  const input = {
    cardId: card.id,
    title: card.title,
    lane: card.lane,
    executor: role.name,
    acceptance: checks.length > 0 ? checks.map((check) => check.line).join('; ') : 'gate and smoke',
  };
  // A process the session left behind could still write configuration, so it is checked again right
  // before each git call that acts on it.
  await assertGitTrusted(card, worktree.path, before, deps, 'before the commit');
  const commit = await commitLane(worktree.path, allowed, input);
  if (!commit.committed) throw new CardStop('rejected', 'no_changes', 'the session changed nothing under the lane paths');
  const range = await verifyCardCommit(worktree.path, { baseSha: worktree.baseSha, sha: commit.sha, allowed });
  if (!range.ok) throw new CardStop('rejected', range.check, range.detail);
  await assertGitTrusted(card, worktree.path, before, deps, 'before the push');
  await pushBranch(worktree.path, worktree.branch, deps.config.githubToken, commit.sha);
  const title = commitTitle(input);
  const trailers = commitTrailers(input);
  const github = githubOptions(deps);
  const pr = await openPullRequest(github, {
    head: worktree.branch,
    title,
    body: `${card.intent ?? ''}\n\n${trailers}`.trim(),
  });
  // An existing pull request can still show the head before the force-push; the gate and the merge
  // guard must see the pushed sha.
  if (pr.headSha !== commit.sha) {
    const t = timings(deps);
    const moved = await waitForPullHead(github, pr.number, commit.sha, { timeoutMs: t.prHeadTimeoutMs, intervalMs: t.prHeadIntervalMs, signal: deps.stopSignal });
    if (!moved) {
      stopCheck(deps, 'while the pull request head was updating');
      throw new CardStop('rejected', 'pr_head', `pull request #${pr.number} did not show the pushed sha ${commit.sha} within ${t.prHeadTimeoutMs / 1000} s`);
    }
  }
  deps.log.info('pipeline', `pull request #${pr.number} open for card ${card.id}`, { sha: commit.sha });
  return { sha: commit.sha, baseSha: worktree.baseSha, paths: range.paths, branch: worktree.branch, prNumber: pr.number, title, trailers };
}

// A wait before the merge that returned because the dispatcher is stopping is not a failure of the
// card: the card pauses and no deploys row is written.
function stopCheck(deps: PipelineDeps, during: string): void {
  if (deps.stopSignal.aborted) throw new CardStop('paused', 'dispatcher_stopped', `dispatcher stopped ${during}`);
}

function githubOptions(deps: PipelineDeps): GitHubOptions {
  return { token: deps.config.githubToken, repo: deps.config.githubRepo, fetchFn: deps.fetchFn };
}

function netlifyOptions(deps: PipelineDeps): NetlifyOptions {
  return { token: deps.config.netlifyAuthToken, fetchFn: deps.fetchFn };
}

async function waitForGatePass(card: Card, role: Role, commit: CommitInfo, deps: PipelineDeps): Promise<void> {
  const t = timings(deps);
  const gate = await waitForGate(githubOptions(deps), commit.sha, { timeoutMs: t.gateTimeoutMs, intervalMs: t.gateIntervalMs, signal: deps.stopSignal });
  stopCheck(deps, 'while the gate was running');
  if (gate.state !== 'pass') {
    const detail = gate.state === 'fail' ? `gate concluded ${gate.conclusion}` : `gate ${gate.state} after ${t.gateTimeoutMs / 60_000} minutes`;
    await deps.db.insertEvent(card.id, role.id, 'gate_fail', { sha: commit.sha, pr: commit.prNumber, detail });
    throw new CardStop('rejected', 'gate', detail);
  }
  await deps.db.insertEvent(card.id, role.id, 'gate_pass', { sha: commit.sha, pr: commit.prNumber });
}

const SYMLINK_MODE = '120000';
const GITLINK_MODE = '160000';

// GitHub's own view of the pushed range must match the local check before anything merges: one
// commit on the base, the same changed paths (a rename counts both names), all inside the lane, and
// no symlink or submodule on either side. A mismatch is history, since the local repository or the
// push was not what it seemed.
async function confirmRemoteRange(commit: CommitInfo, allowed: readonly string[], deps: PipelineDeps): Promise<void> {
  const github = githubOptions(deps);
  const range = await requesting(deps, () => compareRange(github, commit.baseSha, commit.sha));
  const problems: string[] = [];
  if (range.mergeBaseSha !== commit.baseSha || range.aheadBy !== 1 || range.behindBy !== 0 || range.commits.length !== 1 || range.commits[0] !== commit.sha) {
    problems.push(`GitHub reports ${range.aheadBy} commit(s) ahead and ${range.behindBy} behind merge base ${range.mergeBaseSha ?? 'none'}, not ${commit.sha} alone on ${commit.baseSha}`);
  }
  if (range.files.length >= COMPARE_FILE_LIMIT) problems.push(`GitHub lists ${range.files.length} files, its limit, so the list may be incomplete`);
  const remotePaths = [...new Set(range.files.flatMap((file) => (file.previousPath ? [file.path, file.previousPath] : [file.path])))].sort();
  if (remotePaths.join('\0') !== commit.paths.join('\0')) {
    problems.push(`GitHub lists ${remotePaths.join(', ') || 'no files'} where the local check saw ${commit.paths.join(', ')}`);
  }
  const stray = outsideLane(remotePaths, allowed);
  if (stray.length > 0) problems.push(`outside the lane: ${stray.join(', ')}`);
  const baseModes = await requesting(deps, () => treeModes(github, commit.baseSha));
  const headModes = await requesting(deps, () => treeModes(github, commit.sha));
  const special = remotePaths.filter((file) => [baseModes.get(file), headModes.get(file)].some((mode) => mode === SYMLINK_MODE || mode === GITLINK_MODE));
  if (special.length > 0) problems.push(`symlinks or submodules: ${special.join(', ')}`);
  if (problems.length > 0) throw new CardStop('rejected', 'history', `the range GitHub reports differs from the checked commit: ${problems.join('; ')}`);
}

// Squash-merges with the sha guard. A lost merge request that GitHub does not show merged within the
// poll leaves the card gated with a merge_unknown marker for recovery, rather than rejecting a change
// that may be on main. A failed commit_sha write does not stop verification; it is reported.
async function merge(card: Card, roleId: string, commit: CommitInfo, deps: PipelineDeps): Promise<{ sha: string; recorded: boolean }> {
  const t = timings(deps);
  const result = await mergePullRequest(
    githubOptions(deps),
    commit.prNumber,
    commit.sha,
    { title: commit.title, message: commit.trailers },
    { timeoutMs: t.mergeStateTimeoutMs, intervalMs: t.mergeStateIntervalMs },
  );
  if (!result.ok) {
    if (result.unknown) {
      await attempt(deps, `card ${card.id} merge_unknown event`, () =>
        deps.db.insertEvent(card.id, roleId, 'error', { step: 'merge_unknown', pr: commit.prNumber, sha: commit.sha, reason: result.reason }),
      );
      await attempt(deps, `card ${card.id} merge_unknown marker`, () => finalize(card, deps, 'gated', 'merge_unknown'));
      throw new LeftGated(
        `Card ${shortId(card.id)}: the merge request for pull request #${commit.prNumber} failed and GitHub did not show it merged (${result.reason}). It is left gated; the dispatcher checks it again when it starts, and nothing was closed.`,
      );
    }
    throw new CardStop('rejected', 'merge', `merge refused (${result.status}): ${result.reason}`);
  }
  deps.log.info('pipeline', `card ${card.id} merged`, { sha: result.sha });
  try {
    await retrying(deps, () => deps.db.updateCard(card.id, { commit_sha: result.sha }));
    return { sha: result.sha, recorded: true };
  } catch (error) {
    deps.log.error('pipeline', `card ${card.id} commit_sha write failed`, { sha: result.sha, error: errorMessage(error) });
    await deps.alert.notify(`Card ${shortId(card.id)} merged as ${result.sha.slice(0, 8)} but its commit_sha was not written (${errorMessage(error)}). Verification goes on.`);
    return { sha: result.sha, recorded: false };
  }
}

interface Verdict {
  deployId: string;
  baseUrl: string;
  smoke: SmokeResult;
}

// Waits for the merge's deploy and smoke-tests it. A failed deploy or smoke is rolled back and
// rejected. Any other error before the smoke verdict (a deploy list that never answers, a site read
// or smoke request that keeps failing, the smoke worktree's git) is no verdict, so the change is rolled
// back as unverified and rejected as post_merge. A passing smoke is marked with a smoke_pass event
// first; after it the change is verified and is never rolled back: if recording it fails, it stays
// gated. A stop during the deploy wait leaves the card gated, unless its commit_sha was never written,
// since recovery could not find it then; that card is rolled back.
export async function verifyMerged(
  card: Card,
  roleId: string | null,
  mergeSha: string,
  checks: readonly ConfigCheck[],
  deps: PipelineDeps,
  options: { shaRecorded?: boolean } = {},
): Promise<void> {
  const t = timings(deps);
  const siteId = siteIdFor(deps.config, card.folder);
  const netlify = netlifyOptions(deps);
  let verdict: Verdict;
  try {
    const deploy = await waitForDeploy(netlify, siteId, mergeSha, {
      timeoutMs: t.deployTimeoutMs,
      intervalMs: t.deployIntervalMs,
      signal: deps.stopSignal,
      onError: (error) => deps.log.warn('pipeline', `card ${card.id} deploy read failed; waiting on`, { error: errorMessage(error) }),
    });
    if (deps.stopSignal.aborted) {
      if (options.shaRecorded === false) throw new Error('the dispatcher stopped during the deploy wait, and with no commit_sha written a restart could not verify the card');
      throw mergedPending(card, mergeSha, 'but the dispatcher stopped while the deploy was running');
    }
    if (!deploy.ok) {
      await attempt(deps, `card ${card.id} deploys row`, () =>
        deps.db.insertDeploy({ folder: card.folder, sha: mergeSha, netlify_deploy_id: deploy.deploy?.id ?? null, is_green: false, smoke_result: `fail: ${deploy.reason}` }),
      );
      await rollBack(card, roleId, mergeSha, `deploy failed: ${deploy.reason}`, false, deps);
      throw new CardStop('rejected', 'deploy', deploy.reason);
    }
    const baseUrl = await requesting(deps, () => siteUrl(netlify, siteId));
    const smoke = await smokeMerged(card, mergeSha, baseUrl, checks, deps);
    verdict = { deployId: deploy.deploy.id, baseUrl, smoke };
  } catch (error) {
    if (error instanceof CardStop || error instanceof LeftGated) throw error;
    const detail = errorMessage(error);
    deps.log.error('pipeline', `card ${card.id} could not be verified after merge`, { sha: mergeSha, detail });
    await rollBack(card, roleId, mergeSha, `post-merge check failed: ${detail}`, true, deps);
    throw new CardStop('rejected', 'post_merge', detail);
  }
  if (!verdict.smoke.ok) {
    await attempt(deps, `card ${card.id} deploys row`, () =>
      deps.db.insertDeploy({ folder: card.folder, sha: mergeSha, netlify_deploy_id: verdict.deployId, is_green: false, smoke_result: verdict.smoke.summary }),
    );
    await rollBack(card, roleId, mergeSha, `smoke failed: ${verdict.smoke.summary}`, true, deps);
    throw new CardStop('rejected', 'smoke', verdict.smoke.summary);
  }
  await recordShip(card, roleId, mergeSha, verdict, deps, true);
}

// The writes that make a verified card live: the smoke_pass marker (skipped when recovery is
// re-recording from it), the green deploys row (skipped when the newest green row is already this
// sha), the ship event and the stage. Each is retried; if one still fails the card stays gated.
async function recordShip(card: Card, roleId: string | null, mergeSha: string, verdict: Verdict, deps: PipelineDeps, markPass: boolean): Promise<void> {
  try {
    if (markPass) {
      await retrying(deps, () =>
        deps.db.insertEvent(card.id, roleId, 'message', { step: 'smoke_pass', sha: mergeSha, deploy_id: verdict.deployId, url: verdict.baseUrl, smoke: verdict.smoke.summary }),
      );
    }
    const green = await deps.db.lastGreen(card.folder).catch(() => null);
    if (green?.sha !== mergeSha) {
      await retrying(deps, () =>
        deps.db.insertDeploy({ folder: card.folder, sha: mergeSha, netlify_deploy_id: verdict.deployId, is_green: true, smoke_result: verdict.smoke.summary }),
      );
    }
    await retrying(deps, () => deps.db.insertEvent(card.id, roleId, 'ship', { sha: mergeSha, deploy_id: verdict.deployId, url: verdict.baseUrl, smoke: verdict.smoke.summary }));
    await retrying(deps, () => finalize(card, deps, 'live', null));
  } catch (error) {
    throw mergedPending(card, mergeSha, `and passed smoke, but recording it failed: ${errorMessage(error)}`);
  }
  deps.log.info('pipeline', `card ${card.id} is live`, { sha: mergeSha, url: verdict.baseUrl });
}

// The smoke test runs no card code (smoke.ts): the served build and config, the served data byte for
// byte against the merge commit, and the gate at the merge sha. A dispatcher that stops while the gate
// is still running leaves the card gated for recovery rather than reverting a merge it did not judge.
async function smokeMerged(card: Card, mergeSha: string, baseUrl: string, checks: readonly ConfigCheck[], deps: PipelineDeps): Promise<SmokeResult> {
  const { config } = deps;
  const t = timings(deps);
  return runSmoke({
    baseUrl,
    sha: mergeSha,
    folder: card.folder,
    checks,
    mergedFiles: () => mergedServedFiles(config.repoRoot, mergeSha, gitAuthEnv(config.githubToken)),
    gate: async () => {
      const status = await waitForGate(githubOptions(deps), mergeSha, {
        timeoutMs: Math.min(t.gateTimeoutMs, SMOKE_GATE_TIMEOUT_MS),
        intervalMs: t.gateIntervalMs,
        signal: deps.stopSignal,
      });
      if ((status.state === 'pending' || status.state === 'missing') && deps.stopSignal.aborted) {
        throw mergedPending(card, mergeSha, 'but the dispatcher stopped while the gate at the merge sha was running');
      }
      return status;
    },
    fetchFn: deps.fetchFn,
    retryDelayMs: t.retryDelayMs,
  });
}

export function revertMessage(card: Card, reason: string): string {
  return `Revert card ${shortId(card.id)}: ${singleLineTitle(card.title)}\n\nCard-Id: ${card.id}\nReason: ${reason}\n`;
}

// Takes a merged change back out. After a failed smoke, or an unverified deploy, the broken build
// may be live, so the newest green deploy is restored first; a failed deploy never published. Then
// main gets a revert commit so the next merge does not ship the change again. The restore and the
// revert are tried again when their requests throw. Nothing here throws: a database failure is logged
// and noted, and never skips the restore, the revert or the alert.
async function rollBack(card: Card, roleId: string | null, mergeSha: string, reason: string, restore: boolean, deps: PipelineDeps): Promise<void> {
  const payload: Record<string, unknown> = { failed_sha: mergeSha, reason };
  if (restore) {
    try {
      const previous = await deps.db.lastGreen(card.folder);
      payload.restored_sha = previous?.sha ?? null;
      payload.restored_deploy_id = previous?.netlify_deploy_id ?? null;
      const deployId = previous?.netlify_deploy_id;
      if (deployId) {
        try {
          await requesting(deps, () => restoreDeploy(netlifyOptions(deps), siteIdFor(deps.config, card.folder), deployId));
        } catch (error) {
          payload.restore_error = errorMessage(error);
        }
      } else {
        payload.restore_error = `no green ${card.folder} deploy exists to restore`;
      }
    } catch (error) {
      payload.restore_error = `the last green deploy could not be read (${errorMessage(error)})`;
    }
  }
  const revert = await requesting(deps, () => revertMerge(githubOptions(deps), mergeSha, revertMessage(card, reason))).catch(
    (error: unknown) => ({ ok: false, reason: errorMessage(error) }) as const,
  );
  if (revert.ok) payload.revert_sha = revert.sha;
  else payload.revert_error = revert.reason;
  await attempt(deps, `card ${card.id} revert event`, () => deps.db.insertEvent(card.id, roleId, 'revert', payload));

  const problems = [payload.restore_error, payload.revert_error].filter((problem): problem is string => typeof problem === 'string');
  if (problems.length === 0) {
    deps.log.warn('pipeline', `card ${card.id} rolled back`, payload);
    await deps.alert.notify(`Card ${shortId(card.id)} was reverted on main (${revert.ok ? revert.sha.slice(0, 7) : ''}): ${reason}`);
  } else {
    deps.log.error('pipeline', `card ${card.id} rollback incomplete`, payload);
    await deps.alert.notify(`Card ${shortId(card.id)} failed after merge and the rollback is incomplete: ${problems.join('; ')}. Check main and the live site.`);
  }
}

// actual_usd is written from the ledger at every terminal stage and at gated.
async function finalize(card: Card, deps: PipelineDeps, stage: 'gated' | 'live' | 'rejected' | 'paused', failingCheck: string | null): Promise<void> {
  const actual = await deps.db.sumLedger(card.id);
  await deps.db.updateCard(card.id, { stage, failing_check: failingCheck, actual_usd: actual });
}
