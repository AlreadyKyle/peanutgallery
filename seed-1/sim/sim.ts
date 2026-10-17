import { nextRandom, seedRng } from './rng';
import type {
  PerkRow,
  SimAction,
  SimConfig,
  SimState,
  SpawnRow,
  UnlockEvent,
  UnlockRow,
  WeatherKind,
  WeatherState,
} from './types';

// Every function here is pure: it reads the state it is given and returns a
// new one (or the same object when the action changes nothing).
//
// The layers after the units (milestones, weather, gems and perks) are optional in the config. A
// config without them leaves every number and every field of the state exactly as it was before
// they existed, so the pinned timeline (tests/timeline.test.ts, against tests/fixtures/config)
// holds; tests/depth.test.ts covers the layers themselves.

export const BASE_RATE = 1;
export const COST_GROWTH = 1.25;

function freshOwned(config: SimConfig): Record<string, number> {
  const owned: Record<string, number> = {};
  for (const row of config.spawnTable.rows) owned[row.id] = 0;
  return owned;
}

export function createSim(config: SimConfig, seed: number): SimState {
  return {
    seed,
    rngState: seedRng(seed),
    elapsedSeconds: 0,
    dust: 0,
    totalDust: 0,
    owned: freshOwned(config),
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

// ---- Milestones -------------------------------------------------------------------------------

/** How many milestones `owned` units have passed (0 without a milestone table). */
export function milestoneTier(config: SimConfig, owned: number): number {
  const table = config.spawnTable.milestones;
  if (table === undefined) return 0;
  let tier = 0;
  for (const at of table.at) if (owned >= at) tier += 1;
  return tier;
}

/** The next owned count that passes a milestone, or null when there is none left (or no table). */
export function nextMilestone(config: SimConfig, owned: number): number | null {
  const table = config.spawnTable.milestones;
  if (table === undefined) return null;
  return table.at.find((at) => at > owned) ?? null;
}

/** What one unit's rate is multiplied by at its milestones. */
export function milestoneFactor(config: SimConfig, owned: number): number {
  const table = config.spawnTable.milestones;
  if (table === undefined) return 1;
  return Math.pow(table.factor, milestoneTier(config, owned));
}

// ---- Weather ----------------------------------------------------------------------------------

/** The weather kind in force now, or null for clear skies (or no weather yet). */
export function currentWeather(state: SimState, config: SimConfig): WeatherKind | null {
  const id = state.weather?.kind ?? null;
  if (id === null) return null;
  return config.unlocks.weather?.kinds.find((kind) => kind.id === id) ?? null;
}

// ---- Gems and perks ---------------------------------------------------------------------------

export function findPerk(config: SimConfig, id: string): PerkRow | null {
  return config.unlocks.gems?.perks.find((perk) => perk.id === id) ?? null;
}

export function hasPerk(state: SimState, id: string): boolean {
  return state.perks?.includes(id) ?? false;
}

function perkProduct(state: SimState, config: SimConfig, type: 'production' | 'strike' | 'weather'): number {
  let product = 1;
  for (const id of state.perks ?? []) {
    const perk = findPerk(config, id);
    if (perk !== null && perk.effect.type === type) product *= perk.effect.value;
  }
  return product;
}

function thriftFactor(state: SimState, config: SimConfig): number {
  let factor = 1;
  for (const id of state.perks ?? []) {
    const perk = findPerk(config, id);
    if (perk !== null && perk.effect.type === 'thrift') factor *= perk.effect.value;
  }
  return factor;
}

/**
 * The gems pressing the pile now would give: the cube root of totalDust / dustPerGem, rounded down
 * (0 without gems). A cube root, so a long season pays more but never runs away: eight times the dust
 * for twice the gems.
 */
export function gemsForPress(state: SimState, config: SimConfig): number {
  const table = config.unlocks.gems;
  if (table === undefined) return 0;
  return Math.floor(Math.cbrt(state.totalDust / table.dustPerGem) + 1e-9);
}

/** The lifetime dust at which the next press would give one more gem. */
export function dustForNextGem(state: SimState, config: SimConfig): number | null {
  const table = config.unlocks.gems;
  if (table === undefined) return null;
  const next = gemsForPress(state, config) + 1;
  return next * next * next * table.dustPerGem;
}

/** Whether the gem layer shows: its unlock opened this season, or the pile was pressed before. */
export function gemsOpen(state: SimState, config: SimConfig): boolean {
  if (config.unlocks.gems === undefined) return false;
  if ((state.season ?? 0) > 0) return true;
  return config.unlocks.unlocks.some((row) => row.effect.type === 'gems' && isUnlocked(state, row.id));
}

export function canPress(state: SimState, config: SimConfig): boolean {
  return gemsOpen(state, config) && gemsForPress(state, config) >= 1;
}

export function canBuyPerk(state: SimState, config: SimConfig, id: string): boolean {
  const perk = findPerk(config, id);
  return perk !== null && !hasPerk(state, id) && (state.gems ?? 0) >= perk.cost;
}

/** What unspent gems multiply production by. */
export function gemBonus(state: SimState, config: SimConfig): number {
  const table = config.unlocks.gems;
  const gems = state.gems ?? 0;
  if (table === undefined || gems === 0) return 1;
  return 1 + table.bonusPerGem * gems;
}

// ---- Rates and costs --------------------------------------------------------------------------

/** One unit's own rate right now: its row's rate times its milestones and the weather on it. */
export function unitRate(state: SimState, config: SimConfig, unit: string): number {
  const row = findRow(config, unit);
  if (row === null) return 0;
  let rate = row.rate * milestoneFactor(config, ownedCount(state, unit));
  const weather = currentWeather(state, config);
  const boost = weather?.units[unit];
  if (boost !== undefined) rate *= boost;
  return rate;
}

/** Every multiplier on the whole of production: unlocks, weather, perks and unspent gems. */
export function productionMultiplier(state: SimState, config: SimConfig): number {
  let multiplier = 1;
  for (const event of state.unlocked) {
    const row = findUnlock(config, event.id);
    if (row !== null && row.effect.type === 'multiplier') multiplier *= row.effect.value;
  }
  if (state.weather !== undefined) {
    const weather = currentWeather(state, config);
    if (weather !== null) multiplier *= weather.all;
  }
  if (state.perks !== undefined) multiplier *= perkProduct(state, config, 'production');
  if (state.gems !== undefined) multiplier *= gemBonus(state, config);
  return multiplier;
}

export function ratePerSecond(state: SimState, config: SimConfig): number {
  let base = BASE_RATE;
  const layered = config.spawnTable.milestones !== undefined || state.weather !== undefined;
  for (const row of config.spawnTable.rows) {
    base += (layered ? unitRate(state, config, row.id) : row.rate) * ownedCount(state, row.id);
  }
  return base * productionMultiplier(state, config);
}

/** What every strike's yield is multiplied by: strike unlocks, the weather and perks. */
export function strikeMultiplier(state: SimState, config: SimConfig): number {
  let multiplier = 1;
  for (const event of state.unlocked) {
    const row = findUnlock(config, event.id);
    if (row !== null && row.effect.type === 'strike') multiplier *= row.effect.value;
  }
  const weather = currentWeather(state, config);
  if (weather !== null) multiplier *= weather.strike;
  if (state.perks !== undefined) multiplier *= perkProduct(state, config, 'strike');
  return multiplier;
}

export function costOf(state: SimState, config: SimConfig, unit: string): number {
  const row = findRow(config, unit);
  if (row === null) throw new Error(`Unknown unit "${unit}"`);
  const base = row.baseCost * Math.pow(COST_GROWTH, ownedCount(state, unit));
  return Math.round(state.perks === undefined ? base : base * thriftFactor(state, config));
}

export function nextLockedUnlock(state: SimState, config: SimConfig): UnlockRow | null {
  return config.unlocks.unlocks.find((row) => !isUnlocked(state, row.id)) ?? null;
}

function settleUnlocks(state: SimState, config: SimConfig): SimState {
  const reached: UnlockEvent[] = [];
  let weatherOpens = false;
  for (const row of config.unlocks.unlocks) {
    if (row.atTotalDust <= state.totalDust && !isUnlocked(state, row.id)) {
      reached.push({ id: row.id, atSeconds: state.elapsedSeconds });
      if (row.effect.type === 'weather') weatherOpens = true;
    }
  }
  if (reached.length === 0) return state;
  const settled: SimState = { ...state, unlocked: [...state.unlocked, ...reached] };
  // The first spell of weather comes a fixed while after its unlock, on a whole second, so the bot's
  // one-second steps land on every change of weather exactly.
  if (weatherOpens && state.weather === undefined && config.unlocks.weather !== undefined) {
    settled.weather = { kind: null, until: 0, next: Math.ceil(state.elapsedSeconds) + config.unlocks.weather.firstAfter };
  }
  return settled;
}

function gain(state: SimState, amount: number): SimState {
  return { ...state, dust: state.dust + amount, totalDust: state.totalDust + amount };
}

function plainStep(state: SimState, config: SimConfig, dtSeconds: number): SimState {
  const produced = ratePerSecond(state, config) * dtSeconds;
  const advanced = { ...gain(state, produced), elapsedSeconds: state.elapsedSeconds + dtSeconds };
  return settleUnlocks(advanced, config);
}

// Clear skies end in a spell picked by weight; a spell ends in clear skies for a rolled gap. Each
// change draws once from the seeded generator, so a replay lands on the same weather.
function turnWeather(state: SimState, config: SimConfig, weather: WeatherState): SimState {
  const table = config.unlocks.weather!;
  const draw = nextRandom(state.rngState);
  if (weather.kind !== null) {
    const gap = table.gapMin + Math.floor(draw.value * (table.gapMax - table.gapMin + 1));
    return { ...state, rngState: draw.state, weather: { kind: null, until: 0, next: weather.until + gap } };
  }
  const total = table.kinds.reduce((sum, kind) => sum + kind.weight, 0);
  let pick = draw.value * total;
  let chosen = table.kinds.find((kind) => kind.weight > 0)!;
  for (const kind of table.kinds) {
    if (kind.weight <= 0) continue;
    chosen = kind;
    if (pick < kind.weight) break;
    pick -= kind.weight;
  }
  const seconds = Math.max(1, Math.round(chosen.seconds * perkProduct(state, config, 'weather')));
  return { ...state, rngState: draw.state, weather: { kind: chosen.id, until: weather.next + seconds, next: 0 } };
}

function weatherBoundary(weather: WeatherState): number {
  return weather.kind !== null ? weather.until : weather.next;
}

function weatherUnlocked(state: SimState, config: SimConfig): boolean {
  return config.unlocks.unlocks.some((row) => row.effect.type === 'weather' && isUnlocked(state, row.id));
}

export function step(state: SimState, config: SimConfig, dtSeconds = 1): SimState {
  if (config.unlocks.weather === undefined) return plainStep(state, config, dtSeconds);
  // A state whose weather unlock is open but which has no weather yet (a seed or a save written by
  // hand, or a state from another config) starts its weather now, as the unlock would have.
  if (state.weather === undefined && weatherUnlocked(state, config)) {
    state = { ...state, weather: { kind: null, until: 0, next: Math.ceil(state.elapsedSeconds) + config.unlocks.weather.firstAfter } };
  }
  if (state.weather === undefined) return plainStep(state, config, dtSeconds);
  // With weather, the step splits at each change so production uses the weather in force for each
  // part. Boundaries are whole seconds, so a one-second step from a whole second splits exactly.
  let current = state;
  let left = dtSeconds;
  for (;;) {
    const weather = current.weather;
    if (weather === undefined) return plainStep(current, config, left);
    const boundary = weatherBoundary(weather);
    const span = boundary - current.elapsedSeconds;
    if (span > left) return plainStep(current, config, left);
    const part = Math.max(0, span);
    current = { ...plainStep(current, config, part), elapsedSeconds: Math.max(current.elapsedSeconds, boundary) };
    left -= part;
    current = turnWeather(current, config, current.weather!);
    if (left <= 0) return current;
  }
}

// A strike hands over between one and two seconds of production (the draw is
// in [0, 1), so the yield is in [rate, 2 x rate)), rolled on the seeded
// generator so a replay with the same inputs lands identically, then times
// the strike multiplier (strike unlocks, weather and perks; 1 without them).
export function strikeYield(state: SimState, config: SimConfig): { rngState: number; amount: number } {
  const draw = nextRandom(state.rngState);
  return { rngState: draw.state, amount: ratePerSecond(state, config) * (1 + draw.value) * strikeMultiplier(state, config) };
}

/** A new season: dust, units, unlocks and weather start over; gems, perks and the clock carry on. */
function press(state: SimState, config: SimConfig): SimState {
  if (!canPress(state, config)) return state;
  const owned = freshOwned(config);
  for (const id of state.perks ?? []) {
    const perk = findPerk(config, id);
    if (perk !== null && perk.effect.type === 'start') owned[perk.effect.unit] = (owned[perk.effect.unit] ?? 0) + perk.effect.count;
  }
  return {
    seed: state.seed,
    rngState: state.rngState,
    elapsedSeconds: state.elapsedSeconds,
    dust: 0,
    totalDust: 0,
    owned,
    unlocked: [],
    gems: (state.gems ?? 0) + gemsForPress(state, config),
    perks: [...(state.perks ?? [])],
    season: (state.season ?? 0) + 1,
    pastDust: (state.pastDust ?? 0) + state.totalDust,
  };
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
    case 'press':
      return press(state, config);
    case 'perk': {
      if (!canBuyPerk(state, config, action.perk)) return state;
      const perk = findPerk(config, action.perk)!;
      return { ...state, gems: (state.gems ?? 0) - perk.cost, perks: [...(state.perks ?? []), perk.id] };
    }
  }
}
