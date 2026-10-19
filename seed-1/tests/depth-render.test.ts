import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { Announcer, describeEffect, formatTimes } from '../render/a11y';
import {
  describeForkEffect,
  describePerk,
  describeWeather,
  devilCaughtWords,
  devilView,
  firstStep,
  forkOpenWords,
  forkView,
  gemGoal,
  gemsLine,
  milestoneHint,
  milestoneWords,
  notEnough,
  orderView,
  orderWords,
  pressView,
  weatherSecondsLeft,
  weatherView,
  whirlView,
} from '../render/depth';
import { Game } from '../render/game';
import { galleryLink, GALLERY_URL } from '../render/seed-code';
import { parseStrings } from '../render/strings';
import { devilSpot, flowerSpot, ISLAND_HALF, MAX_FLOWERS, milestoneColour, SIGNPOST, STRUCTURE_SLOTS, TRACK_RADIUS } from '../render/world';
import { apply, createSim, findPerk, findUnlock, step } from '../sim/sim';
import type { SimState, UnlockRow, WeatherKind } from '../sim/types';
import { LIVE_CONFIG_DIR, LIVE_CONTENT_DIR } from './paths';

// The words and the moments for the layers after the units (render/depth.ts, render/game.ts), and
// the diorama's places for them (render/world.ts).
const config = loadConfigFromDir(LIVE_CONFIG_DIR);
const strings = parseStrings(JSON.parse(readFileSync(join(LIVE_CONTENT_DIR, 'strings.json'), 'utf8')));

function unlocked(state: SimState, upTo: number): SimState {
  return {
    ...state,
    totalDust: Math.max(state.totalDust, upTo),
    unlocked: config.unlocks.unlocks.filter((row) => row.atTotalDust <= upTo).map((row) => ({ id: row.id, atSeconds: 0 })),
  };
}

describe('effects and multipliers in words', () => {
  it('writes multipliers as ×2 or ×1.5', () => {
    expect(formatTimes(2)).toBe('×2');
    expect(formatTimes(1.5)).toBe('×1.5');
    expect(formatTimes(0.5)).toBe('×0.5');
  });

  it('describes every unlock effect in the live config', () => {
    for (const row of config.unlocks.unlocks) expect(describeEffect(row, config, strings), row.id).toMatch(/\S/);
    const broom = config.unlocks.unlocks.find((row) => row.id === 'sturdy-broom')!;
    expect(describeEffect(broom, config, strings)).toBe('Strikes gather ×2.');
    const vane = config.unlocks.unlocks.find((row) => row.effect.type === 'weather')!;
    expect(describeEffect(vane, config, strings)).toBe('Weather comes to the island.');
  });

  it('describes each weather kind from its numbers', () => {
    const kind = (id: string): WeatherKind => config.unlocks.weather!.kinds.find((k) => k.id === id)!;
    expect(describeWeather(kind('breeze'), config, strings)).toBe('All dust ×1.5');
    expect(describeWeather(kind('rain'), config, strings)).toBe('Mill ×4, Gatherer ×0.5');
    expect(describeWeather(kind('shooting-star'), config, strings)).toBe('Strikes ×5');
  });

  it('describes each perk from its effect', () => {
    const words = Object.fromEntries(config.unlocks.gems!.perks.map((perk) => [perk.id, describePerk(perk, config, strings)]));
    expect(words).toEqual({
      'strong-arms': 'Strikes ×3',
      'head-start': 'Each season starts with 10 Gatherers',
      'weather-wise': 'Weather lasts ×2 as long',
      thrift: 'Units cost 20% less',
      'golden-pile': 'Production ×2',
    });
  });
});

describe('the first steps', () => {
  it('says to tap the pile, then to buy a Gatherer, then nothing once one is owned', () => {
    const start = createSim(config, 1);
    expect(firstStep(start, config, strings)).toBe('Tap the pile to gather dust');
    expect(firstStep({ ...start, dust: 10, totalDust: 10 }, config, strings)).toBe('Buy a Gatherer: it gathers for you');
    expect(firstStep({ ...start, owned: { ...start.owned, gatherer: 1 } }, config, strings)).toBeNull();
  });

  it('gives a refused purchase a reason in words', () => {
    const state = { ...unlocked(createSim(config, 1), 100), dust: 100 };
    expect(notEnough(state, config, strings, 'cart')).toBe('20 more dust for a Cart');
  });
});

describe('milestones in words', () => {
  it('shows the next milestone and says when one is reached', () => {
    const start = createSim(config, 1);
    expect(milestoneHint(start, config, strings, 'gatherer')).toBe('×2 at 10');
    expect(milestoneHint({ ...start, owned: { ...start.owned, gatherer: 120 } }, config, strings, 'gatherer')).toBe('');
    expect(milestoneWords(config, strings, 'mill', 25)).toEqual({
      title: 'Mill ×4',
      body: '25 owned: each one gathers ×4.',
      said: 'Milestone: 25 Mill owned. Each one gathers ×4.',
    });
  });
});

describe('weather in words', () => {
  it('counts down the seconds left and is null under clear skies', () => {
    const base = createSim(config, 1);
    expect(weatherSecondsLeft(base)).toBeNull();
    expect(weatherSecondsLeft({ ...base, elapsedSeconds: 10.2, weather: { kind: 'rain', until: 40, next: 0 } })).toBe(30);
    expect(weatherSecondsLeft({ ...base, weather: { kind: null, until: 0, next: 40 } })).toBeNull();
    const view = weatherView({ ...base, weather: { kind: 'heatwave', until: 50, next: 0 } }, config, strings);
    expect(view?.kind.name).toBe('Heatwave');
    expect(view?.effect).toBe('Forge ×3, Foundry ×2, Cart ×0.5');
  });
});

describe('gems in words', () => {
  it('explains a gem before the first press, then counts them', () => {
    const before = unlocked(createSim(config, 1), 1_000_000);
    expect(gemsLine(before, config, strings)).toBe('Each gem adds 10% to production, for good.');
    const after = apply(before, config, { type: 'press' });
    expect(gemsLine(after, config, strings)).toBe('2 gems, production +20%');
  });

  it('offers the press with its gems, or says when the next gem comes', () => {
    expect(pressView(unlocked(createSim(config, 1), 1_000_000), config, strings)).toMatchObject({ gems: 2, ready: true, text: 'Press the pile: +2 gems' });
    const none = pressView(createSim(config, 1), config, strings);
    expect(none.ready).toBe(false);
    expect(none.text).toBe('Next gem at 125,000 lifetime dust');
  });

  it('runs the goal bar to the next gem', () => {
    const goal = gemGoal({ ...createSim(config, 1), totalDust: 1_000_000 + (3_375_000 - 1_000_000) / 2 }, config);
    expect(goal?.progress).toBeCloseTo(0.5);
    expect(goal?.remaining).toBeCloseTo((3_375_000 - 1_000_000) / 2);
  });
});

describe('the running game tells its listeners about the layers', () => {
  it('a milestone, a press, a perk and the weather', () => {
    const events: string[] = [];
    const rich = { ...unlocked(createSim(config, 1), 4_000_000), dust: 1e7, owned: { gatherer: 9, cart: 0, mill: 0, forge: 0, foundry: 0 } };
    const game = new Game(config, rich);
    game.listen({
      milestone: (unit, owned) => events.push(`milestone ${unit} ${owned}`),
      pressed: (gems, state) => events.push(`pressed ${gems} season ${state.season}`),
      perk: (id) => events.push(`perk ${id}`),
      weather: (kind) => events.push(`weather ${kind === null ? 'clear' : kind.id}`),
      unlocked: (rows: UnlockRow[]) => events.push(`unlocked ${rows.length}`),
    });
    game.act({ type: 'buy', unit: 'gatherer' });
    game.act({ type: 'buy', unit: 'gatherer' });
    game.act({ type: 'press' });
    game.act({ type: 'perk', perk: 'strong-arms' });
    expect(events).toEqual(['milestone gatherer 10', 'pressed 3 season 1', 'perk strong-arms']);
    // A season that reaches the weather vane again starts its weather a fixed while later.
    for (let ms = 0; ms <= 3_600_000; ms += 1000) game.tick(ms);
    expect(events.filter((event) => event.startsWith('weather ')).length).toBeGreaterThan(2);
    expect(events.some((event) => event.startsWith('unlocked '))).toBe(true);
  });

  it('the announcer speaks the unlocks of a new season', () => {
    let state = unlocked(createSim(config, 1), 4_000_000);
    const announcer = new Announcer(config, strings, state, 0);
    state = apply(state, config, { type: 'press' });
    expect(announcer.tick(state, 20_000)).not.toContain('Unlocked');
    state = step(state, config, 60);
    expect(announcer.tick(state, 40_000)).toContain('Unlocked Sturdy broom.');
  });

  it('a perk costs its gems', () => {
    expect(findPerk(config, 'golden-pile')?.cost).toBe(6);
  });
});

describe('Save to gallery', () => {
  it('opens the seed gallery with the seed code in ?save=', () => {
    const link = galleryLink('dust:v1:abc_-');
    expect(link.startsWith(`${GALLERY_URL}?save=`)).toBe(true);
    expect(new URL(link).searchParams.get('save')).toBe('dust:v1:abc_-');
    expect(new URL(link).origin).toBe('https://mobmachine.games');
  });
});

describe('the island blooms and wears its milestones', () => {
  it('puts every flower on the grass, clear of the clearing, the buildings and the pond', () => {
    const slots = Object.values(STRUCTURE_SLOTS).flat();
    for (let i = 0; i < MAX_FLOWERS; i += 1) {
      const spot = flowerSpot(i);
      expect(Math.hypot(spot.x, spot.z)).toBeGreaterThanOrEqual(4.2);
      expect(Math.abs(spot.x)).toBeLessThan(6);
      expect(Math.abs(spot.z)).toBeLessThan(6);
      for (const slot of slots) expect(Math.hypot(spot.x - slot.x, spot.z - slot.z)).toBeGreaterThanOrEqual(1.2);
      expect(flowerSpot(i)).toEqual(spot);
    }
  });

  it('climbs the milestone colours to the suit magenta and stays there', () => {
    expect(milestoneColour(1)).toBe(0xf5dc7a);
    expect(milestoneColour(5)).toBe(0xb0226a);
    expect(milestoneColour(9)).toBe(0xb0226a);
  });
});

describe('the choice layers in words', () => {
  const owned = { gatherer: 20, cart: 10, mill: 5, forge: 2, foundry: 1 };

  it('says what each side of every fork does', () => {
    const words = config.unlocks.unlocks.flatMap((row) => (row.effect.type === 'fork' ? row.effect.options.map((option) => describeForkEffect(option.effect, config, strings)) : []));
    expect(words).toEqual([
      'Strikes ×1.5',
      'Cart ×2',
      'Mill ×1.5',
      'Forge ×1.5',
      'All dust ×1.2',
      'Strikes ×1.5',
      'Weather lasts ×2',
      'Orders pay ×3',
      'Foundry ×1.5',
      'Dust devils give ×3',
      'Strikes ×1.5',
      'All dust ×1.2',
    ]);
  });

  it('shows the first fork waiting, its buttons named in full, and how many more wait', () => {
    const state = { ...unlocked(createSim(config, 1), 600_000), owned };
    const view = forkView(state, config, strings)!;
    expect(view.row.id).toBe('iron-broom');
    expect(view.options.map((option) => option.label)).toEqual(['Choose Iron broom: Strikes ×1.5, this season', 'Choose Oiled axles: Cart ×2, this season']);
    expect(view.more).toBe(1);
    const chosen = apply(apply(state, config, { type: 'choose', unlock: 'iron-broom', option: 'iron-broom' }), config, { type: 'choose', unlock: 'sharper-tools', option: 'bellows' });
    expect(forkView(chosen, config, strings)).toBeNull();
    expect(forkOpenWords(findUnlock(config, 'sharper-tools')!, config, strings)).toBe('Sharper tools: choose one. Millstones, Mill ×1.5 or Bellows, Forge ×1.5.');
  });

  it('puts an order in words with its progress, its reward and its rest', () => {
    expect(orderWords({ type: 'own', unit: 'cart', target: 12 }, config, strings)).toBe('Own 12 Carts');
    expect(orderWords({ type: 'strikes', target: 30 }, config, strings)).toBe('Strike 30 times');
    expect(orderWords({ type: 'gather', target: 1200 }, config, strings)).toBe('Gather 1,200 dust');
    const base = { ...unlocked(createSim(config, 1), 2000), owned, elapsedSeconds: 100 };
    expect(orderView({ ...base, unlocked: [] }, config, strings)).toBeNull();
    const half = orderView({ ...base, order: { type: 'strikes', target: 30, progress: 15 } }, config, strings)!;
    expect(half.text).toBe('Strike 30 times');
    expect(half.count).toBe('15 of 30');
    expect(half.progress).toBeCloseTo(0.5);
    expect(half.ready).toBe(false);
    expect(half.fillLabel.startsWith('Fill the order for ')).toBe(true);
    const resting = orderView({ ...base, order: { type: 'strikes', target: 30, progress: 30, from: 112 } }, config, strings)!;
    expect(resting.ready).toBe(false);
    expect(resting.rest).toBe(12);
    const ready = orderView({ ...base, ordersFilled: 3, order: { type: 'strikes', target: 30, progress: 31 } }, config, strings)!;
    expect(ready.ready).toBe(true);
    expect(ready.count).toBe('30 of 30');
    expect(ready.filled).toBe('3 filled, +3%');
  });

  it('shows the dust devil while it is here, and the whirl it leaves', () => {
    const base = { ...unlocked(createSim(config, 1), 2000), owned, elapsedSeconds: 100 };
    expect(devilView({ ...base, devil: { until: 0, next: 200, whirlUntil: 0 } }, config, strings)).toBeNull();
    const here = devilView({ ...base, devil: { until: 110, next: 0, whirlUntil: 0 } }, config, strings)!;
    expect(here.text.startsWith('Catch the dust devil +')).toBe(true);
    expect(here.label.startsWith('Catch the dust devil for ')).toBe(true);
    expect(whirlView({ ...base, devil: { until: 0, next: 300, whirlUntil: 105.5 } }, config, strings)).toEqual({ effect: 'Strikes ×2', secondsLeft: 6 });
    expect(whirlView({ ...base, devil: { until: 0, next: 300, whirlUntil: 90 } }, config, strings)).toBeNull();
    expect(devilCaughtWords(config, strings, 1500)).toEqual({
      title: '+1,500 dust',
      body: 'Strikes ×2 for 8 seconds',
      said: 'Caught the dust devil: +1,500 dust. Strikes ×2 for 8 seconds.',
    });
  });
});

describe('the running game tells its listeners about the choices', () => {
  it('a fork chosen, an order drawn and filled, a devil that comes, is caught and comes again', () => {
    const events: string[] = [];
    const game = new Game(config, { ...createSim(config, 1), totalDust: 999, dust: 999 });
    game.listen({
      chose: (unlock, option) => events.push(`chose ${unlock} ${option}`),
      ordered: (order) => events.push(`ordered ${order.type}`),
      filled: () => events.push('filled'),
      devil: (here) => events.push(`devil ${here ? 'here' : 'gone'}`),
      caught: () => events.push('caught'),
    });
    for (let ms = 0; ms <= 600_000; ms += 1000) {
      const state = game.tick(ms);
      game.act({ type: 'strike' });
      if (state.order !== undefined && state.order.type === 'own') game.act({ type: 'buy', unit: state.order.unit! });
      game.act({ type: 'fill' });
      if (events.at(-1) === 'devil here' && events.filter((e) => e === 'caught').length === 0) game.act({ type: 'catch' });
    }
    expect(events[0]).toMatch(/^ordered /);
    expect(events).toContain('filled');
    expect(events.indexOf('caught')).toBeGreaterThan(events.indexOf('devil here'));
    expect(events.filter((e) => e === 'devil here').length).toBeGreaterThanOrEqual(2);
    expect(events).toContain('devil gone');
    game.act({ type: 'choose', unlock: 'iron-broom', option: 'oiled-axles' });
    expect(events.at(-1)).toBe('chose iron-broom oiled-axles');
  });
});

describe('the island has room for the choices', () => {
  it('the signpost stands on the island, outside the track and clear of the buildings', () => {
    expect(Math.hypot(SIGNPOST.x, SIGNPOST.z)).toBeGreaterThan(TRACK_RADIUS);
    expect(Math.abs(SIGNPOST.x)).toBeLessThan(ISLAND_HALF - 0.5);
    expect(Math.abs(SIGNPOST.z)).toBeLessThan(ISLAND_HALF - 0.5);
    for (const slot of Object.values(STRUCTURE_SLOTS).flat()) expect(Math.hypot(SIGNPOST.x - slot.x, SIGNPOST.z - slot.z)).toBeGreaterThan(1);
    for (let i = 0; i < MAX_FLOWERS; i += 1) expect(Math.hypot(flowerSpot(i).x - SIGNPOST.x, flowerSpot(i).z - SIGNPOST.z)).toBeGreaterThanOrEqual(0.9);
  });

  it('the dust devil loops inside the track, the same way for the same seed and clock', () => {
    for (const seed of [0, 17, 1234]) {
      for (let t = 0; t < 30; t += 0.5) {
        const spot = devilSpot(seed, t);
        const r = Math.hypot(spot.x, spot.z);
        expect(r).toBeGreaterThan(1.8);
        expect(r).toBeLessThanOrEqual(TRACK_RADIUS);
        expect(devilSpot(seed, t)).toEqual(spot);
      }
    }
    expect(devilSpot(1, 3)).not.toEqual(devilSpot(2, 3));
  });
});
