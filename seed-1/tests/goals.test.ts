import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { nextGoal, unlockSummary, UPCOMING_UNLOCKS } from '../render/goals';
import { createSim, step } from '../sim/sim';
import type { UnlockRow } from '../sim/types';
import { FIXTURE_CONFIG_DIR, LIVE_CONFIG_DIR } from './paths';

const config = loadConfigFromDir(FIXTURE_CONFIG_DIR);

function makeRows(count: number): UnlockRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: `u${i}`, name: `Unlock ${i}`, atTotalDust: (i + 1) * 1000, effect: { type: 'multiplier', value: 1.05 } }));
}

describe('nextGoal', () => {
  it('runs from zero to the first unlock at the start', () => {
    const goal = nextGoal(createSim(config, 1), config)!;
    expect(goal.row.id).toBe(config.unlocks.unlocks[0]!.id);
    expect(goal.from).toBe(0);
    expect(goal.progress).toBe(0);
    expect(goal.remaining).toBe(goal.row.atTotalDust);
  });

  it('runs from the last unlock passed to the next, and moves as dust comes in', () => {
    let state = createSim(config, 1);
    state = step(state, config, 150);
    const first = config.unlocks.unlocks[0]!;
    const goal = nextGoal(state, config)!;
    expect(goal.from).toBe(first.atTotalDust);
    expect(goal.progress).toBeGreaterThan(0);
    expect(goal.progress).toBeLessThan(1);
    const later = nextGoal(step(state, config, 100), config)!;
    expect(later.progress).toBeGreaterThan(goal.progress);
  });

  it('is null once every unlock is open', () => {
    const state = step(createSim(config, 1), config, 1e12);
    expect(nextGoal(state, config)).toBeNull();
  });
});

describe('unlockSummary', () => {
  it('collapses earned unlocks to a count and lists at most three upcoming, at any count', () => {
    const rows = makeRows(30);
    for (let earned = 0; earned <= 30; earned += 1) {
      const summary = unlockSummary(rows, new Set(rows.slice(0, earned).map((row) => row.id)));
      expect(summary.earned).toBe(earned);
      expect(summary.total).toBe(30);
      expect(summary.upcoming.length).toBe(Math.min(UPCOMING_UNLOCKS, 30 - earned));
      expect(summary.upcoming.every((row) => Number(row.id.slice(1)) >= earned)).toBe(true);
    }
  });

  it('lays out the live config the same way', () => {
    const live = loadConfigFromDir(LIVE_CONFIG_DIR).unlocks.unlocks;
    expect(unlockSummary(live, new Set()).upcoming.map((row) => row.id)).toEqual(live.slice(0, 3).map((row) => row.id));
  });
});
