// Cards a previous process left mid-flight. Every orphan's worktree is pruned; a remote branch and any
// open pull request stay as they are and are named in the event (the next claim force-pushes the same
// branch).
// - A building card is paused so the board can re-fund it rather than left reserving budget.
// - A gated card with a merge sha is already on main: its deploy and smoke test run again in the
//   background, with the pipeline's rollback (pipeline.ts resumeMerged).
// - A gated card without one may still have merged before the sha was written, so the newest pull
//   request for its branch is read. Merged: the sha is written and the card is verified. Not merged:
//   the card is paused, or rejected when its merge request was lost (merge_unknown), and nothing is
//   closed. Unreadable: the card is left gated for the board.
// The board is alerted in every case. Recovery runs only while this process holds the dispatcher
// lease (main.ts), so it never pauses a card another dispatcher is running, and each stage write names
// the stage the card was found in, so a card the board moved meanwhile is left as the board set it.
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
  // The tick's running cards; a card verified in the background counts toward concurrency, the
  // watchdog and shutdown like any other.
  running: Map<string, Date>;
  now: () => Date;
  // Verifies a merged card; pipeline.ts resumeMerged in production.
  resume: (card: Card) => Promise<void>;
  // The merge sha of a gated card with none recorded, or null when its pull request did not merge;
  // pipeline.ts findCardMerge in production.
  lookupMerge: (card: Card) => Promise<string | null>;
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
    if (card.stage === 'building') {
      await pause(deps, card);
      continue;
    }
    let sha = card.commit_sha;
    if (!sha) {
      try {
        sha = await deps.lookupMerge(card);
      } catch (error) {
        log.error('recovery', `card ${card.id}: its pull request could not be read`, { error: errorMessage(error) });
        await deps.alert.notify(
          `Card ${shortId(card.id)} was gated when the dispatcher restarted, and whether its pull request merged could not be read (${errorMessage(error)}). It is left gated for the board.`,
        );
        continue;
      }
      if (sha) await db.updateCard(card.id, { commit_sha: sha });
    }
    if (sha) {
      log.warn('recovery', `card ${card.id} was merged but not verified at startup; verifying`, { sha });
      await deps.alert.notify(`Card ${shortId(card.id)} was merged as ${sha.slice(0, 8)} but not verified when the dispatcher restarted. Its deploy and smoke test run again now.`);
      background.push(verifyInBackground(deps, { ...card, commit_sha: sha }));
      continue;
    }
    if (card.failing_check === 'merge_unknown') {
      await rejectUnmerged(deps, card);
      continue;
    }
    await pause(deps, card);
  }
  return background;
}

// The board moved the card while recovery was looking at it; it is left as the board set it.
async function moved(deps: RecoveryDeps, card: Card, to: string): Promise<void> {
  deps.log.warn('recovery', `card ${card.id} left ${card.stage} while recovery read it; not moved to ${to}`);
  await deps.alert.notify(`Card ${shortId(card.id)} changed stage while the dispatcher was recovering it, so it was not moved to ${to}.`);
}

async function pause(deps: RecoveryDeps, card: Card): Promise<void> {
  const actual = await deps.db.sumLedger(card.id);
  if (!(await deps.db.updateCardIf(card.id, [card.stage], { stage: 'paused', failing_check: 'dispatcher_restart', actual_usd: actual }))) {
    await moved(deps, card, 'paused');
    return;
  }
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

// A lost merge request whose pull request never merged. The card is rejected; the pull request is not
// closed, since GitHub's answer was lost once already and the board can see both.
async function rejectUnmerged(deps: RecoveryDeps, card: Card): Promise<void> {
  const actual = await deps.db.sumLedger(card.id);
  if (!(await deps.db.updateCardIf(card.id, ['gated'], { stage: 'rejected', failing_check: 'merge', actual_usd: actual }))) {
    await moved(deps, card, 'rejected');
    return;
  }
  await deps.db.insertEvent(card.id, card.executor_role_id, 'error', { step: 'merge_unknown_resolved', merged: false, branch: card.branch });
  deps.log.warn('recovery', `card ${card.id} had a lost merge and did not merge; rejected`, { branch: card.branch });
  await deps.alert.notify(
    `Card ${shortId(card.id)} had a lost merge request and its pull request is not merged; it is rejected. Branch ${card.branch ?? '(none)'} and its pull request are left open for the board to close or merge.`,
  );
}

// The card joins running before the verification starts and leaves it when the verification ends.
function verifyInBackground(deps: RecoveryDeps, card: Card): Promise<void> {
  deps.running.set(card.id, deps.now());
  return deps
    .resume(card)
    .catch((error: unknown) => deps.log.error('recovery', `card ${card.id} verification threw`, { error: errorMessage(error) }))
    .finally(() => {
      deps.running.delete(card.id);
      deps.alert.forget(`stuck:${card.id}`);
    });
}
