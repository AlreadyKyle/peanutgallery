// The words for the layers after the units (milestones, weather, gems and perks, forks, orders, dust
// devils and the first steps), Three-free and DOM-free so tests/depth-render.test.ts runs them in
// Node. Every number in them comes from the config, so a config-lane change to a weather kind, a fork
// or a perk never leaves its description behind. The HUD (render/hud.ts) and the controls
// (render/controls.ts) put them on screen.
import {
  canFill,
  costOf,
  currentWeather,
  devilHere,
  devilReward,
  dustForNextGem,
  findRow,
  gemsForPress,
  milestoneFactor,
  nextMilestone,
  orderBonus,
  orderProgress,
  orderRest,
  orderReward,
  ordersOpen,
  ownedCount,
  pendingForks,
  whirling,
} from '../sim/sim';
import type { ForkEffect, ForkOption, OrderState, PerkRow, SimConfig, SimState, UnlockRow, WeatherKind } from '../sim/types';
import { formatTimes } from './a11y';
import { fill, formatDust, formatPercent, groupThousands } from './format';
import type { Strings } from './strings';

function unitName(config: SimConfig, unit: string): string {
  return findRow(config, unit)?.name ?? unit;
}

/** What a weather kind does, from its multipliers: "All dust ×1.5" or "Mill ×4, Gatherer ×0.5". */
export function describeWeather(kind: WeatherKind, config: SimConfig, strings: Strings): string {
  const parts: string[] = [];
  if (kind.all !== 1) parts.push(fill(strings.depth.weatherAll, { times: formatTimes(kind.all) }));
  if (kind.strike !== 1) parts.push(fill(strings.depth.weatherStrike, { times: formatTimes(kind.strike) }));
  for (const [unit, value] of Object.entries(kind.units)) {
    parts.push(fill(strings.depth.weatherUnit, { unit: unitName(config, unit), times: formatTimes(value) }));
  }
  return parts.join(', ');
}

/** The seconds the weather in force has left, rounded up, or null for clear skies. */
export function weatherSecondsLeft(state: SimState): number | null {
  const weather = state.weather;
  if (weather === undefined || weather.kind === null) return null;
  return Math.max(0, Math.ceil(weather.until - state.elapsedSeconds));
}

export interface WeatherView {
  kind: WeatherKind;
  effect: string;
  secondsLeft: number;
}

export function weatherView(state: SimState, config: SimConfig, strings: Strings): WeatherView | null {
  const kind = currentWeather(state, config);
  const left = weatherSecondsLeft(state);
  if (kind === null || left === null) return null;
  return { kind, effect: describeWeather(kind, config, strings), secondsLeft: left };
}

/** What a perk does, from its effect: "Strikes ×3", "Each season starts with 10 Gatherer". */
export function describePerk(perk: PerkRow, config: SimConfig, strings: Strings): string {
  const effect = perk.effect;
  switch (effect.type) {
    case 'production':
      return fill(strings.depth.perkProduction, { times: formatTimes(effect.value) });
    case 'strike':
      return fill(strings.depth.perkStrike, { times: formatTimes(effect.value) });
    case 'weather':
      return fill(strings.depth.perkWeather, { times: formatTimes(effect.value) });
    case 'thrift':
      return fill(strings.depth.perkThrift, { percent: formatPercent(2 - effect.value) });
    case 'start':
      return fill(strings.depth.perkStart, { count: String(effect.count), unit: unitName(config, effect.unit) });
  }
}

/** A unit's next milestone in words ("×2 at 25"), or '' when it has passed them all. */
export function milestoneHint(state: SimState, config: SimConfig, strings: Strings, unit: string): string {
  const owned = ownedCount(state, unit);
  const next = nextMilestone(config, owned);
  const factor = config.spawnTable.milestones?.factor;
  if (next === null || factor === undefined) return '';
  return fill(strings.depth.milestoneNext, { times: formatTimes(factor), count: String(next) });
}

export interface MilestoneWords {
  title: string;
  body: string;
  said: string;
}

/** The banner and the live region's words for a unit reaching a milestone. */
export function milestoneWords(config: SimConfig, strings: Strings, unit: string, owned: number): MilestoneWords {
  const name = unitName(config, unit);
  const times = formatTimes(milestoneFactor(config, owned));
  return {
    title: fill(strings.depth.milestoneTitle, { name, times }),
    body: fill(strings.depth.milestoneBody, { count: String(owned), times }),
    said: fill(strings.depth.milestoneSaid, { count: String(owned), name, times }),
  };
}

/**
 * The first steps a new player is shown above the goal bar: strike until a Gatherer is affordable,
 * then buy one. Null once a unit is owned (or after the first season), when the goal bar says enough.
 */
export function firstStep(state: SimState, config: SimConfig, strings: Strings): string | null {
  if ((state.season ?? 0) > 0) return null;
  const first = config.spawnTable.rows[0];
  if (first === undefined) return null;
  if (Object.values(state.owned).some((count) => count > 0)) return null;
  if (state.dust < costOf(state, config, first.id)) return strings.depth.hintStrike;
  return fill(strings.depth.hintBuy, { name: first.name });
}

/** Why a unit could not be bought, in words: "12 more dust for a Cart". */
export function notEnough(state: SimState, config: SimConfig, strings: Strings, unit: string): string {
  const missing = Math.max(1, Math.ceil(costOf(state, config, unit) - state.dust));
  return fill(strings.depth.notEnough, { amount: formatDust(missing), name: unitName(config, unit) });
}

export interface PressView {
  gems: number;
  ready: boolean;
  /** The press button's visible text. */
  text: string;
  /** Its accessible name. */
  label: string;
}

export function pressView(state: SimState, config: SimConfig, strings: Strings): PressView {
  const gems = gemsForPress(state, config);
  if (gems >= 1) {
    return {
      gems,
      ready: true,
      text: fill(strings.depth.press, { gems: groupThousands(gems) }),
      label: fill(strings.depth.pressLabel, { gems: groupThousands(gems) }),
    };
  }
  const text = fill(strings.depth.pressNotYet, { amount: formatDust(dustForNextGem(state, config) ?? 0) });
  return { gems, ready: false, text, label: text };
}

/** The gems line: "4 gems, production +40%", or what a gem is for before the first press. */
export function gemsLine(state: SimState, config: SimConfig, strings: Strings): string {
  const gems = state.gems ?? 0;
  const bonus = config.unlocks.gems?.bonusPerGem ?? 0;
  if (gems === 0 && (state.season ?? 0) === 0) return fill(strings.depth.gemsIntro, { percent: formatPercent(1 + bonus) });
  return fill(strings.depth.gemsHeld, { gems: groupThousands(gems), percent: formatPercent(1 + bonus * gems) });
}

export interface GemGoal {
  /** 0 to 1 from the lifetime dust of the gems a press would give now to the next gem's. */
  progress: number;
  /** Lifetime dust still to earn for one more gem. */
  remaining: number;
}

/** The goal once every unlock is open: the next gem a press would give. Null without gems. */
export function gemGoal(state: SimState, config: SimConfig): GemGoal | null {
  const table = config.unlocks.gems;
  const next = dustForNextGem(state, config);
  if (table === undefined || next === null) return null;
  const now = gemsForPress(state, config);
  const from = now * now * now * table.dustPerGem;
  const span = next - from;
  return { progress: span <= 0 ? 1 : Math.min(1, Math.max(0, (state.totalDust - from) / span)), remaining: Math.max(0, next - state.totalDust) };
}

// ---- Forks ------------------------------------------------------------------------------------

/** What one side of a fork does, from its effect: "Strikes ×2", "Cart ×2", "Dust devils give ×3". */
export function describeForkEffect(effect: ForkEffect, config: SimConfig, strings: Strings): string {
  const times = formatTimes(effect.value);
  switch (effect.type) {
    case 'multiplier':
      return fill(strings.depth.forkMultiplier, { times });
    case 'strike':
      return fill(strings.depth.forkStrike, { times });
    case 'unit':
      return fill(strings.depth.forkUnit, { unit: unitName(config, effect.unit), times });
    case 'weather':
      return fill(strings.depth.forkWeather, { times });
    case 'devil':
      return fill(strings.depth.forkDevil, { times });
    case 'order':
      return fill(strings.depth.forkOrder, { times });
  }
}

export interface ForkOptionView {
  option: ForkOption;
  effect: string;
  /** The option button's accessible name. */
  label: string;
}

export interface ForkView {
  row: UnlockRow;
  options: ForkOptionView[];
  /** Forks still waiting after this one. */
  more: number;
}

/** The first fork waiting for a choice, with its options in words, or null when none is waiting. */
export function forkView(state: SimState, config: SimConfig, strings: Strings): ForkView | null {
  const pending = pendingForks(state, config);
  const row = pending[0];
  if (row === undefined || row.effect.type !== 'fork') return null;
  const options = row.effect.options.map((option) => {
    const effect = describeForkEffect(option.effect, config, strings);
    return { option, effect, label: fill(strings.depth.forkLabel, { name: option.name, effect }) };
  });
  return { row, options, more: pending.length - 1 };
}

/** What the live region says when a fork opens: "Workshop: choose one. Iron broom, Strikes ×2 or ...". */
export function forkOpenWords(row: UnlockRow, config: SimConfig, strings: Strings): string {
  if (row.effect.type !== 'fork') return '';
  const options = row.effect.options.map((option) => `${option.name}, ${describeForkEffect(option.effect, config, strings)}`);
  return fill(strings.depth.forkOpenSaid, { name: row.name, options: options.join(strings.depth.forkOr) });
}

// ---- Orders -----------------------------------------------------------------------------------

/** An order in words: "Own 4 Cart", "Gather 1,200 dust", "Strike 30 times". */
export function orderWords(order: OrderState, config: SimConfig, strings: Strings): string {
  if (order.type === 'own') return fill(strings.depth.orderOwn, { count: groupThousands(order.target), unit: unitName(config, order.unit ?? '') });
  if (order.type === 'strikes') return fill(strings.depth.orderStrikes, { count: groupThousands(order.target) });
  return fill(strings.depth.orderGather, { amount: formatDust(order.target) });
}

export interface OrderView {
  /** What the order asks for. */
  text: string;
  /** "2 of 4". */
  count: string;
  /** 0 to 1. */
  progress: number;
  /** It can be filled now. */
  ready: boolean;
  /** Seconds before a met order can be filled. */
  rest: number;
  reward: number;
  /** The fill button's text and accessible name. */
  fillText: string;
  fillLabel: string;
  /** "3 filled, +6%": what filled orders add for good. */
  filled: string;
}

export function orderView(state: SimState, config: SimConfig, strings: Strings): OrderView | null {
  const order = state.order;
  const progress = orderProgress(state);
  if (!ordersOpen(state, config) || order === undefined || progress === null) return null;
  const reward = orderReward(state, config);
  const amount = formatDust(reward);
  const have = Math.min(progress.have, progress.need);
  const show = (n: number): string => (order.type === 'gather' ? formatDust(Math.floor(n)) : groupThousands(n));
  return {
    text: orderWords(order, config, strings),
    count: fill(strings.depth.orderProgress, { have: show(have), need: show(progress.need) }),
    progress: progress.need <= 0 ? 1 : Math.min(1, Math.max(0, have / progress.need)),
    ready: canFill(state, config),
    rest: orderRest(state),
    reward,
    fillText: fill(strings.depth.orderFill, { amount }),
    fillLabel: fill(strings.depth.orderFillLabel, { amount }),
    filled: fill(strings.depth.ordersCount, { count: groupThousands(state.ordersFilled ?? 0), percent: formatPercent(orderBonus(state, config)) }),
  };
}

// ---- Dust devils ------------------------------------------------------------------------------

export interface DevilView {
  reward: number;
  /** The catch button's text and accessible name. */
  text: string;
  label: string;
}

/** The dust devil on the island, or null when there is none. */
export function devilView(state: SimState, config: SimConfig, strings: Strings): DevilView | null {
  if (config.unlocks.devils === undefined || !devilHere(state)) return null;
  const reward = devilReward(state, config);
  const amount = formatDust(reward);
  return { reward, text: fill(strings.depth.devilCatch, { amount }), label: fill(strings.depth.devilCatchLabel, { amount }) };
}

/** The whirl a caught devil left: its effect in words and the seconds it has left, or null. */
export function whirlView(state: SimState, config: SimConfig, strings: Strings): { effect: string; secondsLeft: number } | null {
  const table = config.unlocks.devils;
  if (table === undefined || state.devil === undefined || !whirling(state)) return null;
  return {
    effect: fill(strings.depth.whirlEffect, { times: formatTimes(table.whirlStrike) }),
    secondsLeft: Math.max(0, Math.ceil(state.devil.whirlUntil - state.elapsedSeconds)),
  };
}

/** The banner and the live region's words for a caught dust devil. */
export function devilCaughtWords(config: SimConfig, strings: Strings, gain: number): { title: string; body: string; said: string } {
  const table = config.unlocks.devils;
  const times = formatTimes(table?.whirlStrike ?? 1);
  const seconds = String(table?.whirlSeconds ?? 0);
  const amount = formatDust(gain);
  return {
    title: fill(strings.depth.devilCaughtTitle, { amount }),
    body: fill(strings.depth.devilCaughtBody, { times, seconds }),
    said: fill(strings.depth.devilCaughtSaid, { amount, times, seconds }),
  };
}
