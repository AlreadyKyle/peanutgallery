// The playtest: scripted players play the sim second by second and the run is read against the
// quality bar's pacing (docs/strategy/game-quality.md §4 The first 60 seconds, §5 The session arc, §1
// criterion 6 Depth over time). tests/playtest.test.ts holds the live config to it; run this file to
// print the table for a pull request:
//
//   npx tsx tests/playtest.ts [<config dir to compare against>]
//
// Each player steps one second at a time, strikes at its own pace, buys the unit with the best rate
// per dust it can afford, and acts on forks, orders and dust devils after its reaction time. It reads
// only the sim; nothing here is the game's code.
import { pathToFileURL } from 'node:url';
import { loadConfigFromDir } from '../bots/config';
import { depthMark } from '../bots/depth';
import type { DepthMark } from '../bots/depth';
import {
  apply,
  availableUnits,
  canBuyPerk,
  canPress,
  costOf,
  createSim,
  devilHere,
  devilReward,
  forkOptions,
  gemsForPress,
  milestoneTier,
  orderFilled,
  canFill,
  orderReward,
  ordersOpen,
  ownedCount,
  pendingForks,
  ratePerSecond,
  step,
  strikeMultiplier,
  unitRate,
} from '../sim';
import type { SimAction, SimConfig, SimState, UnlockRow } from '../sim';
import { LIVE_CONFIG_DIR } from './paths';

export interface Player {
  name: string;
  /** Strikes a second, on average (a fraction strikes every so many seconds). */
  strikesPerSecond: number;
  /** Seconds before the player acts on something new: a fork, a filled order, a dust devil. */
  reactSeconds: number;
}

export const ACTIVE: Player = { name: 'active', strikesPerSecond: 2, reactSeconds: 2 };
export const CASUAL: Player = { name: 'casual', strikesPerSecond: 0.5, reactSeconds: 8 };

export type DecisionKind = 'buy' | 'choose' | 'fill' | 'swap' | 'catch' | 'press' | 'perk';
export type MomentKind = 'unlock' | 'milestone' | 'weather' | 'order' | 'devil' | 'fork' | 'season';

export interface Run {
  state: SimState;
  decisions: { at: number; kind: DecisionKind }[];
  moments: { at: number; kind: MomentKind; what: string }[];
  /** The second each unlock first opened, by id (first season only). */
  unlockAt: Record<string, number>;
}

// What a player with this pace earns a second from production and strikes together.
function worth(state: SimState, config: SimConfig, player: Player): number {
  const rate = ratePerSecond(state, config);
  return rate * (1 + player.strikesPerSecond * 1.5 * strikeMultiplier(state, config)) + devilReward(state, config) / 160 + orderReward(state, config) / 90;
}

/** The option of a fork that this player would earn most from, judged a second ahead. */
export function pickOption(state: SimState, config: SimConfig, row: UnlockRow, player: Player): string {
  const options = forkOptions(row) ?? [];
  let best = options[0]!.id;
  let bestWorth = -Infinity;
  for (const option of options) {
    const chosen = apply(state, config, { type: 'choose', unlock: row.id, option: option.id });
    const value = worth(chosen, config, player);
    if (value > bestWorth) {
      bestWorth = value;
      best = option.id;
    }
  }
  return best;
}

function bestBuy(state: SimState, config: SimConfig): string | null {
  let bestId: string | null = null;
  let bestRatio = 0;
  for (const row of availableUnits(state, config)) {
    const cost = costOf(state, config, row.id);
    if (cost > state.dust) continue;
    const ratio = unitRate(state, config, row.id) / cost;
    if (bestId === null || ratio > bestRatio) {
      bestId = row.id;
      bestRatio = ratio;
    }
  }
  return bestId;
}

export function play(config: SimConfig, player: Player, seconds: number, seed = 20260914, from?: SimState): Run {
  let state = from ?? createSim(config, seed);
  const decisions: Run['decisions'] = [];
  const moments: Run['moments'] = [];
  const unlockAt: Record<string, number> = {};
  let strikeDebt = 0;
  // When each thing to act on was first seen, so the player waits its reaction time.
  let devilSeen = -1;
  let forkSeen = -1;
  let orderSeen = -1;
  const t0 = state.elapsedSeconds;
  const act = (action: SimAction, kind: DecisionKind): void => {
    const after = apply(state, config, action);
    if (after === state) return;
    note(state, after);
    state = after;
    decisions.push({ at: state.elapsedSeconds - t0, kind });
  };
  const note = (before: SimState, after: SimState): void => {
    const at = after.elapsedSeconds - t0;
    if ((after.season ?? 0) > (before.season ?? 0)) {
      moments.push({ at, kind: 'season', what: `season ${(after.season ?? 0) + 1}` });
      return;
    }
    for (const event of after.unlocked.slice(before.unlocked.length)) {
      moments.push({ at, kind: 'unlock', what: event.id });
      if ((after.season ?? 0) === 0 && unlockAt[event.id] === undefined) unlockAt[event.id] = at;
    }
    for (const row of config.spawnTable.rows) {
      if (milestoneTier(config, ownedCount(after, row.id)) > milestoneTier(config, ownedCount(before, row.id))) moments.push({ at, kind: 'milestone', what: row.id });
    }
    if ((after.weather?.kind ?? null) !== (before.weather?.kind ?? null) && after.weather?.kind) moments.push({ at, kind: 'weather', what: after.weather.kind });
    if (devilHere(after) && !devilHere(before)) moments.push({ at, kind: 'devil', what: 'arrives' });
    if ((after.ordersFilled ?? 0) > (before.ordersFilled ?? 0)) moments.push({ at, kind: 'order', what: `filled ${after.ordersFilled}` });
    if (Object.keys(after.chosen ?? {}).length > Object.keys(before.chosen ?? {}).length) moments.push({ at, kind: 'fork', what: 'chosen' });
  };

  for (let t = 1; t <= seconds; t += 1) {
    const before = state;
    state = step(state, config, 1);
    note(before, state);
    const now = state.elapsedSeconds;
    strikeDebt += player.strikesPerSecond;
    while (strikeDebt >= 1) {
      strikeDebt -= 1;
      const after = apply(state, config, { type: 'strike' });
      note(state, after);
      state = after;
    }
    if (devilHere(state)) {
      if (devilSeen < 0) devilSeen = now;
      if (now - devilSeen >= player.reactSeconds) act({ type: 'catch' }, 'catch');
    }
    if (!devilHere(state)) devilSeen = -1;
    const fork = pendingForks(state, config)[0];
    if (fork !== undefined) {
      if (forkSeen < 0) forkSeen = now;
      if (now - forkSeen >= player.reactSeconds) {
        act({ type: 'choose', unlock: fork.id, option: pickOption(state, config, fork, player) }, 'choose');
        forkSeen = -1;
      }
    }
    if (ordersOpen(state, config) && state.order !== undefined) {
      if (canFill(state, config)) {
        if (orderSeen < 0) orderSeen = now;
        if (now - orderSeen >= player.reactSeconds) {
          act({ type: 'fill' }, 'fill');
          orderSeen = -1;
        }
      } else if (state.order.type === 'strikes' && player.strikesPerSecond < 1) {
        // A player who rarely strikes swaps a strikes order for another.
        if (orderSeen < 0) orderSeen = now;
        if (now - orderSeen >= player.reactSeconds) {
          act({ type: 'swap' }, 'swap');
          orderSeen = -1;
        }
      }
    }
    for (let buys = 0; buys < 10; buys += 1) {
      const unit = bestBuy(state, config);
      if (unit === null) break;
      act({ type: 'buy', unit }, 'buy');
    }
    if (canPress(state, config) && gemsForPress(state, config) >= Math.max(2, state.gems ?? 0)) act({ type: 'press' }, 'press');
    const perk = (config.unlocks.gems?.perks ?? []).filter((row) => canBuyPerk(state, config, row.id)).sort((a, b) => a.cost - b.cost)[0];
    if (perk !== undefined) act({ type: 'perk', perk: perk.id }, 'perk');
  }
  return { state, decisions, moments, unlockAt };
}

export interface Pacing {
  firstBuy: number | null;
  firstUnlock: number | null;
  firstOrderFilled: number | null;
  firstDevil: number | null;
  firstFork: number | null;
  firstWeather: number | null;
  gemsOpen: number | null;
  /** Choices a minute that are not a purchase (forks, orders, devils, presses, perks), by window. */
  choicesPerMinute: { first2: number; first10: number; tenTo60: number };
  buysPerMinute: { first2: number; first10: number; tenTo60: number };
  /** New things on screen (unlocks, milestones, weather, devils, orders filled, forks) per 2 minutes in the first hour. */
  momentsPer2Min: { min: number; median: number };
  /** The longest stretch in the first hour with no new thing on screen, in seconds. */
  longestQuiet: number;
  /** Distinct kinds of new thing seen in the first hour. */
  kindsFirstHour: number;
  /**
   * When the run last met a new mechanic (a unit, the weather, gems, a fork, or the unlock that opens
   * orders or dust devils; bots/depth.ts says why) and how many multiplier-only unlocks it opened after.
   * Reported for the table, never held to a bar.
   */
  depth: DepthMark;
}

function firstAt<T extends { at: number }>(rows: T[], test: (row: T) => boolean): number | null {
  return rows.find(test)?.at ?? null;
}

function perMinute(rows: { at: number }[], from: number, to: number): number {
  return Math.round((rows.filter((row) => row.at > from && row.at <= to).length / ((to - from) / 60)) * 10) / 10;
}

export function pacing(run: Run, config: SimConfig): Pacing {
  const choices = run.decisions.filter((d) => d.kind !== 'buy');
  const buys = run.decisions.filter((d) => d.kind === 'buy');
  const windows: number[] = [];
  for (let start = 0; start < 3600; start += 120) windows.push(run.moments.filter((m) => m.at > start && m.at <= start + 120).length);
  const sorted = [...windows].sort((a, b) => a - b);
  let quiet = 0;
  let last = 0;
  for (const moment of run.moments.filter((m) => m.at <= 3600)) {
    quiet = Math.max(quiet, moment.at - last);
    last = moment.at;
  }
  quiet = Math.max(quiet, 3600 - last);
  return {
    firstBuy: firstAt(run.decisions, (d) => d.kind === 'buy'),
    firstUnlock: firstAt(run.moments, (m) => m.kind === 'unlock'),
    firstOrderFilled: firstAt(run.moments, (m) => m.kind === 'order'),
    firstDevil: firstAt(run.moments, (m) => m.kind === 'devil'),
    firstFork: firstAt(run.moments, (m) => m.kind === 'fork'),
    firstWeather: firstAt(run.moments, (m) => m.kind === 'weather'),
    gemsOpen: run.unlockAt['pressing-stone'] ?? null,
    choicesPerMinute: { first2: perMinute(choices, 0, 120), first10: perMinute(choices, 0, 600), tenTo60: perMinute(choices, 600, 3600) },
    buysPerMinute: { first2: perMinute(buys, 0, 120), first10: perMinute(buys, 0, 600), tenTo60: perMinute(buys, 600, 3600) },
    momentsPer2Min: { min: sorted[0] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0 },
    longestQuiet: quiet,
    kindsFirstHour: new Set(run.moments.filter((m) => m.at <= 3600).map((m) => m.kind)).size,
    depth: depthMark(config, run.moments.filter((m) => m.kind === 'unlock').map((m) => ({ id: m.what, atSeconds: m.at }))),
  };
}

/** A two-minute session after eight hours away from the state an hour of play leaves: what it holds. */
export function returnSession(config: SimConfig, player: Player): { payoffs: number; choices: number; kinds: string[] } {
  const hour = play(config, player, 3600).state;
  const away = step(hour, config, 8 * 3600);
  const session = play(config, player, 120, 0, away);
  const kinds = new Set<string>(session.moments.map((m) => m.kind));
  for (const d of session.decisions) if (d.kind !== 'buy') kinds.add(d.kind);
  return { payoffs: session.moments.length, choices: session.decisions.filter((d) => d.kind !== 'buy').length, kinds: [...kinds].sort() };
}

function time(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 120) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} m ${String(seconds % 60).padStart(2, '0')} s`;
}

function depthCell(mark: DepthMark): string {
  const at = mark.lastNewMechanic === null ? 'never' : `${time(mark.lastNewMechanic.atSeconds)} (${mark.lastNewMechanic.id})`;
  const unreached = mark.newMechanicsNotReached > 0 ? `, ${mark.newMechanicsNotReached} not reached` : '';
  return `${at}; ${mark.multipliersAfter}${unreached}`;
}

/** The markdown table the pull request carries: before (another config) and after (the live config). */
export function table(before: SimConfig, after: SimConfig): string {
  const rows: string[] = [];
  const line = (cells: string[]): void => {
    rows.push(`| ${cells.join(' | ')} |`);
  };
  line(['Measure (seed 20260914)', 'Bar', 'Before, active', 'After, active', 'Before, casual', 'After, casual']);
  line(['---', '---', '---', '---', '---', '---']);
  const configs = [before, after, before, after];
  const runs = [play(before, ACTIVE, 3600), play(after, ACTIVE, 3600), play(before, CASUAL, 3600), play(after, CASUAL, 3600)];
  const p = runs.map((run, i) => pacing(run, configs[i]!));
  const cell = (f: (x: Pacing) => string): string[] => p.map(f);
  line(['First purchase (first choice)', 'by 30 s', ...cell((x) => time(x.firstBuy))]);
  line(['First unlock (something new)', 'by 60 s', ...cell((x) => time(x.firstUnlock))]);
  line(['First order filled', '', ...cell((x) => time(x.firstOrderFilled))]);
  line(['First dust devil', '', ...cell((x) => time(x.firstDevil))]);
  line(['First weather', '', ...cell((x) => time(x.firstWeather))]);
  line(['First fork chosen', '', ...cell((x) => time(x.firstFork))]);
  line(['Gems open (pressing stone)', '', ...cell((x) => time(x.gemsOpen))]);
  for (const id of ['cart', 'mill', 'forge', 'foundry']) line([`Unlock: ${id}`, '', ...runs.map((r) => time(r.unlockAt[id] ?? null))]);
  line(['Choices a minute, first 2 min (not purchases)', '', ...cell((x) => String(x.choicesPerMinute.first2))]);
  line(['Choices a minute, first 10 min', '', ...cell((x) => String(x.choicesPerMinute.first10))]);
  line(['Choices a minute, minutes 10 to 60', '', ...cell((x) => String(x.choicesPerMinute.tenTo60))]);
  line(['Purchases a minute, minutes 10 to 60', '', ...cell((x) => String(x.buysPerMinute.tenTo60))]);
  line(['New things per 2 min, first hour (min / median)', 'something new every 2 min', ...cell((x) => `${x.momentsPer2Min.min} / ${x.momentsPer2Min.median}`)]);
  line(['Longest stretch with nothing new, first hour', '', ...cell((x) => time(x.longestQuiet))]);
  line(['Kinds of new thing in the first hour', 'new mechanics across the hour', ...cell((x) => String(x.kindsFirstHour))]);
  line(['Last new mechanic, first hour; multiplier-only unlocks after it', '', ...cell((x) => depthCell(x.depth))]);
  const back = [returnSession(before, ACTIVE), returnSession(after, ACTIVE), returnSession(before, CASUAL), returnSession(after, CASUAL)];
  line(['2-minute return after 8 h away: new things / choices', 'a payoff and a reason to return', ...back.map((b) => `${b.payoffs} / ${b.choices}`)]);
  return rows.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const beforeDir = process.argv[2] ?? LIVE_CONFIG_DIR;
  console.log(table(loadConfigFromDir(beforeDir), loadConfigFromDir(LIVE_CONFIG_DIR)));
}
