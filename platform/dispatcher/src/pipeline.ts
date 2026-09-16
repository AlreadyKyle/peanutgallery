// The life of one claimed card: worktree, pre-check, agent session, git state check, post-check,
// commit, range check, push, pull request, gate, merge, deploy, smoke; then live with a ship event,
// or rejected with the failing check. A merged change that fails its deploy or smoke, or whose
// verification throws before a verdict, is reverted on main, and the previous green deploy is
// restored unless the deploy itself failed. A merged change the dispatcher cannot finish verifying
// or recording is left gated with its merge sha, and recovery.ts verifies it again at startup. The
// board is alerted whenever a card stops short of live for a reason other than the dispatcher
// stopping before the merge.
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseChecks, evaluateCheck, AcceptanceGrammarError, type ConfigCheck } from './acceptance.js';
import type { AgentAdapter, CardFolder } from './adapters/types.js';
import type { Alerter } from './alert.js';
import type { DispatcherConfig } from './config.js';
import type { Card, Db, Role } from './db.js';
import {
  mergePullRequest,
  openPullRequest,
  PULL_HEAD_INTERVAL_MS,
  PULL_HEAD_TIMEOUT_MS,
  pushBranch,
  revertMerge,
  waitForGate,
  waitForPullHead,
  type GitHubOptions,
} from './github.js';
import type { Halt } from './halt.js';
import { errorMessage, type Logger } from './log.js';
import { restoreDeploy, siteUrl, waitForDeploy, type NetlifyOptions } from './netlify.js';
import { runAgentSession, type SessionOutcome } from './session.js';
import { runSmoke, type BotExec, type SmokeResult } from './smoke.js';
import { sleep } from './time.js';
import {
  changedFiles,
  commitLane,
  commitTitle,
  commitTrailers,
  createSmokeWorktree,
  createWorktree,
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
  prHeadTimeoutMs: number;
  prHeadIntervalMs: number;
  // The first wait before a failed write after a passing smoke is tried again; it doubles each time.
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
  halt: Halt;
  fetchFn?: typeof fetch;
  botExec?: BotExec;
  timings?: Partial<PipelineTimings>;
}

export const GATE_TIMEOUT_MS = 20 * 60_000;
export const GATE_INTERVAL_MS = 15_000;
export const DEPLOY_TIMEOUT_MS = 10 * 60_000;
export const SMOKE_BOT_SECONDS = 60;
export const SHIP_WRITE_RETRIES = 3;
const STUCK_MARGIN_MS = 10 * 60_000;

const DEFAULT_TIMINGS: PipelineTimings = {
  gateTimeoutMs: GATE_TIMEOUT_MS,
  gateIntervalMs: GATE_INTERVAL_MS,
  deployTimeoutMs: DEPLOY_TIMEOUT_MS,
  prHeadTimeoutMs: PULL_HEAD_TIMEOUT_MS,
  prHeadIntervalMs: PULL_HEAD_INTERVAL_MS,
  retryDelayMs: 1000,
};

// The longest a card should stay in the pipeline: the session's wall clock, the gate and deploy
// waits, and ten minutes for everything else.
export function stuckAfterMs(sessionMaxMinutes: number): number {
  return sessionMaxMinutes * 60_000 + GATE_TIMEOUT_MS + DEPLOY_TIMEOUT_MS + STUCK_MARGIN_MS;
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

// A merged card whose verification or record could not finish. It stays gated with its commit_sha,
// and the message completes "Card <id> merged as <sha>".
class MergedPending extends Error {
  readonly mergeSha: string;
  constructor(mergeSha: string, clause: string) {
    super(clause);
    this.name = 'MergedPending';
    this.mergeSha = mergeSha;
  }
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

async function checksHold(worktree: string, checks: readonly ConfigCheck[]): Promise<boolean> {
  for (const check of checks) {
    let doc: unknown;
    try {
      doc = await readJson(path.join(worktree, check.file));
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
  let gitTrusted = true;
  try {
    role = await db.getRole(card.executor_role_id ?? '');
    const checks = parseAcceptance(card);
    const allowed = allowedPaths(card);
    worktree = await prepareWorktree(card, deps);
    await preCheck(worktree, checks);
    const before = await snapshotGitState(config.repoRoot, worktree.path);
    const sessionError = await agentSession(card, role, worktree, deps).then(
      () => null,
      (error: unknown) => error,
    );
    // Compared before any git runs again, whatever the session's outcome.
    if (!(await gitStateUnchanged(config.repoRoot, worktree.path, before))) {
      gitTrusted = false;
      throw haltForTamper(card, deps, 'session');
    }
    if (sessionError) throw sessionError;
    await postCheck(worktree, checks);
    const commit = await commitAndOpenPullRequest(card, role, worktree, allowed, checks, deps);
    await finalize(card, deps, 'gated', null);
    const mergeSha = await gateAndMerge(card, role, commit, deps);
    await verifyMerged(card, role.id, mergeSha, checks, deps);
  } catch (error) {
    await settleFailure(card, role?.id ?? null, error, deps);
  } finally {
    if (worktree) await discardWorktree(worktree.path, worktree.branch, gitTrusted, deps);
  }
}

// A card the previous process merged but did not see through: its deploy and smoke test run again,
// with the same rollback and the same outcomes as in the pipeline.
export async function resumeMerged(card: Card, deps: PipelineDeps): Promise<void> {
  const roleId = card.executor_role_id;
  try {
    if (!card.commit_sha) throw new Error(`card ${card.id} has no commit_sha to verify`);
    let checks: ConfigCheck[] = [];
    try {
      checks = parseChecks(card.acceptance_test);
    } catch (error) {
      deps.log.warn('pipeline', `card ${card.id} acceptance test no longer parses; smoke checks the build only`, { error: errorMessage(error) });
    }
    await verifyMerged(card, roleId, card.commit_sha, checks, deps);
  } catch (error) {
    await settleFailure(card, roleId, error, deps);
  }
}

// Records how a card stopped. Every write here is best effort: a database failure is logged and
// named in the alert, and never stops the alert.
async function settleFailure(card: Card, roleId: string | null, error: unknown, deps: PipelineDeps): Promise<void> {
  const { log } = deps;
  if (error instanceof MergedPending) {
    log.warn('pipeline', `card ${card.id} merged and left gated`, { sha: error.mergeSha, detail: error.message });
    await deps.alert.notify(
      `Card ${shortId(card.id)} merged as ${error.mergeSha.slice(0, 8)} ${error.message}. It is left gated and is checked again when the dispatcher starts.`,
    );
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

async function retrying(deps: PipelineDeps, write: () => Promise<unknown>): Promise<void> {
  const delay = timings(deps).retryDelayMs;
  for (let retry = 0; ; retry += 1) {
    try {
      await write();
      return;
    } catch (error) {
      if (retry >= SHIP_WRITE_RETRIES) throw error;
      deps.log.warn('pipeline', 'write failed; retrying', { retry: retry + 1, error: errorMessage(error) });
      await sleep(delay * 2 ** retry);
    }
  }
}

async function gitStateUnchanged(repoRoot: string, worktree: string, before: string): Promise<boolean> {
  try {
    return (await snapshotGitState(repoRoot, worktree)) === before;
  } catch {
    return false;
  }
}

// Agent code changed what git reads as configuration. No git runs on that repository again in this
// process, and no card is claimed until an operator has looked and restarted the dispatcher.
function haltForTamper(card: Card, deps: PipelineDeps, during: 'session' | 'smoke test'): CardStop {
  const reason = `git_tamper: the git configuration changed during the ${during} of card ${shortId(card.id)}`;
  deps.halt.reason = reason;
  deps.log.error('pipeline', reason, { repo: deps.config.repoRoot });
  return new CardStop(
    'rejected',
    'git_tamper',
    `The repository's git configuration, hooks or worktree link changed during the ${during}. The dispatcher claims no card until it restarts; check .git/config, .git/info and .git/hooks in ${deps.config.repoRoot} first.`,
  );
}

async function discardWorktree(target: string, branch: string | null, trusted: boolean, deps: PipelineDeps): Promise<void> {
  if (!trusted) {
    // Files only: pruning the worktree entry and deleting the branch are git calls, left for after
    // the restart.
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
  branch: string;
  prNumber: number;
  title: string;
  trailers: string;
}

async function commitAndOpenPullRequest(
  card: Card,
  role: Role,
  worktree: Worktree,
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
  const commit = await commitLane(worktree.path, allowed, input);
  if (!commit.committed) throw new CardStop('rejected', 'no_changes', 'the session changed nothing under the lane paths');
  const range = await verifyCardCommit(worktree.path, { baseSha: worktree.baseSha, sha: commit.sha, allowed });
  if (!range.ok) throw new CardStop('rejected', range.check, range.detail);
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
  return { sha: commit.sha, branch: worktree.branch, prNumber: pr.number, title, trailers };
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

async function gateAndMerge(card: Card, role: Role, commit: CommitInfo, deps: PipelineDeps): Promise<string> {
  const t = timings(deps);
  const gate = await waitForGate(githubOptions(deps), commit.sha, { timeoutMs: t.gateTimeoutMs, intervalMs: t.gateIntervalMs, signal: deps.stopSignal });
  stopCheck(deps, 'while the gate was running');
  if (gate.state !== 'pass') {
    const detail = gate.state === 'fail' ? `gate concluded ${gate.conclusion}` : `gate ${gate.state} after ${t.gateTimeoutMs / 60_000} minutes`;
    await deps.db.insertEvent(card.id, role.id, 'gate_fail', { sha: commit.sha, pr: commit.prNumber, detail });
    throw new CardStop('rejected', 'gate', detail);
  }
  await deps.db.insertEvent(card.id, role.id, 'gate_pass', { sha: commit.sha, pr: commit.prNumber });
  const merge = await mergePullRequest(githubOptions(deps), commit.prNumber, commit.sha, { title: commit.title, message: commit.trailers });
  if (!merge.ok) throw new CardStop('rejected', 'merge', `merge refused (${merge.status}): ${merge.reason}`);
  deps.log.info('pipeline', `card ${card.id} merged`, { sha: merge.sha });
  // The merge has happened whatever the database says, so a failed write does not stop the deploy
  // and smoke checks; the board is told the card row lacks its sha.
  try {
    await retrying(deps, () => deps.db.updateCard(card.id, { commit_sha: merge.sha }));
  } catch (error) {
    deps.log.error('pipeline', `card ${card.id} commit_sha write failed`, { sha: merge.sha, error: errorMessage(error) });
    await deps.alert.notify(`Card ${shortId(card.id)} merged as ${merge.sha.slice(0, 8)} but its commit_sha was not written (${errorMessage(error)}). Verification goes on.`);
  }
  return merge.sha;
}

interface Verdict {
  deployId: string;
  baseUrl: string;
  smoke: SmokeResult;
}

// Waits for the merge's deploy and smoke-tests it. A failed deploy or smoke is rolled back and
// rejected. Any other error before the smoke verdict (an API error, a timeout, a git failure) is no
// verdict, so the change is rolled back as unverified and rejected as post_merge. After a passing
// smoke the change is verified and is never rolled back: if recording it fails, it stays gated.
export async function verifyMerged(card: Card, roleId: string | null, mergeSha: string, checks: readonly ConfigCheck[], deps: PipelineDeps): Promise<void> {
  const siteId = siteIdFor(deps.config, card.folder);
  const netlify = netlifyOptions(deps);
  let verdict: Verdict;
  try {
    const deploy = await waitForDeploy(netlify, siteId, mergeSha, { timeoutMs: timings(deps).deployTimeoutMs, signal: deps.stopSignal });
    if (deps.stopSignal.aborted) throw new MergedPending(mergeSha, 'but the dispatcher stopped while the deploy was running');
    if (!deploy.ok) {
      await attempt(deps, `card ${card.id} deploys row`, () =>
        deps.db.insertDeploy({ folder: card.folder, sha: mergeSha, netlify_deploy_id: deploy.deploy?.id ?? null, is_green: false, smoke_result: `fail: ${deploy.reason}` }),
      );
      await rollBack(card, roleId, mergeSha, `deploy failed: ${deploy.reason}`, false, deps);
      throw new CardStop('rejected', 'deploy', deploy.reason);
    }
    const baseUrl = await siteUrl(netlify, siteId);
    const smoke = await smokeMerged(card, roleId, mergeSha, baseUrl, checks, deps);
    verdict = { deployId: deploy.deploy.id, baseUrl, smoke };
  } catch (error) {
    if (error instanceof CardStop || error instanceof MergedPending) throw error;
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
  try {
    await retrying(deps, () =>
      deps.db.insertDeploy({ folder: card.folder, sha: mergeSha, netlify_deploy_id: verdict.deployId, is_green: true, smoke_result: verdict.smoke.summary }),
    );
    await retrying(deps, () => deps.db.insertEvent(card.id, roleId, 'ship', { sha: mergeSha, deploy_id: verdict.deployId, url: verdict.baseUrl, smoke: verdict.smoke.summary }));
    await retrying(deps, () => finalize(card, deps, 'live', null));
  } catch (error) {
    throw new MergedPending(mergeSha, `and passed smoke, but recording it failed: ${errorMessage(error)}`);
  }
  deps.log.info('pipeline', `card ${card.id} is live`, { sha: mergeSha, url: verdict.baseUrl });
}

// The seed's headless bot runs from a detached checkout of the merge commit, so it tests the code
// that shipped. That checkout runs agent-written code, so the git state is compared around it as
// around a session; a change rolls the merge back, halts the dispatcher and rejects git_tamper.
// pnpm installs the checkout's dependencies on the bot's first filtered run, as it does in a card
// worktree.
async function smokeMerged(card: Card, roleId: string | null, mergeSha: string, baseUrl: string, checks: readonly ConfigCheck[], deps: PipelineDeps): Promise<SmokeResult> {
  const { config } = deps;
  const input = { baseUrl, sha: mergeSha, folder: card.folder, checks, botSeconds: SMOKE_BOT_SECONDS, fetchFn: deps.fetchFn, exec: deps.botExec };
  if (card.folder !== 'seed-1') return runSmoke({ ...input, botRoot: config.repoRoot });
  const botRoot = await createSmokeWorktree(config.repoRoot, config.worktreeRoot, card.id, mergeSha, gitAuthEnv(config.githubToken));
  let before: string;
  try {
    before = await snapshotGitState(config.repoRoot, botRoot);
  } catch (error) {
    await discardWorktree(botRoot, null, true, deps);
    throw error;
  }
  const outcome = await runSmoke({ ...input, botRoot }).then(
    (smoke) => ({ smoke, error: null }),
    (error: unknown) => ({ smoke: null, error }),
  );
  if (!(await gitStateUnchanged(config.repoRoot, botRoot, before))) {
    await discardWorktree(botRoot, null, false, deps);
    const stop = haltForTamper(card, deps, 'smoke test');
    await rollBack(card, roleId, mergeSha, `the smoke test changed the git configuration`, true, deps);
    throw stop;
  }
  await discardWorktree(botRoot, null, true, deps);
  if (outcome.error !== null || outcome.smoke === null) throw outcome.error;
  return outcome.smoke;
}

export function revertMessage(card: Card, reason: string): string {
  return `Revert card ${shortId(card.id)}: ${singleLineTitle(card.title)}\n\nCard-Id: ${card.id}\nReason: ${reason}\n`;
}

// Takes a merged change back out. After a failed smoke, or an unverified deploy, the broken build
// may be live, so the newest green deploy is restored first; a failed deploy never published. Then
// main gets a revert commit so the next merge does not ship the change again. Nothing here throws:
// a database failure is logged and noted, and never skips the restore, the revert or the alert.
async function rollBack(card: Card, roleId: string | null, mergeSha: string, reason: string, restore: boolean, deps: PipelineDeps): Promise<void> {
  const payload: Record<string, unknown> = { failed_sha: mergeSha, reason };
  if (restore) {
    try {
      const previous = await deps.db.lastGreen(card.folder);
      payload.restored_sha = previous?.sha ?? null;
      payload.restored_deploy_id = previous?.netlify_deploy_id ?? null;
      if (previous?.netlify_deploy_id) {
        try {
          await restoreDeploy(netlifyOptions(deps), siteIdFor(deps.config, card.folder), previous.netlify_deploy_id);
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
  const revert = await revertMerge(githubOptions(deps), mergeSha, revertMessage(card, reason)).catch(
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
