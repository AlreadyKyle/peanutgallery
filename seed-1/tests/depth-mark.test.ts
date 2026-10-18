import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { depthMark, formatDepth, isNewMechanic } from '../bots/depth';
import { runBot } from '../bots/report';
import type { SimConfig } from '../sim';
import { FIXTURE_CONFIG_DIR, LIVE_CONFIG_DIR } from './paths';

// The depth mark (bots/depth.ts): when a run last met a new mechanic, and how many multiplier-only
// unlocks came after it. The bot and the playtest report it; nothing fails on it.

const live = loadConfigFromDir(LIVE_CONFIG_DIR);
const fixture = loadConfigFromDir(FIXTURE_CONFIG_DIR);

function row(config: SimConfig, id: string) {
  const found = config.unlocks.unlocks.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no unlock ${id}`);
  return found;
}

describe('isNewMechanic', () => {
  it('counts units, the weather, gems and forks, and not multipliers or bigger strikes', () => {
    expect(isNewMechanic(row(live, 'cart'), live)).toBe(true);
    expect(isNewMechanic(row(live, 'weather-vane'), live)).toBe(true);
    expect(isNewMechanic(row(live, 'pressing-stone'), live)).toBe(true);
    expect(isNewMechanic(row(live, 'iron-broom'), live)).toBe(true);
    expect(isNewMechanic(row(live, 'sturdy-broom'), live)).toBe(false);
    expect(isNewMechanic(row(live, 'wider-paths'), live)).toBe(false);
  });

  it('counts the unlock that opens orders or dust devils whatever its effect', () => {
    const orders = live.unlocks.orders!;
    const moved: SimConfig = { ...live, unlocks: { ...live.unlocks, orders: { ...orders, opensAt: 'wider-paths' } } };
    expect(isNewMechanic(row(moved, 'wider-paths'), moved)).toBe(true);
  });
});

describe('depthMark', () => {
  it('finds the last new mechanic and counts the multiplier-only unlocks after it', () => {
    const mark = depthMark(fixture, [
      { id: 'cart', atSeconds: 10 },
      { id: 'mill', atSeconds: 20 },
      { id: 'sharper-tools', atSeconds: 30 },
      { id: 'wider-paths', atSeconds: 50 },
    ]);
    expect(mark).toEqual({ lastNewMechanic: { id: 'mill', atSeconds: 20 }, multipliersAfter: 2, newMechanicsNotReached: 2 });
  });

  it('counts only the first opening of each unlock, so a later season adds nothing new', () => {
    const mark = depthMark(fixture, [
      { id: 'cart', atSeconds: 10 },
      { id: 'sharper-tools', atSeconds: 30 },
      { id: 'cart', atSeconds: 400 },
    ]);
    expect(mark.lastNewMechanic).toEqual({ id: 'cart', atSeconds: 10 });
    expect(mark.multipliersAfter).toBe(1);
  });

  it('reports no new mechanic for a run that opened none', () => {
    expect(depthMark(fixture, [])).toEqual({ lastNewMechanic: null, multipliersAfter: 0, newMechanicsNotReached: 4 });
  });

  it('is in the bot report: on the fixture the foundry is the last new mechanic', () => {
    const report = runBot(fixture, { configDir: FIXTURE_CONFIG_DIR, hours: 2, seed: 20260914, realSeconds: null, json: true });
    const foundry = report.unlocks.findIndex((event) => event.id === 'foundry');
    expect(foundry).toBeGreaterThanOrEqual(0);
    expect(report.depth.lastNewMechanic).toEqual(report.unlocks[foundry]);
    expect(report.depth.multipliersAfter).toBe(report.unlocks.length - foundry - 1);
    expect(report.depth.newMechanicsNotReached).toBe(0);
  });
});

describe('formatDepth', () => {
  it('reads as one line in minutes and seconds', () => {
    expect(formatDepth({ lastNewMechanic: { id: 'golden-broom', atSeconds: 23527 }, multipliersAfter: 3, newMechanicsNotReached: 0 })).toBe(
      'golden-broom at 392.1 min (23527 s), then 3 multiplier-only unlocks',
    );
    expect(formatDepth({ lastNewMechanic: { id: 'mill', atSeconds: 60 }, multipliersAfter: 1, newMechanicsNotReached: 2 })).toBe(
      'mill at 1 min (60 s), then 1 multiplier-only unlock; 2 new mechanics not reached',
    );
    expect(formatDepth({ lastNewMechanic: null, multipliersAfter: 0, newMechanicsNotReached: 4 })).toBe('none, then 0 multiplier-only unlocks; 4 new mechanics not reached');
  });
});
