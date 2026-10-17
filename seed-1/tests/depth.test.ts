import { describe, expect, it } from 'vitest';
import {
  apply,
  canBuyPerk,
  canPress,
  checkInvariants,
  costOf,
  createRunLog,
  createSim,
  currentWeather,
  dustForNextGem,
  gemBonus,
  gemsForPress,
  gemsOpen,
  hashState,
  milestoneFactor,
  milestoneTier,
  nextMilestone,
  parseConfig,
  parseSavedState,
  ratePerSecond,
  recordTick,
  serializeState,
  step,
  strikeMultiplier,
  unitRate,
} from '../sim';
import type { SimConfig, SimState } from '../sim';
import { loadConfigFromDir } from '../bots/config';
import { chooseBuy, greedyTick } from '../bots/greedy';
import { FIXTURE_CONFIG_DIR, LIVE_CONFIG_DIR } from './paths';

// The layers after the units (docs/specs/final-state.md, Games; seed-1/CLAUDE.md, Rules of the sim):
// milestones, strike unlocks, weather, and pressing the pile into gems with perks. They live in the
// live config only; the frozen fixture has none of them, which is why the pinned timeline holds.

const live = loadConfigFromDir(LIVE_CONFIG_DIR);
const fixture = loadConfigFromDir(FIXTURE_CONFIG_DIR);

function unlockedAll(config: SimConfig, state: SimState, upTo: number): SimState {
  return {
    ...state,
    unlocked: config.unlocks.unlocks.filter((row) => row.atTotalDust <= upTo).map((row) => ({ id: row.id, atSeconds: 0 })),
    totalDust: Math.max(state.totalDust, upTo),
  };
}

describe('the frozen fixture has no layers', () => {
  it('parses without milestones, weather or gems, and never grows the new fields', () => {
    expect(fixture.spawnTable.milestones).toBeUndefined();
    expect(fixture.unlocks.weather).toBeUndefined();
    expect(fixture.unlocks.gems).toBeUndefined();
    let state = createSim(fixture, 3);
    for (let i = 0; i < 4000; i += 1) state = apply(greedyTick(state, fixture), fixture, { type: 'strike' });
    expect(Object.keys(state).sort()).toEqual(['dust', 'elapsedSeconds', 'owned', 'rngState', 'seed', 'totalDust', 'unlocked']);
    expect(apply(state, fixture, { type: 'press' })).toBe(state);
    expect(apply(state, fixture, { type: 'perk', perk: 'strong-arms' })).toBe(state);
  });
});

describe('milestones', () => {
  it('doubles a unit at 10, 25, 50, 75 and 100 owned', () => {
    expect(live.spawnTable.milestones).toEqual({ at: [10, 25, 50, 75, 100], factor: 2 });
    expect([0, 9, 10, 24, 25, 99, 100, 500].map((n) => milestoneTier(live, n))).toEqual([0, 0, 1, 1, 2, 4, 5, 5]);
    expect(milestoneFactor(live, 25)).toBe(4);
    expect(nextMilestone(live, 0)).toBe(10);
    expect(nextMilestone(live, 10)).toBe(25);
    expect(nextMilestone(live, 100)).toBeNull();
    expect(nextMilestone(fixture, 3)).toBeNull();
  });

  it('raises production by the unit, not the whole', () => {
    const start = createSim(live, 1);
    const nine = { ...start, owned: { ...start.owned, gatherer: 9 } };
    const ten = { ...start, owned: { ...start.owned, gatherer: 10 } };
    expect(ratePerSecond(nine, live)).toBeCloseTo(1 + 9 * 0.25);
    expect(ratePerSecond(ten, live)).toBeCloseTo(1 + 10 * 0.25 * 2);
    expect(unitRate(ten, live, 'gatherer')).toBe(0.5);
    expect(unitRate(ten, live, 'cart')).toBe(1.5);
  });

  it('rejects a milestone table that does not rise', () => {
    const spawn = { rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 1 }], milestones: { at: [10, 10], factor: 2 } };
    expect(() => parseConfig(spawn, { unlocks: [] as unknown[] })).toThrow();
    expect(() => parseConfig({ ...spawn, milestones: { at: [10, 20], factor: 2 } }, { unlocks: [{ id: 'x', name: 'X', atTotalDust: 5, effect: { type: 'multiplier', value: 1.1 } }] })).not.toThrow();
  });
});

describe('strike unlocks', () => {
  it('opens the sturdy broom before the cart, and it doubles every strike', () => {
    expect(live.unlocks.unlocks[0]).toMatchObject({ id: 'sturdy-broom', effect: { type: 'strike', value: 2 } });
    const start = createSim(live, 9);
    const broom = unlockedAll(live, start, 40);
    expect(strikeMultiplier(start, live)).toBe(1);
    expect(strikeMultiplier(broom, live)).toBe(2);
    const plain = apply(start, live, { type: 'strike' });
    const strong = apply({ ...broom, totalDust: 0 }, live, { type: 'strike' });
    expect(strong.dust).toBeCloseTo(plain.dust * 2);
  });
});

describe('the first minute', () => {
  it('reaches a first unlock within 30 seconds even without a strike, and the cart within 70', () => {
    let state = createSim(live, 5);
    for (let i = 0; i < 70; i += 1) state = greedyTick(state, live);
    const at = Object.fromEntries(state.unlocked.map((event) => [event.id, event.atSeconds]));
    expect(at['sturdy-broom']).toBeLessThanOrEqual(32);
    expect(at['cart']).toBeLessThanOrEqual(70);
  });

  it('a player striking once a second sees two unlocks within 30 seconds and the weather within two minutes', () => {
    let state = createSim(live, 5);
    for (let t = 1; t <= 120; t += 1) {
      state = apply(step(state, live, 1), live, { type: 'strike' });
      const unit = chooseBuy(state, live);
      if (unit !== null) state = apply(state, live, { type: 'buy', unit });
    }
    const at = Object.fromEntries(state.unlocked.map((event) => [event.id, event.atSeconds]));
    expect(at['sturdy-broom']).toBeLessThan(30);
    expect(at['cart']).toBeLessThan(30);
    expect(at['weather-vane']).toBeLessThan(120);
  });
});

describe('weather', () => {
  const vane = live.unlocks.unlocks.find((row) => row.effect.type === 'weather')!;

  function withWeather(seed: number): SimState {
    // Lifetime dust just below the vane: the next second opens it.
    return step({ ...createSim(live, seed), totalDust: vane.atTotalDust - 0.5, unlocked: [] }, live, 1);
  }

  it('starts at its unlock, first spell a fixed while later on a whole second', () => {
    const state = withWeather(4);
    expect(state.weather).toEqual({ kind: null, until: 0, next: 1 + live.unlocks.weather!.firstAfter });
  });

  it('turns from clear skies to a weighted spell and back, on the seeded generator', () => {
    let state = withWeather(4);
    const seen = new Set<string>();
    let changes = 0;
    let last = state.weather!.kind;
    for (let i = 0; i < 6 * 3600; i += 1) {
      state = step(state, live, 1);
      const kind = state.weather!.kind;
      if (kind !== last) {
        changes += 1;
        last = kind;
        if (kind !== null) seen.add(kind);
        // A change always lands on a whole second.
        expect(Number.isInteger(state.elapsedSeconds)).toBe(true);
      }
    }
    expect(changes).toBeGreaterThan(100);
    expect([...seen].sort()).toEqual(live.unlocks.weather!.kinds.map((kind) => kind.id).sort());
  });

  it('lands on the same state whether stepped a second at a time or in one long step', () => {
    const start = withWeather(11);
    let small = start;
    for (let i = 0; i < 1800; i += 1) small = step(small, live, 1);
    const big = step(start, live, 1800);
    expect(big.weather).toEqual(small.weather);
    expect(big.rngState).toBe(small.rngState);
    expect(big.elapsedSeconds).toBe(small.elapsedSeconds);
    expect(big.totalDust / small.totalDust).toBeCloseTo(1, 9);
  });

  it('credits eight hours away in one step with every change of weather in between', () => {
    const state = step(withWeather(2), live, 8 * 3600);
    expect(state.elapsedSeconds).toBe(1 + 8 * 3600);
    expect(Number.isFinite(state.totalDust)).toBe(true);
  });

  it('multiplies what it names while it lasts', () => {
    const base = { ...withWeather(1), owned: { gatherer: 4, cart: 0, mill: 2, forge: 1, foundry: 0 } };
    const clear = ratePerSecond({ ...base, weather: { kind: null, until: 0, next: 999 } }, live);
    const rain = { ...base, weather: { kind: 'rain', until: 999, next: 0 } };
    expect(currentWeather(rain, live)?.name).toBe('Rain');
    expect(unitRate(rain, live, 'mill')).toBe(12 * 4);
    expect(unitRate(rain, live, 'gatherer')).toBe(0.25 * 0.5);
    const breeze = { ...base, weather: { kind: 'breeze', until: 999, next: 0 } };
    expect(ratePerSecond(breeze, live)).toBeCloseTo(clear * 1.5);
    const star = { ...base, weather: { kind: 'shooting-star', until: 999, next: 0 } };
    expect(strikeMultiplier(star, live) / strikeMultiplier(base, live)).toBe(5);
  });

  it('rejects a weather table without its unlock, and an unlock without the table', () => {
    const spawn = { rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 1 }] };
    const weather = { firstAfter: 5, gapMin: 10, gapMax: 20, kinds: [{ id: 'sun', name: 'Sun', seconds: 10, weight: 1, all: 2 }] };
    expect(() => parseConfig(spawn, { unlocks: [{ id: 'a', name: 'A', atTotalDust: 5, effect: { type: 'multiplier', value: 1.1 } }], weather })).toThrow('needs an unlock');
    expect(() => parseConfig(spawn, { unlocks: [{ id: 'v', name: 'V', atTotalDust: 5, effect: { type: 'weather' } }] })).toThrow('no "weather" table');
    expect(() => parseConfig(spawn, { unlocks: [{ id: 'v', name: 'V', atTotalDust: 5, effect: { type: 'weather' } }], weather: { ...weather, gapMin: 0 } })).toThrow('"gapMin"');
  });
});

describe('gems and perks', () => {
  const stone = live.unlocks.unlocks.find((row) => row.effect.type === 'gems')!;

  function ready(total: number): SimState {
    const state = unlockedAll(live, createSim(live, 21), total);
    return { ...state, dust: total, owned: { gatherer: 30, cart: 20, mill: 10, forge: 5, foundry: 2 } };
  }

  it('opens at the pressing stone and gives floor(cbrt(total / dustPerGem)) gems', () => {
    expect(gemsOpen(ready(stone.atTotalDust - 1), live)).toBe(false);
    expect(gemsOpen(ready(stone.atTotalDust), live)).toBe(true);
    expect(gemsForPress(ready(1_000_000), live)).toBe(2);
    expect(gemsForPress(ready(125_000_000), live)).toBe(10);
    expect(gemsForPress(ready(124_000_000), live)).toBe(9);
    expect(dustForNextGem(ready(1_000_000), live)).toBe(27 * 125_000);
    expect(canPress(ready(stone.atTotalDust - 1), live)).toBe(false);
  });

  it('pressing starts a new season: dust, units, unlocks and weather go; gems and the clock stay', () => {
    const before = { ...ready(4_000_000), weather: { kind: 'rain', until: 50, next: 0 }, elapsedSeconds: 40 };
    const after = apply(before, live, { type: 'press' });
    expect(after.dust).toBe(0);
    expect(after.totalDust).toBe(0);
    expect(Object.values(after.owned).every((n) => n === 0)).toBe(true);
    expect(after.unlocked).toEqual([]);
    expect(after.weather).toBeUndefined();
    expect(after.gems).toBe(3);
    expect(after.season).toBe(1);
    expect(after.pastDust).toBe(4_000_000);
    expect(after.elapsedSeconds).toBe(40);
    expect(after.rngState).toBe(before.rngState);
    // The gem layer stays open in the new season, though its unlock has not been reached again.
    expect(gemsOpen(after, live)).toBe(true);
    expect(canPress(after, live)).toBe(false);
    expect(apply(after, live, { type: 'press' })).toBe(after);
  });

  it('every unspent gem adds ten percent to production', () => {
    const season = apply(ready(4_000_000), live, { type: 'press' });
    expect(gemBonus(season, live)).toBeCloseTo(1.3);
    expect(ratePerSecond(season, live)).toBeCloseTo(1.3);
  });

  it('perks cost gems, are bought once and change the next seasons', () => {
    let state = apply(ready(125_000_000), live, { type: 'press' });
    expect(state.gems).toBe(10);
    expect(canBuyPerk(state, live, 'golden-pile')).toBe(true);
    state = apply(state, live, { type: 'perk', perk: 'strong-arms' });
    state = apply(state, live, { type: 'perk', perk: 'head-start' });
    state = apply(state, live, { type: 'perk', perk: 'thrift' });
    expect(state.gems).toBe(3);
    expect(state.perks).toEqual(['strong-arms', 'head-start', 'thrift']);
    expect(apply(state, live, { type: 'perk', perk: 'strong-arms' })).toBe(state);
    expect(apply(state, live, { type: 'perk', perk: 'golden-pile' })).toBe(state);
    expect(apply(state, live, { type: 'perk', perk: 'no-such-perk' })).toBe(state);
    expect(strikeMultiplier(state, live)).toBe(3);
    expect(costOf(state, live, 'cart')).toBe(Math.round(120 * 0.8));
    // Head start: the next season opens with ten gatherers, already past their first milestone.
    const next = apply({ ...unlockedAll(live, state, 1_000_000), dust: 1 }, live, { type: 'press' });
    expect(next.owned['gatherer']).toBe(10);
    expect(next.perks).toEqual(['strong-arms', 'head-start', 'thrift']);
    expect(next.season).toBe(2);
  });

  it('weather wise makes each spell last twice as long', () => {
    let state = apply(ready(4_000_000), live, { type: 'press' });
    state = apply(state, live, { type: 'perk', perk: 'weather-wise' });
    const clear = { ...state, weather: { kind: null, until: 0, next: state.elapsedSeconds + 1 } };
    const turned = step(clear, live, 1);
    const kind = live.unlocks.weather!.kinds.find((k) => k.id === turned.weather!.kind)!;
    expect(turned.weather!.until - (state.elapsedSeconds + 1)).toBe(kind.seconds * 2);
  });
});

describe('saves and seeds carry the layers', () => {
  it('round-trips a state with weather, gems, perks and seasons', () => {
    let state = apply({ ...unlockedAll(live, createSim(live, 3), 4_000_000), dust: 5 }, live, { type: 'press' });
    state = apply(state, live, { type: 'perk', perk: 'strong-arms' });
    state = { ...state, weather: { kind: 'breeze', until: 120, next: 0 } };
    expect(parseSavedState(serializeState(state))).toEqual(state);
  });

  it('refuses a save whose layers the sim could not reach', () => {
    const base = createSim(live, 3);
    const bad = (extra: Record<string, unknown>): SimState | null => parseSavedState(JSON.stringify({ version: 1, state: { ...base, ...extra } }));
    expect(bad({ gems: -1 })).toBeNull();
    expect(bad({ gems: 1.5 })).toBeNull();
    expect(bad({ season: 'two' })).toBeNull();
    expect(bad({ pastDust: -5 })).toBeNull();
    expect(bad({ perks: [3] })).toBeNull();
    expect(bad({ weather: { kind: 4, until: 1, next: 1 } })).toBeNull();
    expect(bad({ weather: { kind: null, until: 0, next: Number.NaN } })).toBeNull();
    expect(bad({ perks: ['strong-arms', 'strong-arms'] })?.perks).toEqual(['strong-arms']);
  });

  it('loads a save from before the layers unchanged', () => {
    const old = createSim(fixture, 1);
    expect(parseSavedState(JSON.stringify({ version: 1, state: old }))).toEqual(old);
  });
});

// A player bot for the layers: it strikes twice a second, buys like the greedy bot, presses the pile
// when the press would at least double its gems, and spends gems on the cheapest perk it lacks. The
// kernel bot (bots/greedy.ts) never presses, so this is where seasons get played end to end.
function seasonBot(config: SimConfig, seed: number, seconds: number): { state: SimState; seasons: number; log: ReturnType<typeof createRunLog> } {
  let state = createSim(config, seed);
  const log = createRunLog(seconds / 3600);
  let seasons = 0;
  for (let t = 1; t <= seconds; t += 1) {
    state = step(state, config, 1);
    state = apply(apply(state, config, { type: 'strike' }), config, { type: 'strike' });
    const unit = chooseBuy(state, config);
    if (unit !== null) state = apply(state, config, { type: 'buy', unit });
    if (canPress(state, config) && gemsForPress(state, config) >= Math.max(2, state.gems ?? 0)) {
      state = apply(state, config, { type: 'press' });
      seasons += 1;
    }
    const perk = config.unlocks.gems!.perks.filter((row) => canBuyPerk(state, config, row.id)).sort((a, b) => a.cost - b.cost)[0];
    if (perk !== undefined) state = apply(state, config, { type: 'perk', perk: perk.id });
    recordTick(log, state);
  }
  return { state, seasons, log };
}

describe('seasons played end to end', () => {
  const hours = 6;
  const first = seasonBot(live, 20260914, hours * 3600);
  const again = seasonBot(live, 20260914, hours * 3600);

  it('presses several times and buys perks', () => {
    expect(first.seasons).toBeGreaterThanOrEqual(3);
    expect(first.state.perks?.length).toBeGreaterThanOrEqual(3);
    expect(first.state.season).toBe(first.seasons);
  });

  it('never goes negative or non-finite, and replays to the same hash', () => {
    first.log.stateHash = hashState(first.state);
    first.log.repeatStateHash = hashState(again.state);
    const results = Object.fromEntries(checkInvariants(first.log).map((result) => [result.name, result.ok]));
    expect(results['no-negative-resource']).toBe(true);
    expect(results['finite-state']).toBe(true);
    expect(results['deterministic-hash']).toBe(true);
  });

  it('a pressed run outgrows one that never presses', () => {
    let idle = createSim(live, 20260914);
    for (let t = 1; t <= hours * 3600; t += 1) {
      idle = apply(apply(step(idle, live, 1), live, { type: 'strike' }), live, { type: 'strike' });
      const unit = chooseBuy(idle, live);
      if (unit !== null) idle = apply(idle, live, { type: 'buy', unit });
    }
    expect(ratePerSecond(first.state, live)).toBeGreaterThan(ratePerSecond(idle, live));
  });
});
