// The "next goal" the HUD shows and the unlock list the shop panel shows, Three-free and DOM-free
// (tests/goals.test.ts). The goal bar runs from the last unlock reached to the next one, so it moves
// visibly at every stage of a run instead of crawling along one bar from zero.
import { isUnlocked, nextLockedUnlock } from '../sim/sim';
import type { SimConfig, SimState, UnlockRow } from '../sim/types';

export interface Goal {
  row: UnlockRow;
  /** The lifetime dust the bar starts from: the threshold of the last unlock passed, or 0. */
  from: number;
  /** 0 to 1 along the bar. */
  progress: number;
  /** Lifetime dust still to earn. */
  remaining: number;
}

export function nextGoal(state: SimState, config: SimConfig): Goal | null {
  const row = nextLockedUnlock(state, config);
  if (row === null) return null;
  let from = 0;
  for (const other of config.unlocks.unlocks) {
    if (other.atTotalDust < row.atTotalDust && other.atTotalDust > from && isUnlocked(state, other.id)) from = other.atTotalDust;
  }
  const span = row.atTotalDust - from;
  const progress = span <= 0 ? 1 : Math.min(1, Math.max(0, (state.totalDust - from) / span));
  return { row, from, progress, remaining: Math.max(0, row.atTotalDust - state.totalDust) };
}

/** How many upcoming unlocks the list shows below the earned count. */
export const UPCOMING_UNLOCKS = 3;

export interface UnlockSummary {
  earned: number;
  total: number;
  upcoming: UnlockRow[];
}

/** Earned unlocks collapse to one count; the next few unearned ones are listed, so the list fits at any count. */
export function unlockSummary(rows: readonly UnlockRow[], earnedIds: ReadonlySet<string>, upcoming = UPCOMING_UNLOCKS): UnlockSummary {
  return {
    earned: rows.filter((row) => earnedIds.has(row.id)).length,
    total: rows.length,
    upcoming: rows.filter((row) => !earnedIds.has(row.id)).slice(0, upcoming),
  };
}
