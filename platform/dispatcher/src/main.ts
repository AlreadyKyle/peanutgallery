// Dispatcher entry: loads .env from the repository root, validates configuration, takes the
// dispatcher lease (waiting while another dispatcher holds it), finishes job runs a previous process
// left running as failed, checks that the database agrees on the agent mode, checks containment and
// probes the account in unattended mode, closes Managed Agents sessions and recovers cards left
// mid-flight by a previous process, and runs the tick loop, which also drains the job queue
// (jobs.ts), until SIGINT or SIGTERM. Stopping leaves studio_state.paused alone, so a
// restart resumes work, releases the lease once running cards have stopped, and a restart also
// clears a halt.
// A startup error marked fatal exits 78, which systemd does not restart; any other exits 1.
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { AttendedAdapter } from './adapters/attended.js';
import { defaultCliPin } from './cli-pin.js';
import { createAdapter } from './adapters/factory.js';
import { createAlerter } from './alert.js';
import { createDiscordPoster } from './discord.js';
import { SessionBudgets } from './budgets.js';
import { loadConfig } from './config.js';
import { createSupabaseDb, type Card, type Db, type Role } from './db.js';
import { EXIT_FATAL, exitCodeFor } from './exit-code.js';
import { gateStatus, mainHead } from './github.js';
import { createLogger, errorMessage } from './log.js';
import { createSupabasePatchStore } from './patch.js';
import { findCardMerge, resumeMerged, runCardPipeline, stuckAfterMs, type PipelineDeps, type PipelineVisual } from './pipeline.js';
import { recoverOrphans } from './recovery.js';
import { jobTick, type JobState } from './jobs.js';
import { runOutbound } from './outbound.js';
import { upkeepDeps } from './job-handlers/upkeep.js';
import { gitWorkspace, type WorkflowDeps } from './job-handlers/workflow.js';
import { scanPublicText } from './public-text.js';
import { AGENTS_DIR, TypedOutput } from './typed-output.js';
import { gitAuthEnv } from './worktree.js';
import { resolveRoleModel } from './role-model.js';
import { checkRepositoryGit, failStaleJobRuns, startupChecks } from './startup.js';
import { leaseTtlSeconds, tick } from './tick.js';
import { sleep } from './time.js';

// How long a stopping dispatcher waits for running cards: a session's SIGINT grace (15 s) and SIGTERM
// grace (5 s), its settle rows and the card's pause all fit, inside docker stop's 60 s.
const SHUTDOWN_GRACE_MS = 50_000;

// The checkout this file runs from. .env is read from here and never from DISPATCHER_REPO_ROOT, a
// clone agent-written code can write to.
export const CODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

const log = createLogger();

// Waits until this process holds the lease, so startup's probe and recovery never run beside another
// dispatcher's cards. False when the process is told to stop first.
async function acquireLease(db: Db, holder: string, ttlSeconds: number, tickMs: number, stop: AbortSignal): Promise<boolean> {
  let told = false;
  while (!stop.aborted) {
    if (await db.claimLease(holder, ttlSeconds)) return true;
    if (!told) log.warn('main', 'another dispatcher holds the lease; waiting for it', { holder });
    told = true;
    await sleep(tickMs, stop);
  }
  return false;
}

async function main(): Promise<void> {
  loadDotenv({ path: path.join(CODE_ROOT, '.env'), quiet: true });
  const config = loadConfig(process.env, CODE_ROOT);
  const db = createSupabaseDb(config.supabaseUrl, config.supabaseServiceRoleKey);
  const alert = createAlerter({ healthcheckUrl: config.healthcheckUrl, ntfyTopicUrl: config.ntfyTopicUrl, log });
  const poster = createDiscordPoster({ ships: config.discordWebhookShips, weekly: config.discordWebhookWeekly, log });
  // Accepted managed-session patches, re-applied when their card re-queues; attended cards have none.
  const patches = config.agentMode === 'unattended' ? createSupabasePatchStore(config.supabaseUrl, config.supabaseServiceRoleKey) : null;
  const adapter = createAdapter(config, { db, alert, log, patches });
  const stop = new AbortController();
  const running = new Map<string, Date>();
  const now = () => new Date();
  const budgets = new SessionBudgets();
  // The role jobs and the Directors' visual review run attended through claude -p on the founder's
  // plan in either studio mode (docs/specs/agent-workflows.md, docs/specs/design-review.md), so an
  // unattended process keeps an attended adapter for them. Its Read, Glob and Grep deny rules name the
  // code clone too, whose .env holds the dispatcher's keys, and there its sessions hold no Bash
  // (role-session.ts), since the host runs no agent-written code.
  const roleAdapter =
    adapter.mode === 'attended'
      ? adapter
      : new AttendedAdapter({ claudeBin: config.claudeBin, repoRoot: config.repoRoot, codeRoot: config.codeRoot, cliPin: defaultCliPin(config.codeRoot, config.claudeBin) });
  const typed = new TypedOutput();
  const resolveModel = (role: Role) => resolveRoleModel(role, config).model;
  const visual: PipelineVisual = {
    framesRoot: config.worktreeRoot,
    review: {
      db,
      session: {
        adapter: roleAdapter,
        typed,
        priceTable: config.priceTable,
        resolveModel,
        maxTurns: config.sessionMaxTurns,
        maxMs: config.sessionMaxMinutes * 60_000,
        boardSessionTtlMin: config.boardSessionTtlMin,
        watchIntervalMs: config.tickMs,
        log,
        stopSignal: stop.signal,
        now,
      },
      rubric: () => readFile(path.join(AGENTS_DIR, 'rubrics', 'visual.md'), 'utf8'),
      promptRoot: config.codeRoot,
      budgetUsd: config.cardMaxUsd,
      waitIntervalMs: config.tickMs,
    },
  };
  const pipeline: PipelineDeps = { db, adapter, config, log, alert, stopSignal: stop.signal, now, budgets, patches, infraStops: new Map(), visual };
  const github = { token: config.githubToken, repo: config.githubRepo };
  const mainGate = async () => {
    const sha = await mainHead(github);
    return { sha, status: await gateStatus(github, sha) };
  };
  const leaseHolder = `${os.hostname()}/${process.pid}/${randomUUID().slice(0, 8)}`;
  const ttlSeconds = leaseTtlSeconds(config.tickMs);

  const onSignal = (signal: string) => {
    if (stop.signal.aborted) return;
    log.warn('main', `${signal} received; stopping`);
    stop.abort('dispatcher stopping');
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  // Before any git runs: a repository whose git configuration is refused stops the process with 78.
  await checkRepositoryGit(config.repoRoot, config.githubRepo);
  if (!(await acquireLease(db, leaseHolder, ttlSeconds, config.tickMs, stop.signal))) return;
  log.info('main', 'dispatcher lease held', { holder: leaseHolder, ttlSeconds });
  await failStaleJobRuns(db, leaseHolder, log);
  await startupChecks({ db, adapter, config, log });
  // The Claude Code pin (cli-pin.ts): in attended mode the tick claims no card while the CLI is off
  // it, and every attended session, role jobs included, checks it again before it starts.
  const cliPin = defaultCliPin(config.codeRoot, config.claudeBin);
  const pin = await cliPin.state();
  if (pin.ok) log.info('main', 'claude code is on its pin', { version: pin.version });
  else log.warn('main', 'claude code is not on its pin; no card is claimed and attended sessions refuse to start', { installed: pin.installed, pinned: pin.pinned, detail: pin.detail });
  const managed = adapter.managed;
  await recoverOrphans({
    db,
    config,
    log,
    alert,
    running,
    now,
    resume: (card: Card) => resumeMerged(card, pipeline),
    lookupMerge: (card: Card) => findCardMerge(card, pipeline),
    ...(managed ? { closeSessions: () => managed.closeOrphans() } : {}),
  });
  const jobState: JobState = { running: null };
  // The Janitor's two code jobs (docs/specs/agent-upkeep.md).
  const upkeep = upkeepDeps(config, mainGate);
  const workflow: WorkflowDeps = {
    roleAdapter,
    typed,
    priceTable: config.priceTable,
    resolveModel,
    sessionMaxTurns: config.sessionMaxTurns,
    sessionMaxMs: config.sessionMaxMinutes * 60_000,
    boardSessionTtlMin: config.boardSessionTtlMin,
    watchIntervalMs: config.tickMs,
    scanText: (strings) => scanPublicText(strings),
    openWorkspace: (runId) => gitWorkspace(config.repoRoot, config.worktreeRoot, runId, gitAuthEnv(config.githubToken)),
    rubric: () => readFile(path.join(AGENTS_DIR, 'rubrics', 'draft-game.md'), 'utf8'),
  };
  log.info('main', 'dispatcher started', {
    mode: config.agentMode,
    tickMs: config.tickMs,
    repo: config.githubRepo,
    code: config.codeRoot,
    clone: config.repoRoot,
    worktrees: config.worktreeRoot,
  });

  const deps = {
    db,
    mode: adapter.mode,
    boardSessionTtlMin: config.boardSessionTtlMin,
    maxConcurrency: config.maxConcurrency,
    running,
    budgets,
    leaseHolder,
    leaseTtlSeconds: ttlSeconds,
    stuckAfterMs: stuckAfterMs(config.sessionMaxMinutes),
    now,
    log,
    alert,
    runCard: (card: Card) => runCardPipeline(card, pipeline),
    mainGate,
    // An attended card session runs on this host's Claude Code: nothing is claimed off its pin.
    ...(adapter.mode === 'attended' ? { cliPin: () => cliPin.state() } : {}),
    jobTick: () =>
      jobTick({
        db,
        mode: adapter.mode,
        adapter,
        log,
        alert,
        now,
        leaseHolder,
        boardSessionTtlMin: config.boardSessionTtlMin,
        watchIntervalMs: config.tickMs,
        state: jobState,
        stopSignal: stop.signal,
        workflow,
        upkeep,
      }),
    // Discord, outbound only (docs/specs/studio-reports.md); inert with no webhook set.
    outbound: () => runOutbound({ db, poster, siteUrl: config.publicSiteUrl, now, log }),
  };

  while (!stop.signal.aborted) {
    try {
      const outcome = await tick(deps);
      log.info('tick', outcome.action, { ...outcome, running: running.size });
    } catch (error) {
      log.error('tick', 'tick failed', { error: errorMessage(error) });
    }
    await sleep(config.tickMs, stop.signal);
  }

  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while ((running.size > 0 || jobState.running) && Date.now() < deadline) {
    await sleep(500);
  }
  // A card still merging or verifying keeps the lease until it lapses, so another dispatcher
  // cannot recover or verify that card while this process is still working on it. A job still
  // running is failed by the next process's startup.
  if (running.size === 0) {
    await db.releaseLease(leaseHolder).catch((error: unknown) => log.warn('main', 'lease release failed; it lapses on its own', { error: errorMessage(error), ttlSeconds }));
  } else {
    log.warn('main', 'cards still running at shutdown; the lease is kept and lapses on its own', { unfinished: running.size, ttlSeconds });
  }
  log.info('main', 'dispatcher stopped', { unfinished: running.size });
}

main().catch((error: unknown) => {
  const exitCode = exitCodeFor(error);
  log.error('main', 'dispatcher exited with an error', { error: errorMessage(error), exitCode, restart: exitCode !== EXIT_FATAL });
  process.exit(exitCode);
});
