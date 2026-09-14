import { nextRandom, seedRng } from './rng';
import type { SimAction, SimConfig, SimState, SpawnRow, UnlockEvent, UnlockRow } from './types';

// Every function here is pure: it reads the state it is given and returns a
// new one (or the same object when the action changes nothing).

export const BASE_RATE = 1;
export const COST_GROWTH = 1.25;

export function createSim(config: SimConfig, seed: number): SimState {
  const owned: Record<string, number> = {};
  for (const row of config.spawnTable.rows) owned[row.id] = 0;
  return {
    seed,
    rngState: seedRng(seed),
    elapsedSeconds: 0,
    dust: 0,
    totalDust: 0,
    owned,
    unlocked: [],
  };
}

export function findRow(config: SimConfig, unit: string): SpawnRow | null {
  return config.spawnTable.rows.find((row) => row.id === unit) ?? null;
}

export function findUnlock(config: SimConfig, id: string): UnlockRow | null {
  return config.unlocks.unlocks.find((row) => row.id === id) ?? null;
}

export function isUnlocked(state: SimState, id: string): boolean {
  return state.unlocked.some((event) => event.id === id);
}

export function isUnitAvailable(state: SimState, config: SimConfig, unit: string): boolean {
  const gate = config.unlocks.unlocks.find((row) => row.effect.type === 'unit' && row.effect.unit === unit);
  return gate === undefined || isUnlocked(state, gate.id);
}

export function availableUnits(state: SimState, config: SimConfig): SpawnRow[] {
  return config.spawnTable.rows.filter((row) => isUnitAvailable(state, config, row.id));
}

export function ownedCount(state: SimState, unit: string): number {
  return state.owned[unit] ?? 0;
}

export function ratePerSecond(state: SimState, config: SimConfig): number {
  let base = BASE_RATE;
  for (const row of config.spawnTable.rows) base += row.rate * ownedCount(state, row.id);
  let multiplier = 1;
  for (const event of state.unlocked) {
    const row = findUnlock(config, event.id);
    if (row !== null && row.effect.type === 'multiplier') multiplier *= row.effect.value;
  }
  return base * multiplier;
}

export function costOf(state: SimState, config: SimConfig, unit: string): number {
  const row = findRow(config, unit);
  if (row === null) throw new Error(`Unknown unit "${unit}"`);
  return Math.round(row.baseCost * Math.pow(COST_GROWTH, ownedCount(state, unit)));
}

export function nextLockedUnlock(state: SimState, config: SimConfig): UnlockRow | null {
  return config.unlocks.unlocks.find((row) => !isUnlocked(state, row.id)) ?? null;
}

function settleUnlocks(state: SimState, config: SimConfig): SimState {
  const reached: UnlockEvent[] = [];
  for (const row of config.unlocks.unlocks) {
    if (row.atTotalDust <= state.totalDust && !isUnlocked(state, row.id)) {
      reached.push({ id: row.id, atSeconds: state.elapsedSeconds });
    }
  }
  if (reached.length === 0) return state;
  return { ...state, unlocked: [...state.unlocked, ...reached] };
}

function gain(state: SimState, amount: number): SimState {
  return { ...state, dust: state.dust + amount, totalDust: state.totalDust + amount };
}

export function step(state: SimState, config: SimConfig, dtSeconds = 1): SimState {
  const produced = ratePerSecond(state, config) * dtSeconds;
  const advanced = { ...gain(state, produced), elapsedSeconds: state.elapsedSeconds + dtSeconds };
  return settleUnlocks(advanced, config);
}

// A strike hands over between one and two seconds of production (the draw is
// in [0, 1), so the yield is in [rate, 2 x rate)), rolled on the seeded
// generator so a replay with the same inputs lands identically.
export function strikeYield(state: SimState, config: SimConfig): { rngState: number; amount: number } {
  const draw = nextRandom(state.rngState);
  return { rngState: draw.state, amount: ratePerSecond(state, config) * (1 + draw.value) };
}

export function apply(state: SimState, config: SimConfig, action: SimAction): SimState {
  switch (action.type) {
    case 'strike': {
      const roll = strikeYield(state, config);
      return settleUnlocks({ ...gain(state, roll.amount), rngState: roll.rngState }, config);
    }
    case 'buy': {
      if (findRow(config, action.unit) === null) return state;
      if (!isUnitAvailable(state, config, action.unit)) return state;
      const cost = costOf(state, config, action.unit);
      if (state.dust < cost) return state;
      return {
        ...state,
        dust: state.dust - cost,
        owned: { ...state.owned, [action.unit]: ownedCount(state, action.unit) + 1 },
      };
    }
  }
}
