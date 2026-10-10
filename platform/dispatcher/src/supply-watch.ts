// The card supply's alert (docs/specs/unattended-roles.md, PR4). pg_cron's enqueue_supply_draft
// queues a draft while the card supply is short of the floor, and tells no one when it cannot. So at
// most every SUPPLY_WATCH_MS the tick reads supply_draft_check(), which writes nothing: while the
// supply is short and no draft may be queued for a reason that does not clear on its own within the
// hour (the day's draft runs used, the Game Designer or the Game Director paused, the job disabled),
// the board hears once per reason per New York day. A paused studio is the board's own stop and a
// queued or running draft is the refill under way, so neither alerts; a target is always draftable,
// since a run with no backlog card to fill opens a new one. A failed read is logged and never stops
// the tick.
import type { Alerter } from './alert.js';
import type { Db } from './db.js';
import { errorMessage, type Logger } from './log.js';
import { newYorkDate } from './throttle.js';

export const SUPPLY_WATCH_MS = 20 * 60_000;

// The reasons that leave the supply short with nothing queued, and what the board can do.
export const BLOCKED: Readonly<Record<string, string>> = {
  daily_limit: "today's draft runs are used (studio_state.draft_runs_per_day); drafting resumes after New York midnight",
  role_paused: 'the Game Designer is paused; resume it to let drafting continue',
  grader_paused: 'the Game Director is paused; resume it to let drafting continue',
  job_disabled: 'the draft_card job is disabled',
};

export interface SupplyWatchState {
  lastAt: number | null;
}

export interface SupplyWatchDeps {
  db: Pick<Db, 'supplyDraftCheck'>;
  alert: Alerter;
  now: () => Date;
  log: Logger;
  state: SupplyWatchState;
}

export type SupplyWatchOutcome = { checked: false } | { checked: true; short: boolean; reason: string | null; alerted: boolean };

export async function watchSupply(deps: SupplyWatchDeps): Promise<SupplyWatchOutcome> {
  const now = deps.now();
  if (deps.state.lastAt !== null && now.getTime() - deps.state.lastAt < SUPPLY_WATCH_MS) return { checked: false };
  deps.state.lastAt = now.getTime();
  let check;
  try {
    check = await deps.db.supplyDraftCheck();
  } catch (error) {
    deps.log.warn('supply', 'supply_draft_check failed', { error: errorMessage(error) });
    return { checked: false };
  }
  const why = check.reason === null ? undefined : BLOCKED[check.reason];
  if (!check.short || why === undefined) return { checked: true, short: check.short, reason: check.reason, alerted: false };
  const shortfalls = Object.entries(check.floor)
    .filter(([key, value]) => key.startsWith('short_') && value > 0)
    .map(([key, value]) => `${value} ${key.slice('short_'.length)}`)
    .join(', ');
  await deps.alert.notifyOnce(
    `supply_blocked:${check.reason}:${newYorkDate(now)}`,
    `The card supply is short of the floor (${shortfalls || 'short'}) and no draft can be queued: ${why}.`,
  );
  return { checked: true, short: true, reason: check.reason, alerted: true };
}
