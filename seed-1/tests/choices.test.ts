import { describe, expect, it } from 'vitest';
import {
  apply,
  canFill,
  checkInvariants,
  chosenOption,
  createRunLog,
  createSim,
  devilHere,
  devilReward,
  forkOptions,
  forkProduct,
  hashState,
  orderBonus,
  orderFilled,
  orderProgress,
  orderRest,
  orderReward,
  ordersOpen,
  parseConfig,
  parseSavedState,
  pendingForks,
  ratePerSecond,
  recordTick,
  serializeState,
  step,
  strikeMultiplier,
  unitRate,
  whirling,
} from '../sim';
import type { SimConfig, SimState } from '../sim';
import { loadConfigFromDir } from '../bots/config';
import { chooseBuy, greedyTick } from '../bots/greedy';
import { FIXTURE_CONFIG_DIR, LIVE_CONFIG_DIR } from './paths';

// The three choice layers (seed-1/CLAUDE.md, Rules of the sim): forks (unlocks that ask the player to
// pick one of two), orders (a small job on the signpost that pays and adds a lasting bonus) and dust
// devils (a visitor to catch before it leaves). Like the other layers they are optional in the config
// and absent from the frozen fixture.

const live = loadConfigFromDir(LIVE_CONFIG_DIR);
const fixture = loadConfigFromDir(FIXTURE_CONFIG_DIR);
const orders = live.unlocks.orders!;
const devils = live.unlocks.devils!;

function reach(config: SimConfig, state: SimState, upTo: number): SimState {
  return {
    ...state,
    unlocked: config.unlocks.unlocks.filter((row) => row.atTotalDust <= upTo).map((row) => ({ id: row.id, atSeconds: 0 })),
    totalDust: Math.max(state.totalDust, upTo),
  };
}

const owned = { gatherer: 20, cart: 10, mill: 5, forge: 2, foundry: 1 };

describe('the frozen fixture has none of the choice layers', () => {
  it('parses without forks, orders or devils, and never grows their fields', () => {
    expect(fixture.unlocks.orders).toBeUndefined();
    expect(fixture.unlocks.devils).toBeUndefined();
    expect(fixture.unlocks.unlocks.some((row) => row.effect.type === 'fork')).toBe(false);
    let state = createSim(fixture, 5);
    for (let i = 0; i < 3000; i += 1) state = step(apply(greedyTick(state, fixture), fixture, { type: 'strike' }), fixture, 1);
    for (const key of ['chosen', 'order', 'ordersFilled', 'devil']) expect(state).not.toHaveProperty(key);
    for (const action of [{ type: 'fill' }, { type: 'swap' }, { type: 'catch' }, { type: 'choose', unlock: 'cart', option: 'x' }] as const) {
      expect(apply(state, fixture, action)).toBe(state);
    }
  });
});

describe('forks', () => {
  const forks = live.unlocks.unlocks.filter((row) => row.effect.type === 'fork');

  it('six unlocks ask the player to choose one of two', () => {
    expect(forks.map((row) => row.id)).toEqual(['iron-broom', 'sharper-tools', 'steady-hands', 'longer-days', 'deeper-veins', 'golden-broom']);
    for (const row of forks) expect(forkOptions(row)).toHaveLength(2);
    expect(forkOptions(live.unlocks.unlocks[0]!)).toBeNull();
  });

  it('waits for a choice, takes one only, and the choice changes what it names', () => {
    const state = { ...reach(live, createSim(live, 1), 600_000), owned };
    expect(pendingForks(state, live).map((row) => row.id)).toEqual(['iron-broom', 'sharper-tools']);
    const mills = apply(state, live, { type: 'choose', unlock: 'sharper-tools', option: 'millstones' });
    expect(chosenOption(mills, live, 'sharper-tools')?.name).toBe('Millstones');
    expect(pendingForks(mills, live).map((row) => row.id)).toEqual(['iron-broom']);
    expect(unitRate(mills, live, 'mill') / unitRate(state, live, 'mill')).toBeCloseTo(1.5);
    expect(unitRate(mills, live, 'forge')).toBe(unitRate(state, live, 'forge'));
    // A second choice at the same fork, an option it does not have, and a fork not reached do nothing.
    expect(apply(mills, live, { type: 'choose', unlock: 'sharper-tools', option: 'bellows' })).toBe(mills);
    expect(apply(state, live, { type: 'choose', unlock: 'iron-broom', option: 'millstones' })).toBe(state);
    expect(apply(state, live, { type: 'choose', unlock: 'steady-hands', option: 'steady-hands' })).toBe(state);
    const broom = apply(state, live, { type: 'choose', unlock: 'iron-broom', option: 'iron-broom' });
    expect(strikeMultiplier(broom, live) / strikeMultiplier(state, live)).toBeCloseTo(1.5);
    expect(forkProduct(broom, live, 'strike')).toBe(1.5);
    expect(forkProduct(broom, live, 'multiplier')).toBe(1);
  });

  it('a whole-island option raises the rate; a weather option lengthens each spell', () => {
    const state = { ...reach(live, createSim(live, 1), 30_000_000), owned };
    const steady = apply(state, live, { type: 'choose', unlock: 'steady-hands', option: 'steady-hands' });
    expect(ratePerSecond(steady, live) / ratePerSecond(state, live)).toBeCloseTo(1.2);
    // The same spell drawn with and without weather lore: the lore makes it last twice as long.
    const clear = { ...state, weather: { kind: null, until: 0, next: 10 }, elapsedSeconds: 9 };
    const lore = apply(clear, live, { type: 'choose', unlock: 'longer-days', option: 'weather-lore' });
    const plain = step(clear, live, 1).weather!;
    const longer = step(lore, live, 1).weather!;
    expect(longer.kind).toBe(plain.kind);
    expect(longer.until - 10).toBe(2 * (plain.until - 10));
  });

  it('pressing the pile starts the forks over', () => {
    const state = apply({ ...reach(live, createSim(live, 2), 4_000_000), owned }, live, { type: 'choose', unlock: 'iron-broom', option: 'oiled-axles' });
    expect(state.chosen).toEqual({ 'iron-broom': 'oiled-axles' });
    const pressed = apply(state, live, { type: 'press' });
    expect(pressed.season).toBe(1);
    expect(pressed).not.toHaveProperty('chosen');
  });

  it('rejects a fork with one option, three of the same id or an effect it does not know', () => {
    const spawn = { rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 1 }] };
    const fork = (options: unknown): unknown => ({ unlocks: [{ id: 'f', name: 'F', atTotalDust: 5, effect: { type: 'fork', options } }] });
    const a = { id: 'a', name: 'A', effect: { type: 'strike', value: 2 } };
    expect(() => parseConfig(spawn, fork([a]))).toThrow();
    expect(() => parseConfig(spawn, fork([a, a]))).toThrow();
    expect(() => parseConfig(spawn, fork([a, { id: 'b', name: 'B', effect: { type: 'teleport', value: 2 } }]))).toThrow();
    expect(() => parseConfig(spawn, fork([a, { id: 'b', name: 'B', effect: { type: 'unit', unit: 'nope', value: 2 } }]))).toThrow();
    expect(parseConfig(spawn, fork([a, { id: 'b', name: 'B', effect: { type: 'multiplier', value: 1.2 } }])).unlocks.unlocks[0]!.effect.type).toBe('fork');
  });
});

describe('orders', () => {
  function opened(seed: number): SimState {
    // Lifetime dust just below the cart: the next second opens it and draws the first order.
    return step({ ...createSim(live, seed), totalDust: 99.5 }, live, 1);
  }

  it('open with the cart and draw an order on the seeded generator', () => {
    expect(ordersOpen(createSim(live, 1), live)).toBe(false);
    const state = opened(3);
    expect(ordersOpen(state, live)).toBe(true);
    expect(state.order).toBeDefined();
    expect(['own', 'gather', 'strikes']).toContain(state.order!.type);
    expect(opened(3).order).toEqual(state.order);
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) kinds.add(opened(seed).order!.type);
    expect([...kinds].sort()).toEqual(['gather', 'own', 'strikes']);
  });

  it('an own order asks only for what the player could afford within the budget', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = { ...opened(seed), owned };
      const drawn = apply({ ...state, order: { type: 'strikes', target: 99, progress: 0 } }, live, { type: 'swap' });
      if (drawn.order!.type !== 'own') continue;
      expect(drawn.order!.target).toBeGreaterThan(owned[drawn.order!.unit as keyof typeof owned]);
    }
  });

  it('counts strikes, dust gathered and units owned', () => {
    const base = { ...opened(1), owned };
    const strikes = apply({ ...base, order: { type: 'strikes', target: 2, progress: 0 } }, live, { type: 'strike' });
    expect(orderProgress(strikes)).toEqual({ have: 1, need: 2 });
    expect(orderFilled(apply(strikes, live, { type: 'strike' }))).toBe(true);
    const gather = step({ ...base, order: { type: 'gather', target: 10_000, progress: 0 } }, live, 2);
    expect(orderProgress(gather)!.have).toBeCloseTo(gather.totalDust - base.totalDust, 6);
    const own = { ...base, order: { type: 'own' as const, unit: 'cart', target: 11 } };
    expect(orderFilled(own)).toBe(false);
    expect(orderFilled({ ...own, owned: { ...owned, cart: 11 } })).toBe(true);
  });

  it('a filled order pays, counts for good and the next one rests before it can be filled', () => {
    const base = { ...opened(1), owned, order: { type: 'strikes' as const, target: 1, progress: 1 } };
    expect(canFill(base, live)).toBe(true);
    const reward = orderReward(base, live);
    expect(reward).toBeCloseTo(orders.rewardSeconds * ratePerSecond(base, live));
    const filled = apply(base, live, { type: 'fill' });
    expect(filled.dust - base.dust).toBeCloseTo(reward);
    expect(filled.ordersFilled).toBe(1);
    expect(filled.order!.from).toBe(base.elapsedSeconds + orders.rest);
    expect(orderRest(filled)).toBe(orders.rest);
    expect(ratePerSecond(filled, live) / ratePerSecond(base, live)).toBeCloseTo(1 + orders.bonusPerOrder);
    // While it rests it cannot be filled, even when met.
    const met = { ...filled, order: { ...filled.order!, type: 'strikes' as const, target: 0, progress: 0 } };
    expect(canFill(met, live)).toBe(false);
    expect(apply(met, live, { type: 'fill' })).toBe(met);
    expect(canFill({ ...met, elapsedSeconds: met.elapsedSeconds + orders.rest }, live)).toBe(true);
  });

  it('the bonus stops at its cap and the order book triples the reward', () => {
    const base = opened(1);
    expect(orderBonus({ ...base, ordersFilled: orders.bonusCap }, live)).toBeCloseTo(1 + orders.bonusPerOrder * orders.bonusCap);
    expect(orderBonus({ ...base, ordersFilled: orders.bonusCap * 4 }, live)).toBe(orderBonus({ ...base, ordersFilled: orders.bonusCap }, live));
    const book = { ...reach(live, base, 30_000_000), owned, chosen: { 'longer-days': 'order-book' } };
    expect(orderReward(book, live) / orderReward({ ...book, chosen: {} }, live)).toBeCloseTo(3);
  });

  it('swaps an order not yet met for another, keeping its rest; a met order cannot be swapped', () => {
    const base = { ...opened(1), owned, order: { type: 'strikes' as const, target: 40, progress: 0, from: 50 } };
    const swapped = apply(base, live, { type: 'swap' });
    expect(swapped.rngState).not.toBe(base.rngState);
    expect(swapped.order!.from).toBe(50);
    const met = { ...base, order: { ...base.order, progress: 40 } };
    expect(apply(met, live, { type: 'swap' })).toBe(met);
  });

  it('pressing the pile clears the order but keeps the count filled', () => {
    const state = { ...reach(live, opened(1), 4_000_000), ordersFilled: 7 };
    const pressed = apply(state, live, { type: 'press' });
    expect(pressed).not.toHaveProperty('order');
    expect(pressed.ordersFilled).toBe(7);
  });

  it('rejects an orders table that opens at no unlock', () => {
    const spawn = { rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 1 }] };
    const rows = [{ id: 'a', name: 'A', atTotalDust: 5, effect: { type: 'multiplier', value: 1.1 } }];
    expect(() => parseConfig(spawn, { unlocks: rows, orders: { ...orders, opensAt: 'nowhere' } })).toThrow();
    expect(parseConfig(spawn, { unlocks: rows, orders: { ...orders, opensAt: 'a' } }).unlocks.orders?.opensAt).toBe('a');
  });
});

describe('dust devils', () => {
  function opened(seed: number): SimState {
    // Lifetime dust just below the mill: the next second opens it and books the first devil.
    return step({ ...createSim(live, seed), totalDust: 999.5 }, live, 1);
  }

  it('the first comes a fixed while after the mill, stays a while and leaves', () => {
    const state = opened(4);
    expect(state.devil).toEqual({ until: 0, next: 1 + devils.firstAfter, whirlUntil: 0 });
    const here = step(state, live, devils.firstAfter);
    expect(devilHere(here)).toBe(true);
    expect(here.devil!.until).toBe(1 + devils.firstAfter + devils.lasts);
    const gone = step(here, live, devils.lasts);
    expect(devilHere(gone)).toBe(false);
    const gap = gone.devil!.next - here.devil!.until;
    expect(gap).toBeGreaterThanOrEqual(devils.gapMin);
    expect(gap).toBeLessThanOrEqual(devils.gapMax);
  });

  it('catching one pays, sends it away and whirls the strikes for a while', () => {
    const here = step({ ...opened(4), owned }, live, devils.firstAfter);
    const reward = devilReward(here, live);
    expect(reward).toBeCloseTo(devils.rewardSeconds * ratePerSecond(here, live));
    const caught = apply(here, live, { type: 'catch' });
    expect(caught.dust - here.dust).toBeCloseTo(reward);
    expect(devilHere(caught)).toBe(false);
    expect(whirling(caught)).toBe(true);
    expect(strikeMultiplier(caught, live) / strikeMultiplier(here, live)).toBe(devils.whirlStrike);
    expect(caught.devil!.next - here.elapsedSeconds).toBeGreaterThanOrEqual(devils.gapMin);
    expect(whirling(step(caught, live, devils.whirlSeconds))).toBe(false);
    // Nothing to catch once it has gone.
    expect(apply(caught, live, { type: 'catch' })).toBe(caught);
    // The devil net triples the catch.
    const net = { ...reach(live, here, 200_000_000), chosen: { 'deeper-veins': 'devil-net' } };
    expect(devilReward(net, live) / devilReward({ ...net, chosen: {} }, live)).toBeCloseTo(3);
  });

  it('a long step and many short ones land on the same devils, weather and order', () => {
    // No units bought, so no unlock in the hour changes the rate between the two ways of stepping.
    const start = step({ ...createSim(live, 9), totalDust: 2499.5 }, live, 1);
    let small = start;
    for (let i = 0; i < 3600; i += 1) small = step(small, live, 1);
    const big = step(start, live, 3600);
    expect(big.devil).toEqual(small.devil);
    expect(big.weather).toEqual(small.weather);
    expect(big.order?.type).toBe(small.order?.type);
    expect(big.rngState).toBe(small.rngState);
    expect(big.totalDust / small.totalDust).toBeCloseTo(1, 9);
  });

  it('pressing the pile sends the devils away until the mill opens again', () => {
    const pressed = apply({ ...reach(live, opened(1), 4_000_000), owned }, live, { type: 'press' });
    expect(pressed).not.toHaveProperty('devil');
    expect(step(pressed, live, 1)).not.toHaveProperty('devil');
  });
});

describe('saves carry the choice layers', () => {
  it('round-trips forks chosen, the order, orders filled and the devil', () => {
    const state: SimState = {
      ...reach(live, createSim(live, 3), 600_000),
      chosen: { 'iron-broom': 'oiled-axles' },
      order: { type: 'gather', target: 900, progress: 120.5, from: 40 },
      ordersFilled: 4,
      devil: { until: 80, next: 0, whirlUntil: 12.5 },
    };
    expect(parseSavedState(serializeState(state))).toEqual(state);
    const own: SimState = { ...state, order: { type: 'own', unit: 'cart', target: 12 } };
    expect(parseSavedState(serializeState(own))).toEqual(own);
  });

  it('refuses a save whose choice layers the sim could not reach', () => {
    const base = createSim(live, 3);
    const bad = (extra: Record<string, unknown>): SimState | null => parseSavedState(JSON.stringify({ version: 1, state: { ...base, ...extra } }));
    expect(bad({ chosen: { 'iron-broom': 4 } })).toBeNull();
    expect(bad({ chosen: 'iron-broom' })).toBeNull();
    expect(bad({ order: { type: 'build', target: 3 } })).toBeNull();
    expect(bad({ order: { type: 'own', target: 3 } })).toBeNull();
    expect(bad({ order: { type: 'gather', target: -1 } })).toBeNull();
    expect(bad({ order: { type: 'gather', target: 5, progress: Number.NaN } })).toBeNull();
    expect(bad({ ordersFilled: 1.5 })).toBeNull();
    expect(bad({ devil: { until: 1, next: 0 } })).toBeNull();
    expect(bad({ devil: { until: -1, next: 0, whirlUntil: 0 } })).toBeNull();
  });
});

// A player for the choice layers: two strikes a second, buys like the greedy bot, takes the first
// option at every fork, fills every order it can and swaps a strikes order, and catches every devil.
function chooser(config: SimConfig, seed: number, seconds: number): { state: SimState; log: ReturnType<typeof createRunLog>; filled: number; caught: number } {
  let state = createSim(config, seed);
  const log = createRunLog(seconds / 3600);
  let caught = 0;
  for (let t = 1; t <= seconds; t += 1) {
    state = step(state, config, 1);
    state = apply(apply(state, config, { type: 'strike' }), config, { type: 'strike' });
    const unit = chooseBuy(state, config);
    if (unit !== null) state = apply(state, config, { type: 'buy', unit });
    for (const row of pendingForks(state, config)) state = apply(state, config, { type: 'choose', unlock: row.id, option: forkOptions(row)![0]!.id });
    if (canFill(state, config)) state = apply(state, config, { type: 'fill' });
    if (devilHere(state)) {
      state = apply(state, config, { type: 'catch' });
      caught += 1;
    }
    recordTick(log, state);
  }
  return { state, log, filled: state.ordersFilled ?? 0, caught };
}

describe('the choice layers played end to end', () => {
  const hours = 3;
  const first = chooser(live, 20260914, hours * 3600);
  const again = chooser(live, 20260914, hours * 3600);

  it('fills orders, catches devils and chooses at every fork it reaches', () => {
    expect(first.filled).toBeGreaterThanOrEqual(20);
    expect(first.caught).toBeGreaterThanOrEqual(hours * 3600 / (devils.firstAfter + devils.gapMax) - 2);
    expect(pendingForks(first.state, live)).toEqual([]);
    expect(Object.keys(first.state.chosen ?? {}).length).toBeGreaterThanOrEqual(3);
  });

  it('never goes negative or non-finite, and replays to the same hash', () => {
    first.log.stateHash = hashState(first.state);
    first.log.repeatStateHash = hashState(again.state);
    const results = Object.fromEntries(checkInvariants(first.log).map((result) => [result.name, result.ok]));
    expect(results['no-negative-resource']).toBe(true);
    expect(results['finite-state']).toBe(true);
    expect(results['deterministic-hash']).toBe(true);
  });

  it('opens every unlock within the first hour, and not before half an hour', () => {
    const last = first.state.unlocked.at(-1)!;
    expect(first.state.unlocked).toHaveLength(live.unlocks.unlocks.length);
    expect(last.atSeconds).toBeGreaterThan(1800);
    expect(last.atSeconds).toBeLessThan(3600);
  });
});
