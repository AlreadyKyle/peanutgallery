// The life of one claimed card: worktree, pre-check, agent session, post-check, commit, push,
// pull request, gate, merge, deploy, smoke; then live with a ship event, or rejected with the
// failing check and the previous green deploy restored.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseChecks, evaluateCheck, AcceptanceGrammarError, type ConfigCheck } from './acceptance.js';
import type { AgentAdapter, CardFolder } from './adapters/types.js';
import type { DispatcherConfig } from './config.js';
import type { Card, Db, Role } from './db.js';
import { mergePullRequest, openPullRequest, pushBranch, waitForGate, type GitHubOptions } from './github.js';
import { errorMessage, type Logger } from './log.js';
import { restoreDeploy, siteUrl, waitForDeploy, type NetlifyOptions } from './netlify.js';
import { runAgentSession, type SessionOutcome } from './session.js';
import { runSmoke } from './smoke.js';
import {
  changedFiles,
  commitLane,
  commitTitle,
  commitTrailers,
  createWorktree,
  gitAuthArgs,
  lanePaths,
  outsideLane,
  removeWorktree,
  type Worktree,
} from './worktree.js';

export interface PipelineDeps {
  db: Db;
  adapter: AgentAdapter;
  config: DispatcherConfig;
  log: Logger;
  stopSignal: AbortSignal;
  now: () => Date;
  fetchFn?: typeof fetch;
}

export const GATE_TIMEOUT_MS = 20 * 60_000;
export const GATE_INTERVAL_MS = 15_000;
export const DEPLOY_TIMEOUT_MS = 10 * 60_000;
export const SMOKE_BOT_SECONDS = 60;

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

const PAUSING_OUTCOMES: Partial<Record<SessionOutcome, string>> = {
  ceiling: 'ceiling',
  turn_cap: 'turn_cap',
  board_session_lapsed: 'board_session',
  paused_by_board: 'paused_by_board',
  unknown_model: 'unknown_model',
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
  const { db, config, log } = deps;
  let role: Role | null = null;
  let worktree: Worktree | null = null;
  try {
    role = await db.getRole(card.executor_role_id ?? '');
    const checks = parseAcceptance(card);
    const allowed = allowedPaths(card);
    worktree = await prepareWorktree(card, deps);
    await preCheck(worktree, checks);
    await agentSession(card, role, worktree, deps);
    await postCheck(worktree, checks);
    const commit = await commitAndOpenPullRequest(card, role, worktree, allowed, checks, deps);
    await finalize(card, deps, 'gated', null);
    const mergeSha = await gateAndMerge(card, role, commit, deps);
    await deployAndSmoke(card, role, mergeSha, checks, deps);
    await finalize(card, deps, 'live', null);
  } catch (error) {
    if (error instanceof CardStop) {
      log.warn('pipeline', `card ${card.id} ${error.stage}`, { check: error.failingCheck, detail: error.message });
      await finalize(card, deps, error.stage, error.failingCheck);
    } else {
      const detail = errorMessage(error);
      log.error('pipeline', `card ${card.id} failed`, { detail });
      await db.insertEvent(card.id, role?.id ?? null, 'error', { step: 'pipeline', message: detail });
      await finalize(card, deps, 'rejected', 'dispatcher_error');
    }
  } finally {
    if (worktree) {
      await removeWorktree(config.repoRoot, worktree.path, worktree.branch).catch((error: unknown) =>
        log.warn('pipeline', 'worktree removal failed', { path: worktree?.path, error: errorMessage(error) }),
      );
    }
  }
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
  const worktree = await createWorktree(deps.config.repoRoot, deps.config.worktreeRoot, card.id, card.lane, gitAuthArgs(deps.config.githubToken));
  await deps.db.updateCard(card.id, { branch: worktree.branch });
  deps.log.info('pipeline', `worktree ready for card ${card.id}`, { path: worktree.path, branch: worktree.branch });
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
  await pushBranch(worktree.path, worktree.branch, deps.config.githubToken);
  const title = commitTitle(input);
  const trailers = commitTrailers(input);
  const pr = await openPullRequest(githubOptions(deps), {
    head: worktree.branch,
    title,
    body: `${card.intent ?? ''}\n\n${trailers}`.trim(),
  });
  deps.log.info('pipeline', `pull request #${pr.number} open for card ${card.id}`, { sha: commit.sha });
  return { sha: pr.headSha, branch: worktree.branch, prNumber: pr.number, title, trailers };
}

// A wait that returned because the dispatcher is stopping is not a failure of the card: the
// gate or deploy is still running, so the card pauses and no deploys row is written.
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
  const gate = await waitForGate(githubOptions(deps), commit.sha, { timeoutMs: GATE_TIMEOUT_MS, intervalMs: GATE_INTERVAL_MS, signal: deps.stopSignal });
  stopCheck(deps, 'while the gate was running');
  if (gate.state !== 'pass') {
    const detail = gate.state === 'fail' ? `gate concluded ${gate.conclusion}` : `gate ${gate.state} after ${GATE_TIMEOUT_MS / 60_000} minutes`;
    await deps.db.insertEvent(card.id, role.id, 'gate_fail', { sha: commit.sha, pr: commit.prNumber, detail });
    throw new CardStop('rejected', 'gate', detail);
  }
  await deps.db.insertEvent(card.id, role.id, 'gate_pass', { sha: commit.sha, pr: commit.prNumber });
  const merge = await mergePullRequest(githubOptions(deps), commit.prNumber, commit.sha, { title: commit.title, message: commit.trailers });
  if (!merge.ok) throw new CardStop('rejected', 'merge', `merge refused (${merge.status}): ${merge.reason}`);
  await deps.db.updateCard(card.id, { commit_sha: merge.sha });
  deps.log.info('pipeline', `card ${card.id} merged`, { sha: merge.sha });
  return merge.sha;
}

async function deployAndSmoke(card: Card, role: Role, mergeSha: string, checks: readonly ConfigCheck[], deps: PipelineDeps): Promise<void> {
  const siteId = siteIdFor(deps.config, card.folder);
  const netlify = netlifyOptions(deps);
  const deploy = await waitForDeploy(netlify, siteId, mergeSha, { timeoutMs: DEPLOY_TIMEOUT_MS, signal: deps.stopSignal });
  stopCheck(deps, 'while the deploy was running');
  if (!deploy.ok) {
    await deps.db.insertDeploy({ folder: card.folder, sha: mergeSha, netlify_deploy_id: deploy.deploy?.id ?? null, is_green: false, smoke_result: `fail: ${deploy.reason}` });
    throw new CardStop('rejected', 'deploy', deploy.reason);
  }
  const baseUrl = await siteUrl(netlify, siteId);
  const smoke = await runSmoke({ baseUrl, sha: mergeSha, folder: card.folder, checks, repoRoot: deps.config.repoRoot, botSeconds: SMOKE_BOT_SECONDS, fetchFn: deps.fetchFn });
  if (smoke.ok) {
    await deps.db.insertDeploy({ folder: card.folder, sha: mergeSha, netlify_deploy_id: deploy.deploy.id, is_green: true, smoke_result: smoke.summary });
    await deps.db.insertEvent(card.id, role.id, 'ship', { sha: mergeSha, deploy_id: deploy.deploy.id, url: baseUrl, smoke: smoke.summary });
    deps.log.info('pipeline', `card ${card.id} is live`, { sha: mergeSha, url: baseUrl });
    return;
  }
  const previous = await deps.db.lastGreen(card.folder);
  await deps.db.insertDeploy({ folder: card.folder, sha: mergeSha, netlify_deploy_id: deploy.deploy.id, is_green: false, smoke_result: smoke.summary });
  if (previous?.netlify_deploy_id) {
    await restoreDeploy(netlify, siteId, previous.netlify_deploy_id);
    await deps.db.insertEvent(card.id, role.id, 'revert', { failed_sha: mergeSha, restored_sha: previous.sha, restored_deploy_id: previous.netlify_deploy_id, smoke: smoke.summary });
    deps.log.warn('pipeline', `card ${card.id} smoke failed; previous deploy restored`, { restored: previous.netlify_deploy_id });
  } else {
    await deps.db.insertEvent(card.id, role.id, 'revert', { failed_sha: mergeSha, restored_sha: null, restored_deploy_id: null, smoke: smoke.summary });
    deps.log.error('pipeline', `card ${card.id} smoke failed and no green deploy exists to restore`, { folder: card.folder });
  }
  throw new CardStop('rejected', 'smoke', smoke.summary);
}

// actual_usd is written from the ledger at every terminal stage and at gated.
async function finalize(card: Card, deps: PipelineDeps, stage: 'gated' | 'live' | 'rejected' | 'paused', failingCheck: string | null): Promise<void> {
  const actual = await deps.db.sumLedger(card.id);
  await deps.db.updateCard(card.id, { stage, failing_check: failingCheck, actual_usd: actual });
}
