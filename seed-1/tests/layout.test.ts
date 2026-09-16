import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { layoutUnlockList, SCREEN_HEIGHT, UNLOCK_ROW_HEIGHT } from '../render/layout';
import type { UnlockRow } from '../sim/types';
import { LIVE_CONFIG_DIR } from './paths';

const LIST_TOP = 578;

function makeRows(count: number): UnlockRow[] {
  const rows: UnlockRow[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({ id: `u${i}`, name: `Unlock ${i}`, atTotalDust: (i + 1) * 1000, effect: { type: 'multiplier', value: 1.05 } });
  }
  return rows;
}

function assertLaysOutOnScreen(rows: readonly UnlockRow[], earnedIds: ReadonlySet<string>): void {
  const lines = layoutUnlockList(LIST_TOP, rows, earnedIds);
  for (const line of lines) {
    expect(line.y + UNLOCK_ROW_HEIGHT).toBeLessThanOrEqual(SCREEN_HEIGHT);
  }
  expect(lines.filter((line) => line.kind === 'earned').length).toBeLessThanOrEqual(1);
  expect(lines.filter((line) => line.kind === 'unlock').length).toBeLessThanOrEqual(3);
}

describe('layoutUnlockList', () => {
  it('fits 30 unlocks on screen at every earned count', () => {
    const rows = makeRows(30);
    for (let earnedCount = 0; earnedCount <= 30; earnedCount += 1) {
      const earnedIds = new Set(rows.slice(0, earnedCount).map((row) => row.id));
      assertLaysOutOnScreen(rows, earnedIds);
    }
  });

  it('lays out the live config the same way', () => {
    const config = loadConfigFromDir(LIVE_CONFIG_DIR);
    const rows = config.unlocks.unlocks;
    for (let earnedCount = 0; earnedCount <= rows.length; earnedCount += 1) {
      const earnedIds = new Set(rows.slice(0, earnedCount).map((row) => row.id));
      assertLaysOutOnScreen(rows, earnedIds);
    }
  });
});
