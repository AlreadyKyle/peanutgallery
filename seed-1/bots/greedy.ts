import { hashState } from '../sim/hash';
import { SECONDS_PER_HOUR, createRunLog, recordTick } from '../sim/invariants';
import type { RunLog } from '../sim/invariants';
import { apply, availableUnits, costOf, createSim, step } from '../sim/sim';
import type { SimConfig, SimState } from '../sim/types';

// The greedy bot: every simulated second it buys the affordable unit with the
// best rate per dust, or nothing. It never strikes, so its curve depends only
// on the config and the tick count.

export interface GreedyOptions {
  seed: number;
  hours: number;
  realSecondsBudget?: number;
  clock?: () => number;
}

export interface GreedyRun {
  state: SimState;
  log: RunLog;
}

const BUDGET_CHECK_INTERVAL = 256;

export function chooseBuy(state: SimState, config: SimConfig): string | null {
  let bestId: string | null = null;
  let bestRatio = 0;
  for (const row of availableUnits(state, config)) {
    const cost = costOf(state, config, row.id);
    if (cost > state.dust) continue;
    const ratio = row.rate / cost;
    if (bestId === null || ratio > bestRatio) {
      bestId = row.id;
      bestRatio = ratio;
    }
  }
  return bestId;
}

export function greedyTick(state: SimState, config: SimConfig): SimState {
  const produced = step(state, config, 1);
  const unit = chooseBuy(produced, config);
  return unit === null ? produced : apply(produced, config, { type: 'buy', unit });
}

function playSeconds(config: SimConfig, seed: number, seconds: number, log: RunLog | null, stop: (() => boolean) | null): SimState {
  let state = createSim(config, seed);
  for (let tick = 1; tick <= seconds; tick += 1) {
    if (stop !== null && tick % BUDGET_CHECK_INTERVAL === 0 && stop()) break;
    state = greedyTick(state, config);
    if (log !== null) recordTick(log, state);
  }
  return state;
}

function defaultClock(): number {
  return performance.now() / 1000;
}

export function runGreedy(config: SimConfig, options: GreedyOptions): GreedyRun {
  const totalSeconds = Math.round(options.hours * SECONDS_PER_HOUR);
  const log = createRunLog(options.hours);
  const clock = options.clock ?? defaultClock;
  const budget = options.realSecondsBudget;
  const startedAt = clock();
  // The first play gets half the real-second budget. The replay repeats
  // exactly the ticks it reached and takes about as long, so the whole run
  // stays inside the budget while still comparing like with like.
  const stop = budget === undefined ? null : () => clock() - startedAt >= budget / 2;

  const state = playSeconds(config, options.seed, totalSeconds, log, stop);
  log.stateHash = hashState(state);
  const repeat = playSeconds(config, options.seed, log.simulatedSeconds, null, null);
  log.repeatStateHash = hashState(repeat);
  return { state, log };
}
