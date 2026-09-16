// Dispatcher entry: loads .env from the repository root, validates configuration, checks that
// the database agrees on the agent mode, probes the account in unattended mode, recovers cards
// left mid-flight by a previous process, starts the scheduler, and runs the tick loop until
// SIGINT or SIGTERM. Stopping leaves studio_state.paused alone, so a restart resumes work, and a
// restart also clears a halt.
// A startup error marked fatal exits 78, which systemd does not restart; any other exits 1.
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createAdapter } from './adapters/factory.js';
import { createAlerter } from './alert.js';
import { loadConfig } from './config.js';
import { createSupabaseDb, type Card } from './db.js';
import { EXIT_FATAL, exitCodeFor } from './exit-code.js';
import { createHalt } from './halt.js';
import { createLogger, errorMessage } from './log.js';
import { resumeMerged, runCardPipeline, stuckAfterMs, type PipelineDeps } from './pipeline.js';
import { runProbe } from './probe-core.js';
import { recoverOrphans } from './recovery.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { startupChecks } from './startup.js';
import { tick } from './tick.js';
import { sleep } from './time.js';

// How long a stopping dispatcher waits for running cards: a session's SIGINT grace (15 s) and SIGTERM
// grace (5 s), its settle rows and the card's pause all fit, inside docker stop's 60 s.
const SHUTDOWN_GRACE_MS = 50_000;

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

const log = createLogger();

async function main(): Promise<void> {
  loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });
  const config = loadConfig(process.env, REPO_ROOT);
  const db = createSupabaseDb(config.supabaseUrl, config.supabaseServiceRoleKey);
  const adapter = createAdapter(config);
  const stop = new AbortController();
  const running = new Map<string, Date>();
  const halt = createHalt();
  const now = () => new Date();
  const alert = createAlerter({ healthcheckUrl: config.healthcheckUrl, ntfyTopicUrl: config.ntfyTopicUrl, log });
  const pipeline: PipelineDeps = { db, adapter, config, log, alert, stopSignal: stop.signal, now, halt };

  await startupChecks({ db, adapter, config, log, runProbe });
  await recoverOrphans({ db, config, log, alert, running, now, resume: (card: Card) => resumeMerged(card, pipeline) });
  const tasks = startScheduler(config.schedulerEnabled, log);
  log.info('main', 'dispatcher started', { mode: config.agentMode, tickMs: config.tickMs, repo: config.githubRepo, worktrees: config.worktreeRoot });

  const onSignal = (signal: string) => {
    if (stop.signal.aborted) return;
    log.warn('main', `${signal} received; stopping`);
    stop.abort('dispatcher stopping');
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  const deps = {
    db,
    mode: adapter.mode,
    boardSessionTtlMin: config.boardSessionTtlMin,
    maxConcurrency: config.maxConcurrency,
    running,
    stuckAfterMs: stuckAfterMs(config.sessionMaxMinutes),
    halt,
    now,
    log,
    alert,
    runCard: (card: Card) => runCardPipeline(card, pipeline),
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

  await stopScheduler(tasks);
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while (running.size > 0 && Date.now() < deadline) {
    await sleep(500);
  }
  log.info('main', 'dispatcher stopped', { unfinished: running.size });
}

main().catch((error: unknown) => {
  const exitCode = exitCodeFor(error);
  log.error('main', 'dispatcher exited with an error', { error: errorMessage(error), exitCode, restart: exitCode !== EXIT_FATAL });
  process.exit(exitCode);
});
