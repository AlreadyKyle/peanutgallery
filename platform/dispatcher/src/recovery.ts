// Cards a previous process left mid-flight. A card still building, or gated without a merge sha,
// belonged to a process that is gone: it is paused so the board can re-fund it rather than left
// reserving budget, and the board is alerted. A gated card with a merge sha is already on main, so
// pausing it would leave an unverified change live: its deploy and smoke test run again in the
// background, with the pipeline's rollback. Every orphan's worktree is pruned; a remote branch and
// any open pull request stay as they are and are named in the event (the next claim force-pushes
// the same branch).
import type { Alerter } from './alert.js';
import type { DispatcherConfig } from './config.js';
import type { Card, Db } from './db.js';
import { errorMessage, type Logger } from './log.js';
import { removeWorktree, shortId, worktreePath } from './worktree.js';

export interface RecoveryDeps {
  db: Db;
  config: DispatcherConfig;
  log: Logger;
  alert: Alerter;
  // The tick's running cards; a card verified in the background counts toward concurrency and
  // shutdown like any other.
  running: Map<string, Date>;
  now: () => Date;
  // Verifies a merged card; pipeline.ts resumeMerged in production.
  resume: (card: Card) => Promise<void>;
}

// Returns the background verifications so a caller can wait for them; main.ts does not.
export async function recoverOrphans(deps: RecoveryDeps): Promise<Promise<void>[]> {
  const { db, config, log } = deps;
  const orphans = await db.listCardsInStages(['building', 'gated']);
  const background: Promise<void>[] = [];
  for (const card of orphans) {
    await removeWorktree(config.repoRoot, worktreePath(config.worktreeRoot, card.id), card.branch).catch((error: unknown) =>
      log.warn('recovery', 'worktree removal failed', { card: card.id, error: errorMessage(error) }),
    );
    if (card.stage === 'gated' && card.commit_sha) {
      log.warn('recovery', `card ${card.id} was merged but not verified at startup; verifying`, { sha: card.commit_sha });
      await deps.alert.notify(
        `Card ${shortId(card.id)} was merged as ${card.commit_sha.slice(0, 8)} but not verified when the dispatcher restarted. Its deploy and smoke test run again now.`,
      );
      background.push(verifyInBackground(deps, card));
      continue;
    }
    await pause(deps, card);
  }
  return background;
}

async function pause(deps: RecoveryDeps, card: Card): Promise<void> {
  const actual = await deps.db.sumLedger(card.id);
  await deps.db.updateCard(card.id, { stage: 'paused', failing_check: 'dispatcher_restart', actual_usd: actual });
  await deps.db.insertEvent(card.id, card.executor_role_id, 'error', {
    step: 'dispatcher_restart',
    previous_stage: card.stage,
    branch: card.branch,
    message: card.branch
      ? `the card was ${card.stage} when the dispatcher restarted; branch ${card.branch} and its pull request are left open`
      : `the card was ${card.stage} when the dispatcher restarted`,
  });
  deps.log.warn('recovery', `card ${card.id} was ${card.stage} at startup; paused`, { title: card.title, branch: card.branch });
  const left = card.branch ? ` Branch ${card.branch} and any pull request are left open.` : '';
  await deps.alert.notify(`Card ${shortId(card.id)} was ${card.stage} when the dispatcher restarted and is paused.${left}`);
}

// The card joins running before the verification starts and leaves it when the verification ends.
function verifyInBackground(deps: RecoveryDeps, card: Card): Promise<void> {
  deps.running.set(card.id, deps.now());
  return deps
    .resume(card)
    .catch((error: unknown) => deps.log.error('recovery', `card ${card.id} verification threw`, { error: errorMessage(error) }))
    .finally(() => deps.running.delete(card.id));
}
