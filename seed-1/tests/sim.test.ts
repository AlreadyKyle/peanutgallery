import { describe, expect, it } from 'vitest';
import {
  BASE_RATE,
  COST_GROWTH,
  apply,
  availableUnits,
  costOf,
  createSim,
  hashState,
  nextLockedUnlock,
  parseConfig,
  parseSpawnTable,
  parseUnlockTable,
  ratePerSecond,
  step,
  strikeYield,
} from '../sim';
import type { SimConfig, SimState } from '../sim';
import { loadConfigFromDir } from '../bots/config';
import { FIXTURE_CONFIG_DIR } from './paths';

const config = loadConfigFromDir(FIXTURE_CONFIG_DIR);

function withDust(state: SimState, dust: number): SimState {
  return { ...state, dust, totalDust: Math.max(state.totalDust, dust) };
}

function play(seed: number, strikes: number): SimState {
  let state = createSim(config, seed);
  for (let i = 0; i < strikes; i += 1) state = apply(step(state, config), config, { type: 'strike' });
  return state;
}

describe('determinism', () => {
  it('produces the same hash for the same seed and inputs', () => {
    expect(hashState(play(20260914, 50))).toBe(hashState(play(20260914, 50)));
  });

  it('produces different strike totals for different seeds', () => {
    expect(hashState(play(1, 50))).not.toBe(hashState(play(2, 50)));
  });

  it('hashes independently of key order', () => {
    const a = createSim(config, 7);
    const b: SimState = { unlocked: a.unlocked, owned: a.owned, totalDust: a.totalDust, dust: a.dust, elapsedSeconds: a.elapsedSeconds, rngState: a.rngState, seed: a.seed };
    expect(hashState(b)).toBe(hashState(a));
  });
});

describe('cost math', () => {
  it('starts at the base cost and grows by 1.25 per unit owned, rounded', () => {
    const start = createSim(config, 1);
    expect(costOf(start, config, 'gatherer')).toBe(10);
    expect(costOf({ ...start, owned: { ...start.owned, gatherer: 1 } }, config, 'gatherer')).toBe(Math.round(10 * 1.25));
    expect(costOf({ ...start, owned: { ...start.owned, gatherer: 3 } }, config, 'gatherer')).toBe(Math.round(10 * COST_GROWTH ** 3));
    expect(costOf({ ...start, owned: { ...start.owned, cart: 10 } }, config, 'cart')).toBe(Math.round(150 * COST_GROWTH ** 10));
  });

  it('throws for a unit that is not in the spawn table', () => {
    expect(() => costOf(createSim(config, 1), config, 'kiln')).toThrow('Unknown unit "kiln"');
  });
});

describe('rate math', () => {
  it('is the base rate plus rate times owned for every unit', () => {
    const start = createSim(config, 1);
    expect(ratePerSecond(start, config)).toBe(BASE_RATE);
    const owned = { ...start.owned, gatherer: 4, cart: 2 };
    expect(ratePerSecond({ ...start, owned }, config)).toBeCloseTo(1 + 4 * 0.2 + 2 * 1.5, 10);
  });

  it('multiplies by every unlocked multiplier', () => {
    const start = createSim(config, 1);
    const unlocked = [
      { id: 'sharper-tools', atSeconds: 0 },
      { id: 'wider-paths', atSeconds: 0 },
      { id: 'cart', atSeconds: 0 },
    ];
    expect(ratePerSecond({ ...start, unlocked }, config)).toBeCloseTo(BASE_RATE * 1.05 * 1.05, 10);
  });

  it('adds one second of production per step by default', () => {
    const start = createSim(config, 1);
    const next = step(start, config);
    expect(next.dust).toBe(BASE_RATE);
    expect(next.totalDust).toBe(BASE_RATE);
    expect(next.elapsedSeconds).toBe(1);
    expect(step(start, config, 0.25).dust).toBeCloseTo(BASE_RATE * 0.25, 10);
  });
});

describe('availability and unlocks', () => {
  it('offers only the gatherer at the start', () => {
    expect(availableUnits(createSim(config, 1), config).map((row) => row.id)).toEqual(['gatherer']);
  });

  it('opens the cart once lifetime dust reaches 100', () => {
    const state = step(withDust(createSim(config, 1), 99), config);
    expect(state.unlocked.map((event) => event.id)).toEqual(['cart']);
    expect(state.unlocked[0]?.atSeconds).toBe(1);
    expect(availableUnits(state, config).map((row) => row.id)).toEqual(['gatherer', 'cart']);
  });

  it('opens several unlocks in one step when a strike jumps past them', () => {
    const state = step(withDust(createSim(config, 1), 12000), config);
    expect(state.unlocked.map((event) => event.id)).toEqual(['cart', 'mill', 'forge']);
  });
});

describe('actions', () => {
  it('buys a unit when affordable and leaves the state alone otherwise', () => {
    const start = withDust(createSim(config, 1), 12);
    const bought = apply(start, config, { type: 'buy', unit: 'gatherer' });
    expect(bought.dust).toBe(2);
    expect(bought.owned['gatherer']).toBe(1);
    expect(apply(bought, config, { type: 'buy', unit: 'gatherer' })).toBe(bought);
  });

  it('refuses a locked or unknown unit', () => {
    const rich = withDust(createSim(config, 1), 1000);
    expect(apply(rich, config, { type: 'buy', unit: 'mill' })).toBe(rich);
    expect(apply(rich, config, { type: 'buy', unit: 'kiln' })).toBe(rich);
  });

  it('never spends more than it holds', () => {
    const start = withDust(createSim(config, 1), 10);
    const bought = apply(start, config, { type: 'buy', unit: 'gatherer' });
    expect(bought.dust).toBe(0);
    expect(bought.dust).toBeGreaterThanOrEqual(0);
  });

  it('strikes for one to two seconds of production and advances the generator', () => {
    const start = createSim(config, 1);
    const struck = apply(start, config, { type: 'strike' });
    expect(struck.rngState).not.toBe(start.rngState);
    expect(struck.dust).toBeGreaterThanOrEqual(1);
    expect(struck.dust).toBeLessThan(2);
    expect(struck.totalDust).toBe(struck.dust);
  });

  it('keeps every strike inside one to two seconds of production at a fractional rate', () => {
    const start = createSim(config, 20260914);
    let state: SimState = { ...start, owned: { ...start.owned, gatherer: 1 } };
    const rate = ratePerSecond(state, config);
    expect(rate).toBeCloseTo(1.2, 10);
    let lowest = Number.POSITIVE_INFINITY;
    let highest = 0;
    for (let i = 0; i < 2000; i += 1) {
      const roll = strikeYield(state, config);
      lowest = Math.min(lowest, roll.amount);
      highest = Math.max(highest, roll.amount);
      state = { ...state, rngState: roll.rngState };
    }
    expect(lowest).toBeGreaterThanOrEqual(rate);
    expect(highest).toBeLessThan(2 * rate);
    expect(highest - lowest).toBeGreaterThan(0.9 * rate);
  });
});

describe('fractional steps', () => {
  it('records an unlock at the fractional second it was reached', () => {
    const start = withDust(createSim(config, 1), 99.5);
    const state = step(step(start, config, 0.25), config, 0.25);
    expect(state.elapsedSeconds).toBe(0.5);
    expect(state.totalDust).toBeCloseTo(100, 10);
    expect(state.unlocked).toEqual([{ id: 'cart', atSeconds: 0.5 }]);
  });
});

describe('config parsing', () => {
  const spawn = { rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 0.2 }] };

  it('sorts unlocks by threshold whatever order the file lists them in', () => {
    const rows = config.unlocks.unlocks;
    const shuffled = [...rows.slice(6), ...rows.slice(0, 6)].reverse();
    const ascending = rows.map((row) => row.atTotalDust);
    expect(shuffled.map((row) => row.atTotalDust)).not.toEqual(ascending);
    const parsed: SimConfig = parseConfig({ rows: config.spawnTable.rows }, { unlocks: shuffled });
    expect(parsed.unlocks.unlocks.map((row) => row.atTotalDust)).toEqual(ascending);
    const start = createSim(parsed, 1);
    expect(nextLockedUnlock(start, parsed)?.id).toBe('cart');
    const later = { ...start, unlocked: [{ id: 'cart', atSeconds: 1 }, { id: 'mill', atSeconds: 2 }] };
    expect(nextLockedUnlock(later, parsed)?.id).toBe('forge');
  });

  it('rejects a missing rate', () => {
    expect(() => parseConfig({ rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10 }] }, { unlocks: [] })).toThrow('"rate"');
  });

  it('rejects an unlock that names an unknown unit', () => {
    expect(() =>
      parseConfig(spawn, { unlocks: [{ id: 'cart', name: 'Cart', atTotalDust: 100, effect: { type: 'unit', unit: 'cart' } }] }),
    ).toThrow('unknown unit "cart"');
  });

  it('rejects duplicate ids', () => {
    expect(() => parseConfig({ rows: [spawn.rows[0], spawn.rows[0]] }, { unlocks: [] })).toThrow('duplicate id');
  });

  it('rejects an empty unlock list', () => {
    expect(() => parseConfig(spawn, { unlocks: [] })).toThrow('non-empty array');
  });

  it('rejects a unit that two unlock rows gate', () => {
    const table = parseSpawnTable({ rows: [...spawn.rows, { id: 'cart', name: 'Cart', baseCost: 150, rate: 1.5 }] });
    const gate = (id: string, at: number) => ({ id, name: id, atTotalDust: at, effect: { type: 'unit', unit: 'cart' } });
    expect(() => parseUnlockTable({ unlocks: [gate('early-cart', 100), gate('late-cart', 200)] }, table)).toThrow(
      'unit "cart" is gated twice',
    );
  });

  it('rejects a multiplier below one', () => {
    expect(() =>
      parseUnlockTable({ unlocks: [{ id: 'slow', name: 'Slow', atTotalDust: 100, effect: { type: 'multiplier', value: 0.9 } }] }, parseSpawnTable(spawn)),
    ).toThrow('"value" must be a finite number of at least 1');
  });

  it('rejects an effect type it does not know', () => {
    expect(() =>
      parseUnlockTable({ unlocks: [{ id: 'odd', name: 'Odd', atTotalDust: 100, effect: { type: 'bonus', value: 2 } }] }, parseSpawnTable(spawn)),
    ).toThrow('effect type must be "unit" or "multiplier"');
  });
});
