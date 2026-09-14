// Dispatcher entry: loads .env from the repository root, validates configuration, checks that
// the database agrees on the agent mode, probes the account in unattended mode, recovers cards
// left mid-flight by a previous process, starts the scheduler, and runs the tick loop until
// SIGINT or SIGTERM.
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { createAdapter } from './adapters/factory.js';
import { loadConfig, type DispatcherConfig } from './config.js';
import { createSupabaseDb, type Card, type Db } from './db.js';
import { createLogger, errorMessage, type Logger } from './log.js';
import { runCardPipeline } from './pipeline.js';
import { runProbe } from './probe-core.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { startupChecks } from './startup.js';
import { tick } from './tick.js';
import { sleep } from './time.js';
import { removeWorktree, worktreePath } from './worktree.js';

const SHUTDOWN_GRACE_MS = 30_000;

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

const log = createLogger();

// A card still building or gated when this process starts belonged to a process that is gone;
// it is paused so the board can re-fund it rather than left reserving budget forever. Its
// worktree is pruned; the remote branch and any open pull request stay as they are and are
// named in the event so the board can see them (the next claim force-pushes the same branch).
async function recoverOrphans(db: Db, config: DispatcherConfig, logger: Logger): Promise<void> {
  const orphans = await db.listCardsInStages(['building', 'gated']);
  for (const card of orphans) {
    const actual = await db.sumLedger(card.id);
    await removeWorktree(config.repoRoot, worktreePath(config.worktreeRoot, card.id), card.branch).catch((error: unknown) =>
      logger.warn('main', 'worktree removal failed', { card: card.id, error: errorMessage(error) }),
    );
    await db.updateCard(card.id, { stage: 'paused', failing_check: 'dispatcher_restart', actual_usd: actual });
    await db.insertEvent(card.id, card.executor_role_id, 'error', {
      step: 'dispatcher_restart',
      previous_stage: card.stage,
      branch: card.branch,
      message: card.branch
        ? `the card was ${card.stage} when the dispatcher restarted; branch ${card.branch} and its pull request are left open`
        : `the card was ${card.stage} when the dispatcher restarted`,
    });
    logger.warn('main', `card ${card.id} was ${card.stage} at startup; paused`, { title: card.title, branch: card.branch });
  }
}

async function main(): Promise<void> {
  loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });
  const config = loadConfig(process.env, REPO_ROOT);
  const db = createSupabaseDb(config.supabaseUrl, config.supabaseServiceRoleKey);
  const adapter = createAdapter(config);
  const stop = new AbortController();
  const running = new Set<string>();
  const now = () => new Date();

  await startupChecks({ db, adapter, config, log, runProbe });
  await recoverOrphans(db, config, log);
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
    now,
    log,
    runCard: (card: Card) => runCardPipeline(card, { db, adapter, config, log, stopSignal: stop.signal, now }),
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
  await db.setPaused(true, 'dispatcher', now());
  log.info('main', 'dispatcher stopped; studio paused', { unfinished: running.size });
}

main().catch((error: unknown) => {
  log.error('main', 'dispatcher exited with an error', { error: errorMessage(error) });
  process.exit(1);
});
