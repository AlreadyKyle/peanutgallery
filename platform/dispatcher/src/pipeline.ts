// The life of one claimed card: worktree, pre-check, agent session (or the card's stored patch, when
// an earlier managed session's patch was accepted), git state check, post-check,
// commit, range check, push, pull request, gate, remote range check, merge, deploy, smoke; then live
// with a ship event, or rejected with the failing check. A merged change that fails its deploy or
// smoke, or whose verification throws before a verdict, is reverted on main, and the previous green
// deploy is restored unless the deploy itself failed. A merged change the dispatcher cannot finish
// verifying or recording, or a merge whose outcome is unknown, is left gated, and recovery.ts resolves
// it at startup. The board is alerted whenever a card stops short of live for a reason other than the
// dispatcher stopping before the merge.
//
// Every stage write names the stage the card must still be in, so a stage the board set while the
// dispatcher held the card is never overwritten; a write that finds the card elsewhere stops the
// pipeline there (StageMoved). Inside the merge lock, before the merge, the studio and the card are
// read again: a paused studio pauses the card, a card the board moved off horizon now or vetoed is
// paused, and a card no longer gated is left as the board set it. The merge goes ahead only while
// main's head is still the card's base sha, so what merges is exactly what the gate tested; otherwise
// the card goes back to funded to be built on the new main. A revert that fails pauses the studio, since
// main may then still carry the failed change. An API error that says the Console credit ran out, or
// that the organisation reached its usage tier's monthly cap, pauses the studio and the card.
//
// A card whose green gate run uploaded design-frames with changed frames is visual
// (docs/specs/design-review.md): before the merge lock, a Director reviews its frames (visual-review.ts)
// while a board member is signed in, and the card waits at gated until one is. All pass records a
// visual approval and merges; a revise moves the card back to building for a revision session given
// only the failing criteria, frame names and reason codes, and only what the claim's budget still
// holds, which is squashed with the change into one commit on the base and gated again, at most twice
// (cards.review_rounds); after two rounds an
// all-ages revise rejects the card as a gate failure does, and any other open criterion merges with
// its verdict recorded. A review that cannot give a verdict is an infrastructure stop.
//
// A stop the card did not cause is never a rejection (docs/specs/money-safety.md): a gate that never
// started or never finished, one GitHub cancelled or could not start, a failure main already had at the
// card's base, a pull request that never showed the pushed sha, GitHub, git or Netlify not answering,
// or any error before the merge request that no check above classified (a database blip, a failed
// fetch of main, a fault in the dispatcher). Before the merge the card goes back to funded on its stored
// patch, which the next claim re-gates with no session and no Actions re-run, or, when it stopped before
// any session ran, to be claimed again from the start; otherwise, or after INFRA_REQUEUE_LIMIT such
// stops in a row, it pauses for the board. After the merge the change is still rolled back (the
// kernel), and the card pauses rather than being rejected.
import { lstat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseChecks, evaluateCheck, AcceptanceGrammarError, type ConfigCheck } from './acceptance.js';
import type { AgentAdapter, CardFolder } from './adapters/types.js';
import type { Alerter } from './alert.js';
import type { SessionBudgets } from './budgets.js';
import { VISUAL_REVIEW_MIN_USD, type DispatcherConfig } from './config.js';
import { REFUSAL_CHECK, type SpendRefusal } from './credit.js';
import type { Card, CardPatch, Db, Role } from './db.js';
import { gitConfigViolations } from './gitconfig.js';
import {
  closePullRequest,
  COMPARE_FILE_LIMIT,
  compareRange,
  findPullForBranch,
  isInfrastructureConclusion,
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
  type GateStatus,
  type GitHubOptions,
  type PollOptions,
} from './github.js';
import { fetchFrames, FramesError, type Frames } from './frames.js';
import { applyStoredPatch, type PatchStore } from './patch.js';
import { haltDispatcher, haltReason } from './halt.js';
import { mergeLock } from './lock.js';
import { errorMessage, type Logger } from './log.js';
import { restoreDeploy, siteUrl, waitForDeploy, type NetlifyOptions } from './netlify.js';
import { resolveRoleModel } from './role-model.js';
import { ceilingUsd, runAgentSession, type SessionOutcome } from './session.js';
import { round4 } from './pricing.js';
import { decideReview, revisionAddendum, runVisualReview, type VisualReviewDeps } from './visual-review.js';
import { mergedServedFiles, runSmoke, SMOKE_GATE_TIMEOUT_MS, type SmokeResult } from './smoke.js';
import { retry } from './time.js';
import {
  changedFiles,
  commitLane,
  commitTitle,
  commitTrailers,
  createWorktree,
  git,
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
  // The session budgets the tick set (budgets.ts); without it a session's budget is its ceiling.
  budgets?: SessionBudgets;
  // Infrastructure stops in a row per card, shared by every pipeline this process runs; a gate pass
  // clears the card's count.
  infraStops?: Map<string, number>;
  // The Directors' visual review (docs/specs/design-review.md); without it no card is reviewed.
  visual?: PipelineVisual;
}

export interface PipelineVisual {
  review: VisualReviewDeps;
  // The folder each review's frames are unpacked into, one subfolder per review, removed after it.
  framesRoot: string;
}

export const GATE_TIMEOUT_MS = 20 * 60_000;
export const GATE_INTERVAL_MS = 15_000;
export const DEPLOY_TIMEOUT_MS = 10 * 60_000;
export const DEPLOY_INTERVAL_MS = 10_000;
export const SHIP_WRITE_RETRIES = 3;
// Tries for a GitHub or Netlify request that throws: the first and two more.
export const REQUEST_TRIES = 3;
// Infrastructure stops in a row after which a card pauses for the board instead of going back to funded.
export const INFRA_REQUEUE_LIMIT = 3;

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

// A card that goes back to funded, to be claimed again: main moved while it was in the gate, the
// throttle's budget was gone by the time its session started, or its executor role was paused.
class Requeue extends Error {
  readonly from: readonly string[];
  readonly failingCheck: string;
  readonly alert: boolean;
  constructor(from: readonly string[], failingCheck: string, detail: string, alert: boolean) {
    super(detail);
    this.name = 'Requeue';
    this.from = from;
    this.failingCheck = failingCheck;
    this.alert = alert;
  }
}

// A stop the card did not cause (see the head of this file). afterMerge: the change had merged and was
// rolled back, so the card pauses rather than re-queueing. beforeSession: nothing was built yet, so
// claiming the card again starts no session a stored patch would have saved.
class InfraStop extends Error {
  readonly failingCheck: string;
  readonly afterMerge: boolean;
  readonly beforeSession: boolean;
  constructor(failingCheck: string, detail: string, afterMerge: boolean, beforeSession = false) {
    super(detail);
    this.name = 'InfraStop';
    this.failingCheck = failingCheck;
    this.afterMerge = afterMerge;
    this.beforeSession = beforeSession;
  }
}

const processInfraStops = new Map<string, number>();

function infraStops(deps: PipelineDeps): Map<string, number> {
  return deps.infraStops ?? processInfraStops;
}

// Where runCardPipeline is: preparing (before any session or stored patch), building (the session
// through the gate and the checks inside the merge lock), or merging (the merge request and after).
type Phase = 'preparing' | 'building' | 'merging';

// What an error means for the card, by where it was thrown. From the merge request on, merge and
// verifyMerged have already decided. Before it, a stop a check classified stands, and anything else (a
// database or GitHub error, a failed fetch of main, a dispatcher fault) is not the card's change
// failing, so it is an infrastructure stop, never a rejection.
function classifyFailure(error: unknown, phase: Phase): unknown {
  if (phase === 'merging') return error;
  if (error instanceof CardStop || error instanceof Requeue || error instanceof StageMoved || error instanceof LeftGated) return error;
  if (error instanceof InfraStop) {
    return phase === 'preparing' && !error.beforeSession ? new InfraStop(error.failingCheck, error.message, error.afterMerge, true) : error;
  }
  return new InfraStop('dispatcher_error', errorMessage(error), false, phase === 'preparing');
}

// A stage write found the card in a stage the dispatcher did not leave it in: the board moved it.
// Nothing more is written; an open pull request for it is closed.
class StageMoved extends Error {
  pr: number | null = null;
  constructor(message: string) {
    super(message);
    this.name = 'StageMoved';
  }
}

// A card that stays gated for recovery or the board. The message is the alert.
class LeftGated extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeftGated';
  }
}

// Stops the dispatcher already classifies pass through; anything else a GitHub, Netlify or git network
// call throws before the merge is an outage.
async function outage<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CardStop || error instanceof Requeue || error instanceof StageMoved || error instanceof LeftGated || error instanceof InfraStop) throw error;
    throw new InfraStop('outage', `${what}: ${errorMessage(error)}`, false);
  }
}

function mergedPending(card: Card, mergeSha: string, clause: string): LeftGated {
  return new LeftGated(`Card ${shortId(card.id)} merged as ${mergeSha.slice(0, 8)} ${clause}. It is left gated and is checked again when the dispatcher starts.`);
}

const PAUSING_OUTCOMES: Partial<Record<SessionOutcome, string>> = {
  ceiling: 'ceiling',
  budget: 'budget',
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
  let phase: Phase = 'preparing';
  try {
    role = await db.getRole(card.executor_role_id ?? '');
    const checks = parseAcceptance(card);
    const allowed = allowedPaths(card);
    worktree = await prepareWorktree(card, deps);
    await preCheck(worktree, checks);
    const before = await snapshotGitState(config.repoRoot, worktree.path);
    phase = 'building';
    const reused = await reuseStoredPatch(card, worktree, allowed, deps);
    const maker: Maker = { ref: null };
    const sessionError = reused
      ? null
      : await agentSession(card, role, worktree, deps).then(
          (sessionId) => {
            maker.ref = sessionRef(sessionId);
            return null;
          },
          (error: unknown) => error,
        );
    // Checked before any git runs again, whatever the session's outcome.
    await assertGitTrusted(card, worktree.path, before, deps, 'after the session');
    if (sessionError) throw sessionError;
    await postCheck(worktree, checks);
    const built = await commitAndOpenPullRequest(card, role, worktree, before, allowed, checks, deps);
    await finalize(card, deps, 'gated', null).catch((error: unknown) => {
      if (error instanceof StageMoved) error.pr = built.prNumber;
      throw error;
    });
    await waitForGatePass(card, role, built, deps);
    const commit = await visualReview({ card, role, worktree, before, allowed, checks, maker }, built, deps);
    // No further session runs for the card, so the rest of its budget is no longer held from others.
    deps.budgets?.close(card.id);
    const roleId = role.id;
    await mergeLock.run(async () => {
      await confirmMergeable(card, commit, deps);
      await confirmRemoteRange(commit, allowed, deps);
      phase = 'merging';
      const merged = await merge(card, roleId, commit, deps);
      await verifyMerged(card, roleId, merged.sha, checks, deps, { shaRecorded: merged.recorded });
    });
  } catch (error) {
    await settleFailure(card, role?.id ?? null, classifyFailure(error, phase), deps);
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
  if (error instanceof StageMoved) {
    log.warn('pipeline', `card ${card.id} stage moved`, { detail: error.message, pr: error.pr });
    const pr = error.pr;
    const closed = pr === null ? null : await attempt(deps, `card ${card.id} pull request close`, () => requesting(deps, () => closePullRequest(githubOptions(deps), pr)));
    const note = pr === null ? '' : closed === null ? ` Pull request #${pr} was closed.` : ` Pull request #${pr} could not be closed (${closed}).`;
    await deps.alert.notify(`Card ${shortId(card.id)}: ${error.message}${note} ${singleLineTitle(card.title)}`);
    return;
  }
  if (error instanceof Requeue) {
    log.info('pipeline', `card ${card.id} back to funded`, { check: error.failingCheck, detail: error.message });
    await attempt(deps, `card ${card.id} requeue event`, () => deps.db.insertEvent(card.id, roleId, 'message', { step: 'requeue', reason: error.failingCheck, detail: error.message }));
    const unwritten = await attempt(deps, `card ${card.id} stage`, () => finalize(card, deps, 'funded', error.failingCheck, error.from));
    if (error.alert || unwritten) await deps.alert.notify(`Card ${shortId(card.id)} is back in funded (${error.failingCheck}): ${singleLineTitle(card.title)}. ${error.message}${unwrittenNote(unwritten)}`);
    return;
  }
  if (error instanceof InfraStop) {
    await settleInfraStop(card, roleId, error, deps);
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

// An infrastructure stop: back to funded while the stops in a row stay under the limit and claiming it
// again costs no new session (it has a stored patch, or it stopped before any session ran), else
// paused. Never rejected.
async function settleInfraStop(card: Card, roleId: string | null, error: InfraStop, deps: PipelineDeps): Promise<void> {
  const stops = infraStops(deps);
  const count = (stops.get(card.id) ?? 0) + 1;
  stops.set(card.id, count);
  let stored = false;
  if (!error.afterMerge && deps.patches) {
    const patches = deps.patches;
    stored = (await patches.latest(card.id).catch(() => null)) !== null;
  }
  const requeue = !error.afterMerge && (stored || error.beforeSession) && count < INFRA_REQUEUE_LIMIT;
  const stage: WrittenStage = requeue ? 'funded' : 'paused';
  deps.log.warn('pipeline', `card ${card.id} stopped by infrastructure`, { check: error.failingCheck, detail: error.message, stops: count, stage, afterMerge: error.afterMerge, beforeSession: error.beforeSession });
  await attempt(deps, `card ${card.id} infrastructure event`, () =>
    deps.db.insertEvent(card.id, roleId, 'message', { step: 'infrastructure', check: error.failingCheck, detail: error.message, stops: count, stage }),
  );
  const unwritten = await attempt(deps, `card ${card.id} stage`, () => finalize(card, deps, stage, error.failingCheck));
  let why: string;
  if (requeue && stored) {
    why = `It is back in funded and is re-gated from its stored patch with no new session (stop ${count}; it pauses at ${INFRA_REQUEUE_LIMIT} in a row).`;
  } else if (requeue) {
    why = `It stopped before any session ran, so it is back in funded to be claimed again (stop ${count}; it pauses at ${INFRA_REQUEUE_LIMIT} in a row).`;
  } else if (error.afterMerge) {
    why = 'The change was rolled back as unverified; the card is paused with its money and is not rejected. Resume it from /board once the outage is over.';
  } else if (stored || error.beforeSession) {
    why = `It stopped this way ${count} times in a row, so it is paused with its money${stored ? ' and its stored patch' : ''}; resume it from /board once the cause is fixed.`;
  } else {
    why = 'It has no stored patch to re-gate, so it is paused with its money rather than starting a new session; resume it from /board once the cause is fixed.';
  }
  await deps.alert.notify(`Card ${shortId(card.id)} stopped by infrastructure, not by its change (${error.failingCheck}): ${singleLineTitle(card.title)}. ${error.message}. ${why}${unwrittenNote(unwritten)}`);
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

// The session's id when it completed (the maker ref of a visual approval), or null when its init line
// named none. promptAddendum is a visual revision's typed feedback.
async function agentSession(card: Card, role: Role, worktree: Worktree, deps: PipelineDeps, promptAddendum?: string): Promise<string | null> {
  const studio = await deps.db.getStudioState();
  const budgets = deps.budgets;
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
    // What the claim's budget still holds after the card's earlier sessions (budgets.ts), so a visual
    // revision spends only what the throttle sized the claim for.
    budgetUsd: budgets?.nextSession(card.id),
    onSpend: budgets ? (usd) => budgets.record(card.id, usd) : undefined,
    resolveModel: (r) => resolveRoleModel(r, deps.config).model,
    ...(promptAddendum ? { promptAddendum } : {}),
  });
  deps.log.info('pipeline', `session for card ${card.id} ended`, { outcome: run.outcome, turns: run.turns, detail: run.detail });
  if (run.outcome === 'completed') return run.sessionId ?? null;
  if (run.outcome === 'adapter_paused') throw new CardStop('paused', run.failingCheck ?? 'adapter', run.detail);
  if (run.outcome === 'insufficient_balance') throw new Requeue(['building'], 'insufficient_balance', run.detail, false);
  // A paused executor role is not the card's fault: the card goes back to funded with no rejection,
  // as after an infrastructure stop, and runnable() leaves it until the board resumes the role
  // (docs/specs/agent-system-core.md).
  if (run.outcome === 'role_paused') throw new Requeue(['building'], 'role_paused', run.detail, false);
  if (run.outcome === 'credit_exhausted') return stopForSpendRefusal(card, 'credit', run.detail, deps);
  if (run.outcome === 'tier_cap') return stopForSpendRefusal(card, 'tier_cap', run.detail, deps);
  const pausing = PAUSING_OUTCOMES[run.outcome];
  if (pausing) throw new CardStop('paused', pausing, run.detail);
  if (run.outcome === 'refused') throw new CardStop('rejected', 'tool_allowlist', run.detail);
  await deps.db.insertEvent(card.id, role.id, 'error', { step: 'session', message: run.detail });
  throw new CardStop('rejected', 'session', run.detail);
}

// The API refused the studio key: for credit (or the Console spend limit), or at the usage tier's
// monthly cap. The next session, a card's or a review's, would fail the same way, so the studio pauses
// and the card pauses with its money kept. Always throws.
async function stopForSpendRefusal(card: Card, refusal: SpendRefusal, detail: string, deps: PipelineDeps): Promise<never> {
  if (refusal === 'credit') {
    // The studio stops until the board buys credit.
    const unpaused = await attempt(deps, 'studio pause', () => deps.db.pauseStudio(`dispatcher: Console credit needed (card ${shortId(card.id)})`, deps.now(), 'awaiting_credit'));
    await deps.alert.notify(
      `Console credit needed: card ${shortId(card.id)} stopped because the API refused the studio key for credit or its spend limit. ${
        unpaused ? `The studio could not be paused (${unpaused}); pause it from /board.` : 'The studio is paused.'
      } Buy credit or raise the Console limit, record the purchase on /board, then unpause. The card is paused and keeps its money.`,
    );
    throw new CardStop('paused', REFUSAL_CHECK.credit, detail);
  }
  // Buying credit does not clear it: the organisation's usage tier caps its spend for the month, so the
  // studio stops until the month turns or Anthropic raises the tier.
  const unpaused = await attempt(deps, 'studio pause', () => deps.db.pauseStudio(`dispatcher: usage tier cap reached (card ${shortId(card.id)})`, deps.now(), 'spend_limit'));
  await deps.alert.notify(
    `Usage tier cap reached: card ${shortId(card.id)} stopped because the API says the studio organisation has reached the monthly usage limit of its Anthropic tier. ${
      unpaused ? `The studio could not be paused (${unpaused}); pause it from /board.` : 'The studio is paused.'
    } Buying credit does not clear it: the limit resets when the month turns, or sooner if Anthropic raises the tier (Console, Limits). Report the tier's monthly limit so the dispatcher stops below it, then unpause. The card is paused and keeps its money.`,
  );
  throw new CardStop('paused', REFUSAL_CHECK.tier_cap, detail);
}

// The builder session a visual approval names as its maker: claude:<session id>, the form a role
// session's grader ref takes, so the two can be compared.
interface Maker {
  ref: string | null;
}

function sessionRef(sessionId: string | null): string | null {
  return sessionId ? `claude:${sessionId}` : null;
}

interface Building {
  card: Card;
  role: Role;
  worktree: Worktree;
  before: string;
  allowed: readonly string[];
  checks: readonly ConfigCheck[];
  maker: Maker;
}

// The frames of the gate run that passed on sha, or null; a malformed or expired artifact stops the
// card as infrastructure, never as its failure.
async function framesFor(sha: string, dir: string, deps: PipelineDeps): Promise<Frames | null> {
  try {
    return await requesting(deps, () => fetchFrames(githubOptions(deps), sha, dir));
  } catch (error) {
    if (error instanceof FramesError) throw new InfraStop('frames', error.message, false);
    throw new InfraStop('outage', `the frames read: ${errorMessage(error)}`, false);
  }
}

// The Directors' visual review, between the green gate and the merge lock (see the head of this
// file). Returns the commit to merge: the first one, or the last revision's after its gate passed.
async function visualReview(building: Building, first: CommitInfo, deps: PipelineDeps): Promise<CommitInfo> {
  const visual = deps.visual;
  if (!visual) return first;
  const { card, role } = building;
  let commit = first;
  // Rounds used survive a restart: they are read from the card, never counted here from zero.
  let rounds = (await deps.db.getCard(card.id))?.review_rounds ?? card.review_rounds;
  for (let review = 1; ; review += 1) {
    const dir = path.join(visual.framesRoot, `frames-${shortId(card.id)}-${commit.sha.slice(0, 8)}`);
    await rm(dir, { recursive: true, force: true });
    try {
      const frames = await framesFor(commit.sha, dir, deps);
      if (!frames || frames.changed.length === 0) {
        deps.log.info('pipeline', `card ${card.id} draws nothing differently; no visual review`, { sha: commit.sha, artifact: frames !== null });
        return commit;
      }
      const budgetUsd = await reviewBudget(card, deps);
      const budgets = deps.budgets;
      const outcome = await runVisualReview(
        { card, frames, sha: commit.sha, gateUrl: null, review, budgetUsd, ...(budgets ? { onSpend: (usd: number) => budgets.record(card.id, usd) } : {}) },
        visual.review,
      );
      stopCheck(deps, 'while the visual review ran');
      if (outcome.kind === 'stopped') throw new CardStop('paused', 'dispatcher_stopped', 'dispatcher stopped during the visual review');
      if (outcome.kind === 'failed') {
        if (outcome.refusal) await stopForSpendRefusal(card, outcome.refusal, outcome.reason, deps);
        throw new InfraStop('visual_review', outcome.reason, false);
      }
      const { verdict, director } = outcome;
      const decision = decideReview(verdict, rounds);
      await deps.db.insertEvent(card.id, director.id, 'message', { step: 'visual_review', decision, review, rounds_used: rounds, sha: commit.sha, grader_ref: outcome.ref, criteria: verdict.criteria });
      deps.log.info('pipeline', `card ${card.id} visual review: ${decision}`, { review, rounds, director: director.name });
      if (decision === 'reject') {
        throw new CardStop('rejected', 'visual_review:all_ages', `after ${rounds} revise rounds the ${director.name} still found the frames not suitable for all ages`);
      }
      if (decision === 'merge' || decision === 'merge_open') {
        if (building.maker.ref !== null && outcome.refs.includes(building.maker.ref)) throw new InfraStop('visual_review', 'the review session is the builder session', false);
        await deps.db.recordVisualApproval({
          cardId: card.id,
          verdict: { ...verdict, decision, review, sha: commit.sha },
          approverRoleId: director.id,
          makerRoleId: role.id,
          makerRef: building.maker.ref,
          graderRef: outcome.ref,
        });
        return commit;
      }
      await revisionMayStart(building, deps);
      rounds = await deps.db.recordReviewRound(card.id);
      commit = await revise(building, commit, revisionAddendum(verdict, rounds), deps);
      await waitForGatePass(card, role, commit, deps);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

// What one visual review may spend: VISUAL_REVIEW_MAX_USD, no more than the claim's budget still holds
// after the card's earlier sessions (budgets.ts; a new session of the claim starts), and no more than
// is left under the card's ceiling (its spend read fresh, so the build and earlier reviews count). The
// review is billed to the card. Below VISUAL_REVIEW_MIN_USD no review starts: short of the ceiling the
// card pauses there, as a session that reaches it does; short of the claim's budget it goes back to
// funded, so the tick sizes a new budget from the money there is then.
async function reviewBudget(card: Card, deps: PipelineDeps): Promise<number> {
  const [studio, fresh] = await Promise.all([deps.db.getStudioState(), deps.db.getCard(card.id)]);
  const actual = fresh?.actual_usd ?? card.actual_usd;
  const ceiling = ceilingUsd((fresh ?? card).estimate_usd, studio.card_max_usd);
  const ceilingLeft = round4(ceiling - actual);
  if (ceilingLeft < VISUAL_REVIEW_MIN_USD) {
    throw new CardStop('paused', 'ceiling', `the card has spent ${actual} USD of its ${ceiling} USD ceiling, too little left for the visual review`);
  }
  const claimLeft = deps.budgets?.nextSession(card.id) ?? Number.POSITIVE_INFINITY;
  if (claimLeft < VISUAL_REVIEW_MIN_USD) {
    throw new Requeue(['gated'], 'insufficient_balance', `the claim's session budget holds ${claimLeft} USD, too little for the visual review`, false);
  }
  return round4(Math.min(deps.config.visualReviewMaxUsd, claimLeft, ceilingLeft));
}

// A revision starts only as a claim would: not while the board has agents paused (the card pauses),
// not while the executor role is paused (back to funded, as a paused executor is never the card's
// fault), and not once the claim's throttle budget is spent (back to funded, so the tick sizes a new
// budget from the money there is then). Each stop comes before the round is counted, and the card
// keeps its first change's stored patch, so a later claim re-gates it with no session.
async function revisionMayStart(building: Building, deps: PipelineDeps): Promise<void> {
  const { card, role } = building;
  if ((await deps.db.getStudioState()).paused) throw new CardStop('paused', 'paused_by_board', 'the board paused agents, so the visual revision did not start');
  if ((await deps.db.roleState(role.id)).paused) {
    throw new Requeue(['gated'], 'role_paused', `the executor role ${role.name} is paused, so the visual revision did not start`, false);
  }
  const left = deps.budgets?.remaining().get(card.id);
  if (left !== undefined && left <= 0) {
    throw new Requeue(['gated'], 'insufficient_balance', "the claim's session budget is spent, so the visual revision did not start", false);
  }
}

// A visual revision: the card goes back to building, the builder's new session works on the card's
// commit in the card's own mode, inside its ceiling (the card's spend read fresh) and, unattended,
// inside what the claim's throttle budget still holds after the first session (budgets.ts), and the
// change and the revision become one commit on the base, pushed to the same branch and pull request.
// It starts only as a claim would (revisionMayStart). No stored patch survives a revision, whatever
// stops it: the revision session's accepted patch is made against the card's commit, not main, so it
// is discarded as soon as the session settles, and a later re-queue never rebuilds the revision alone.
async function revise(building: Building, commit: CommitInfo, addendum: string, deps: PipelineDeps): Promise<CommitInfo> {
  const { card, role, worktree, before, allowed, checks, maker } = building;
  if (!(await deps.db.updateCardIf(card.id, ['gated'], { stage: 'building', failing_check: null }))) {
    const current = await deps.db.getCard(card.id).catch(() => null);
    const moved = new StageMoved(`the card is ${current?.stage ?? 'gone'}, not gated, so its visual revision did not start; the dispatcher left it as it is.`);
    moved.pr = commit.prNumber;
    throw moved;
  }
  await deps.patches?.discard(card.id);
  const current = (await deps.db.getCard(card.id)) ?? card;
  const sessionError = await agentSession(current, role, worktree, deps, addendum).then(
    (sessionId) => {
      maker.ref = sessionRef(sessionId);
      return null;
    },
    (error: unknown) => error,
  );
  // The revision is in the worktree now, or the session stopped; either way its stored patch goes. One
  // that cannot be discarded is refused at the next claim, since its base is not on main (patch.ts).
  if (deps.patches) {
    const patches = deps.patches;
    await attempt(deps, `card ${card.id} revision patch discard`, () => patches.discard(card.id));
  }
  await assertGitTrusted(card, worktree.path, before, deps, 'after the revision session');
  if (sessionError) throw sessionError;
  const head = await headSha(worktree.path);
  if (head !== commit.sha) throw new CardStop('rejected', 'history', `the revision session moved HEAD from ${commit.sha} to ${head}`);
  await assertGitTrusted(card, worktree.path, before, deps, 'before the revision is squashed');
  await git(['reset', '--quiet', '--soft', worktree.baseSha], worktree.path);
  await postCheck(worktree, checks);
  const revised = await commitAndOpenPullRequest(current, role, worktree, before, allowed, checks, deps);
  await finalize(card, deps, 'gated', null).catch((error: unknown) => {
    if (error instanceof StageMoved) error.pr = revised.prNumber;
    throw error;
  });
  return revised;
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
  await outage('the branch push', () => pushBranch(worktree.path, worktree.branch, deps.config.githubToken, commit.sha));
  const title = commitTitle(input);
  const trailers = commitTrailers(input);
  const github = githubOptions(deps);
  const pr = await outage('the pull request', () =>
    openPullRequest(github, {
      head: worktree.branch,
      title,
      body: `${card.intent ?? ''}\n\n${trailers}`.trim(),
    }),
  );
  // An existing pull request can still show the head before the force-push; the gate and the merge
  // guard must see the pushed sha.
  if (pr.headSha !== commit.sha) {
    const t = timings(deps);
    const moved = await outage('the pull request head read', () =>
      waitForPullHead(github, pr.number, commit.sha, { timeoutMs: t.prHeadTimeoutMs, intervalMs: t.prHeadIntervalMs, signal: deps.stopSignal }),
    );
    if (!moved) {
      stopCheck(deps, 'while the pull request head was updating');
      // GitHub lagging behind a push is not the card's failure; nothing is gated or merged on the stale
      // head, and confirmRemoteRange still checks what would merge on the next attempt.
      throw new InfraStop('pr_head', `pull request #${pr.number} did not show the pushed sha ${commit.sha} within ${t.prHeadTimeoutMs / 1000} s`, false);
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

// Only a gate that judged the card's change and failed it, on a base whose own gate did not fail,
// rejects the card. Anything else short of a pass is an infrastructure stop.
async function waitForGatePass(card: Card, role: Role, commit: CommitInfo, deps: PipelineDeps): Promise<void> {
  const t = timings(deps);
  const poll: PollOptions = { timeoutMs: t.gateTimeoutMs, intervalMs: t.gateIntervalMs, signal: deps.stopSignal };
  const gate = await outage('the gate read', () => waitForGate(githubOptions(deps), commit.sha, poll));
  stopCheck(deps, 'while the gate was running');
  if (gate.state === 'pass') {
    infraStops(deps).delete(card.id);
    await deps.db.insertEvent(card.id, role.id, 'gate_pass', { sha: commit.sha, pr: commit.prNumber });
    return;
  }
  const infra = await gateInfrastructure(gate, commit, poll, deps);
  if (infra) throw new InfraStop(infra.check, infra.detail, false);
  const detail = `gate concluded ${gate.state === 'fail' ? gate.conclusion : gate.state}`;
  await deps.db.insertEvent(card.id, role.id, 'gate_fail', { sha: commit.sha, pr: commit.prNumber, detail });
  throw new CardStop('rejected', 'gate', detail);
}

// Why a gate that did not pass is not the card's failure, or null when it is. A completed failure is
// the card's own unless main's gate at the card's base failed too: then the card was built on a red
// main. When that base gate is still running at the deadline, nobody can tell, so the card is not
// rejected.
async function gateInfrastructure(gate: GateStatus, commit: CommitInfo, poll: PollOptions, deps: PipelineDeps): Promise<{ check: string; detail: string } | null> {
  const sha = commit.sha.slice(0, 8);
  const minutes = poll.timeoutMs / 60_000;
  if (gate.state === 'missing') return { check: 'gate_missing', detail: `no gate run started on ${sha} within ${minutes} minutes` };
  if (gate.state === 'pending') return { check: 'gate_pending', detail: `the gate on ${sha} was still running after ${minutes} minutes` };
  if (gate.state !== 'fail') return null;
  if (isInfrastructureConclusion(gate.conclusion)) return { check: 'gate_infrastructure', detail: `the gate run on ${sha} concluded ${gate.conclusion} without judging the change` };
  const base = await outage("the gate read at the card's base", () => waitForGate(githubOptions(deps), commit.baseSha, poll));
  stopCheck(deps, "while main's gate at the card's base was running");
  const baseSha = commit.baseSha.slice(0, 8);
  if (base.state === 'fail' && !isInfrastructureConclusion(base.conclusion)) {
    return { check: 'main_red', detail: `the gate on ${sha} concluded ${gate.conclusion}, and main's gate at the card's base ${baseSha} had concluded ${base.conclusion} too, so main was red before the card` };
  }
  if (base.state === 'pending') {
    return { check: 'gate_pending', detail: `the gate on ${sha} concluded ${gate.conclusion} while main's gate at the card's base ${baseSha} was still running after ${minutes} minutes` };
  }
  return null;
}

// Read again inside the merge lock, right before the merge. A studio the board paused while the card
// was in the gate pauses the card. A card the board moved off horizon now, or vetoed, is paused; one
// that is no longer gated is left as the board set it. Then main's head must still be the card's base
// sha: the gate tested the card on that base alone, so a card whose base is behind goes back to funded
// and is built again on the new main.
async function confirmMergeable(card: Card, commit: CommitInfo, deps: PipelineDeps): Promise<void> {
  const [studio, current] = await Promise.all([deps.db.getStudioState(), deps.db.getCard(card.id)]);
  if (studio.paused) throw new CardStop('paused', 'paused_by_board', 'the board paused the studio while the card was in the gate; it was not merged');
  if (!current || current.stage !== 'gated') {
    const moved = new StageMoved(`the card moved to ${current?.stage ?? 'nowhere'} while it was in the gate; it was not merged and its stage is left as the board set it.`);
    moved.pr = commit.prNumber;
    throw moved;
  }
  if (current.horizon !== 'now') throw new CardStop('paused', 'horizon', `the board moved the card to horizon ${current.horizon} while it was in the gate; it was not merged`);
  if (current.director_stance === 'vetoed') throw new CardStop('paused', 'vetoed', 'the card was vetoed while it was in the gate; it was not merged');
  const head = await outage("main's head read", () => requesting(deps, () => mainHead(githubOptions(deps))));
  if (head !== commit.baseSha) {
    throw new Requeue(['gated'], 'main_moved', `main moved from ${commit.baseSha.slice(0, 8)} to ${head.slice(0, 8)} while the card was in the gate, so the tested change is not what would merge; it goes back to funded to be built on the new main`, false);
  }
}

const SYMLINK_MODE = '120000';
const GITLINK_MODE = '160000';

// GitHub's own view of the pushed range must match the local check before anything merges: one
// commit on the base, the same changed paths (a rename counts both names), all inside the lane, and
// no symlink or submodule on either side. A mismatch is history, since the local repository or the
// push was not what it seemed.
async function confirmRemoteRange(commit: CommitInfo, allowed: readonly string[], deps: PipelineDeps): Promise<void> {
  const github = githubOptions(deps);
  const range = await outage('the range read', () => requesting(deps, () => compareRange(github, commit.baseSha, commit.sha)));
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
  const baseModes = await outage('the tree read', () => requesting(deps, () => treeModes(github, commit.baseSha)));
  const headModes = await outage('the tree read', () => requesting(deps, () => treeModes(github, commit.sha)));
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
      await attempt(deps, `card ${card.id} merge_unknown marker`, () => finalize(card, deps, 'gated', 'merge_unknown', ['gated']));
      throw new LeftGated(
        `Card ${shortId(card.id)}: the merge request for pull request #${commit.prNumber} failed and GitHub did not show it merged (${result.reason}). It is left gated; the dispatcher checks it again when it starts, and nothing was closed.`,
      );
    }
    // A refusal while main moved (GitHub's 405 "Base branch was modified" when the board merges in the
    // gap after confirmMergeable) is not the card's fault: it goes back to funded like main_moved.
    const head = await mainHead(githubOptions(deps)).catch(() => commit.baseSha);
    if (head !== commit.baseSha) {
      throw new Requeue(['gated'], 'main_moved', `main moved from ${commit.baseSha.slice(0, 8)} to ${head.slice(0, 8)} as the card merged, and the merge was refused (${result.status}); it goes back to funded to be built on the new main`, false);
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
      // A deploy that failed or was skipped never published. One that did not finish in time may still
      // publish, so the previous green deploy is restored as after a failed smoke test.
      await rollBack(card, roleId, mergeSha, `deploy ${deploy.timedOut ? 'did not finish' : 'failed'}: ${deploy.reason}`, deploy.timedOut === true, deps);
      // A deploy Netlify never finished is not the card's failure; one that failed to build is.
      if (deploy.timedOut) throw new InfraStop('deploy_timeout', deploy.reason, true);
      throw new CardStop('rejected', 'deploy', deploy.reason);
    }
    const baseUrl = await requesting(deps, () => siteUrl(netlify, siteId));
    const smoke = await smokeMerged(card, mergeSha, baseUrl, checks, deps);
    verdict = { deployId: deploy.deploy.id, baseUrl, smoke };
  } catch (error) {
    if (error instanceof CardStop || error instanceof LeftGated || error instanceof InfraStop) throw error;
    const detail = errorMessage(error);
    deps.log.error('pipeline', `card ${card.id} could not be verified after merge`, { sha: mergeSha, detail });
    // No verdict: the change is taken back out (the kernel), but nothing showed the card's change
    // failing, so the card pauses rather than being rejected.
    await rollBack(card, roleId, mergeSha, `post-merge check failed: ${detail}`, true, deps);
    throw new InfraStop(deps.stopSignal.aborted ? 'dispatcher_stopped' : 'post_merge_outage', detail, true);
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
    return;
  }
  deps.log.error('pipeline', `card ${card.id} rollback incomplete`, payload);
  // Main may still carry the failed change, and the next merge would ship it again, so nothing more
  // is claimed until the board has looked.
  let paused = '';
  if (!revert.ok) {
    const unpaused = await attempt(deps, 'studio pause', () => deps.db.pauseStudio(`dispatcher: the revert of card ${shortId(card.id)} failed`, deps.now(), 'incident'));
    paused = unpaused ? ` The studio could not be paused (${unpaused}); pause it from /board.` : ' The studio is paused until the board unpauses it.';
  }
  await deps.alert.notify(`Card ${shortId(card.id)} failed after merge and the rollback is incomplete: ${problems.join('; ')}. Check main and the live site.${paused}`);
}

type WrittenStage = 'gated' | 'live' | 'rejected' | 'paused' | 'funded';

// The stages the dispatcher itself leaves a card in before each write.
const EXPECTED: Record<WrittenStage, readonly string[]> = {
  gated: ['building'],
  live: ['gated'],
  rejected: ['building', 'gated'],
  paused: ['building', 'gated'],
  funded: ['building', 'gated'],
};

// actual_usd is written from the ledger at every terminal stage and at gated. The write happens only
// while the card is still in a stage the dispatcher left it in.
async function finalize(card: Card, deps: PipelineDeps, stage: WrittenStage, failingCheck: string | null, from: readonly string[] = EXPECTED[stage]): Promise<void> {
  const actual = await deps.db.sumLedger(card.id);
  const patch: CardPatch = { stage, failing_check: failingCheck, actual_usd: actual };
  if (await deps.db.updateCardIf(card.id, from, patch)) return;
  const current = await deps.db.getCard(card.id).catch(() => null);
  throw new StageMoved(`the card is ${current?.stage ?? 'gone'}, not ${from.join(' or ')}, so it was not moved to ${stage}; the dispatcher left it as it is.`);
}
