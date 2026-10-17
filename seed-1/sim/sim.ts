import { nextRandom, seedRng } from './rng';
import type {
  DevilState,
  ForkEffect,
  ForkOption,
  OrderKind,
  OrderState,
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
// The layers after the units (milestones, weather, gems and perks, forks, orders and dust devils) are
// optional in the config. A
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

// ---- Forks ------------------------------------------------------------------------------------

/** A fork unlock's options, or null for an unlock that is not a fork. */
export function forkOptions(row: UnlockRow): readonly ForkOption[] | null {
  return row.effect.type === 'fork' ? row.effect.options : null;
}

/** The option chosen at a fork this season, or null while it is still open (or for no such fork). */
export function chosenOption(state: SimState, config: SimConfig, unlock: string): ForkOption | null {
  const id = state.chosen?.[unlock];
  if (id === undefined) return null;
  const row = findUnlock(config, unlock);
  return row === null ? null : (forkOptions(row)?.find((option) => option.id === id) ?? null);
}

/** The forks reached this season and not yet chosen, in the order they opened. */
export function pendingForks(state: SimState, config: SimConfig): UnlockRow[] {
  const pending: UnlockRow[] = [];
  for (const event of state.unlocked) {
    const row = findUnlock(config, event.id);
    if (row !== null && row.effect.type === 'fork' && state.chosen?.[row.id] === undefined) pending.push(row);
  }
  return pending;
}

function chosenEffects(state: SimState, config: SimConfig): ForkEffect[] {
  const effects: ForkEffect[] = [];
  if (state.chosen === undefined) return effects;
  for (const unlock of Object.keys(state.chosen)) {
    const option = chosenOption(state, config, unlock);
    if (option !== null) effects.push(option.effect);
  }
  return effects;
}

/** What the forks chosen this season multiply one kind of thing by (1 with none chosen). */
export function forkProduct(state: SimState, config: SimConfig, type: 'multiplier' | 'strike' | 'weather' | 'devil' | 'order'): number {
  let product = 1;
  for (const effect of chosenEffects(state, config)) if (effect.type === type) product *= effect.value;
  return product;
}

function forkUnit(state: SimState, config: SimConfig, unit: string): number {
  let product = 1;
  for (const effect of chosenEffects(state, config)) if (effect.type === 'unit' && effect.unit === unit) product *= effect.value;
  return product;
}

// ---- Orders -----------------------------------------------------------------------------------

/** Whether orders are open: their unlock has opened this season. */
export function ordersOpen(state: SimState, config: SimConfig): boolean {
  const table = config.unlocks.orders;
  return table !== undefined && isUnlocked(state, table.opensAt);
}

/** What filled orders add to production, for good: 1 + bonusPerOrder for each one filled, up to bonusCap. */
export function orderBonus(state: SimState, config: SimConfig): number {
  const table = config.unlocks.orders;
  const filled = state.ordersFilled ?? 0;
  if (table === undefined || filled === 0) return 1;
  return 1 + table.bonusPerOrder * Math.min(filled, table.bonusCap);
}

/** The seconds until the order on the board can be filled (0 when it can be now, or there is none). */
export function orderRest(state: SimState): number {
  const from = state.order?.from;
  return from === undefined ? 0 : Math.max(0, Math.ceil(from - state.elapsedSeconds));
}

/** How far along the order on the board is: what the player has now and what it asks for. */
export function orderProgress(state: SimState): { have: number; need: number } | null {
  const order = state.order;
  if (order === undefined) return null;
  if (order.type === 'own') return { have: ownedCount(state, order.unit ?? ''), need: order.target };
  return { have: order.progress ?? 0, need: order.target };
}

/** Whether the order on the board asks for no more than the player has. */
export function orderFilled(state: SimState): boolean {
  const progress = orderProgress(state);
  return progress !== null && progress.have >= progress.need;
}

/** Whether the order on the board can be filled now: it is met and its rest is over. */
export function canFill(state: SimState, config: SimConfig): boolean {
  return ordersOpen(state, config) && orderFilled(state) && orderRest(state) === 0;
}

/** The dust filling the order on the board pays now: rewardSeconds of production, times order forks. */
export function orderReward(state: SimState, config: SimConfig): number {
  const table = config.unlocks.orders;
  if (table === undefined) return 0;
  return table.rewardSeconds * ratePerSecond(state, config) * forkProduct(state, config, 'order');
}

// What `count` more of a unit cost from what is owned now, with every perk on the price.
function costOfMore(state: SimState, config: SimConfig, row: SpawnRow, count: number): number {
  let total = 0;
  const owned = ownedCount(state, row.id);
  for (let i = 0; i < count; i += 1) {
    const base = row.baseCost * Math.pow(COST_GROWTH, owned + i);
    total += Math.round(state.perks === undefined ? base : base * thriftFactor(state, config));
  }
  return total;
}

function pickWeighted<T extends { weight: number }>(rows: readonly T[], value: number): T {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.weight), 0);
  let pick = value * total;
  let chosen = rows.find((row) => row.weight > 0)!;
  for (const row of rows) {
    if (row.weight <= 0) continue;
    chosen = row;
    if (pick < row.weight) break;
    pick -= row.weight;
  }
  return chosen;
}

// A new order, sized to the island as it stands: three draws on the seeded generator, always three,
// so a replay lands on the same order. An own order asks only for a unit the player could afford
// within `budget` seconds of production; with none such it becomes a gather order.
function drawOrder(state: SimState, config: SimConfig, from?: number): SimState {
  const table = config.unlocks.orders!;
  const kindDraw = nextRandom(state.rngState);
  const sizeDraw = nextRandom(kindDraw.state);
  const unitDraw = nextRandom(sizeDraw.state);
  let kind: OrderKind = pickWeighted(table.kinds, kindDraw.value);
  const size = (k: OrderKind): number => k.min + Math.floor(sizeDraw.value * (k.max - k.min + 1));
  const rate = ratePerSecond(state, config);
  const budget = rate * table.budget;
  let order: OrderState | null = null;
  if (kind.type === 'own') {
    const candidates = availableUnits(state, config).filter((row) => costOfMore(state, config, row, 1) <= budget);
    if (candidates.length > 0) {
      const row = candidates[Math.min(candidates.length - 1, Math.floor(unitDraw.value * candidates.length))]!;
      let count = size(kind);
      while (count > 1 && costOfMore(state, config, row, count) > budget) count -= 1;
      order = { type: 'own', unit: row.id, target: ownedCount(state, row.id) + count };
    } else {
      kind = table.kinds.find((k) => k.type === 'gather') ?? { type: 'gather', weight: 1, min: 30, max: 60 };
    }
  }
  if (order === null && kind.type === 'strikes') order = { type: 'strikes', target: size(kind), progress: 0 };
  if (order === null) order = { type: 'gather', target: Math.ceil(Math.max(1, rate * size(kind))), progress: 0 };
  if (from !== undefined) order.from = from;
  return { ...state, rngState: unitDraw.state, order };
}

// ---- Dust devils ------------------------------------------------------------------------------

/** Whether a dust devil is on the island now. */
export function devilHere(state: SimState): boolean {
  const devil = state.devil;
  return devil !== undefined && devil.until > state.elapsedSeconds;
}

/** Whether the whirl from a caught dust devil is still blowing. */
export function whirling(state: SimState): boolean {
  const devil = state.devil;
  return devil !== undefined && devil.whirlUntil > state.elapsedSeconds;
}

/** The dust catching the devil on the island pays now: rewardSeconds of production, times devil forks. */
export function devilReward(state: SimState, config: SimConfig): number {
  const table = config.unlocks.devils;
  if (table === undefined) return 0;
  return table.rewardSeconds * ratePerSecond(state, config) * forkProduct(state, config, 'devil');
}

function devilsUnlocked(state: SimState, config: SimConfig): boolean {
  const table = config.unlocks.devils;
  return table !== undefined && isUnlocked(state, table.opensAt);
}

function firstDevil(state: SimState, config: SimConfig): DevilState {
  return { until: 0, next: Math.ceil(state.elapsedSeconds) + config.unlocks.devils!.firstAfter, whirlUntil: 0 };
}

function devilGap(config: SimConfig, value: number): number {
  const table = config.unlocks.devils!;
  return table.gapMin + Math.floor(value * (table.gapMax - table.gapMin + 1));
}

// A devil arrives at `next` and stays `lasts` seconds; one that leaves uncaught draws the gap to the
// next on the seeded generator.
function turnDevil(state: SimState, config: SimConfig, devil: DevilState): SimState {
  if (devil.until > 0) {
    const draw = nextRandom(state.rngState);
    return { ...state, rngState: draw.state, devil: { ...devil, until: 0, next: devil.until + devilGap(config, draw.value) } };
  }
  return { ...state, devil: { ...devil, until: devil.next + config.unlocks.devils!.lasts, next: 0 } };
}

function devilBoundary(devil: DevilState): number {
  return devil.until > 0 ? devil.until : devil.next;
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
  if (state.chosen !== undefined) rate *= forkUnit(state, config, unit);
  return rate;
}

/** Every multiplier on the whole of production: unlocks, weather, perks, unspent gems, forks and orders filled. */
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
  if (state.chosen !== undefined) multiplier *= forkProduct(state, config, 'multiplier');
  if (state.ordersFilled !== undefined) multiplier *= orderBonus(state, config);
  return multiplier;
}

export function ratePerSecond(state: SimState, config: SimConfig): number {
  let base = BASE_RATE;
  const layered = config.spawnTable.milestones !== undefined || state.weather !== undefined || state.chosen !== undefined;
  for (const row of config.spawnTable.rows) {
    base += (layered ? unitRate(state, config, row.id) : row.rate) * ownedCount(state, row.id);
  }
  return base * productionMultiplier(state, config);
}

/** What every strike's yield is multiplied by: strike unlocks, the weather, perks, forks and a devil's whirl. */
export function strikeMultiplier(state: SimState, config: SimConfig): number {
  let multiplier = 1;
  for (const event of state.unlocked) {
    const row = findUnlock(config, event.id);
    if (row !== null && row.effect.type === 'strike') multiplier *= row.effect.value;
  }
  const weather = currentWeather(state, config);
  if (weather !== null) multiplier *= weather.strike;
  if (state.perks !== undefined) multiplier *= perkProduct(state, config, 'strike');
  if (state.chosen !== undefined) multiplier *= forkProduct(state, config, 'strike');
  if (state.devil !== undefined && whirling(state)) multiplier *= config.unlocks.devils?.whirlStrike ?? 1;
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
  return startLayers(settled, config);
}

// Orders and dust devils start at their opening unlock. A state that has the unlock but not the layer
// (a seed or a save from before the layer existed) starts it the next time the sim steps, as the
// unlock would have.
function startLayers(state: SimState, config: SimConfig): SimState {
  let out = state;
  if (out.devil === undefined && devilsUnlocked(out, config)) out = { ...out, devil: firstDevil(out, config) };
  if (out.order === undefined && ordersOpen(out, config)) out = drawOrder(out, config);
  return out;
}

// Dust gained, from production, a strike or a reward. A gather order counts it too.
function gain(state: SimState, amount: number): SimState {
  const gained = { ...state, dust: state.dust + amount, totalDust: state.totalDust + amount };
  const order = state.order;
  if (order !== undefined && order.type === 'gather') gained.order = { ...order, progress: (order.progress ?? 0) + amount };
  return gained;
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
  const chosen = pickWeighted(table.kinds, draw.value);
  const lasting = perkProduct(state, config, 'weather') * (state.chosen === undefined ? 1 : forkProduct(state, config, 'weather'));
  const seconds = Math.max(1, Math.round(chosen.seconds * lasting));
  return { ...state, rngState: draw.state, weather: { kind: chosen.id, until: weather.next + seconds, next: 0 } };
}

function weatherBoundary(weather: WeatherState): number {
  return weather.kind !== null ? weather.until : weather.next;
}

function weatherUnlocked(state: SimState, config: SimConfig): boolean {
  return config.unlocks.unlocks.some((row) => row.effect.type === 'weather' && isUnlocked(state, row.id));
}

// The next whole second at which the weather or a dust devil changes, or Infinity for none.
function nextBoundary(state: SimState): number {
  let boundary = Infinity;
  if (state.weather !== undefined) boundary = weatherBoundary(state.weather);
  if (state.devil !== undefined) boundary = Math.min(boundary, devilBoundary(state.devil));
  return boundary;
}

// Every change due at `boundary`, the weather's first, so the seeded draws come in one order however
// the time is stepped.
function turnAt(state: SimState, config: SimConfig, boundary: number): SimState {
  let out = state;
  if (out.weather !== undefined && weatherBoundary(out.weather) <= boundary) out = turnWeather(out, config, out.weather);
  if (out.devil !== undefined && devilBoundary(out.devil) <= boundary) out = turnDevil(out, config, out.devil);
  return out;
}

export function step(state: SimState, config: SimConfig, dtSeconds = 1): SimState {
  const table = config.unlocks;
  if (table.weather === undefined && table.devils === undefined && table.orders === undefined) return plainStep(state, config, dtSeconds);
  // A state whose weather unlock is open but which has no weather yet (a seed or a save written by
  // hand, or a state from another config) starts its weather now, as the unlock would have.
  if (table.weather !== undefined && state.weather === undefined && weatherUnlocked(state, config)) {
    state = { ...state, weather: { kind: null, until: 0, next: Math.ceil(state.elapsedSeconds) + table.weather.firstAfter } };
  }
  state = startLayers(state, config);
  // The step splits at each change of weather and each coming and going of a dust devil, so
  // production uses the weather in force for each part and the draws land in time order. Boundaries
  // are whole seconds, so a one-second step from a whole second splits exactly.
  let current = state;
  let left = dtSeconds;
  for (;;) {
    const boundary = nextBoundary(current);
    const span = boundary - current.elapsedSeconds;
    if (!(span <= left)) return plainStep(current, config, left);
    const part = Math.max(0, span);
    current = { ...plainStep(current, config, part), elapsedSeconds: Math.max(current.elapsedSeconds, boundary) };
    left -= part;
    current = turnAt(current, config, boundary);
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
    // Forks, the order on the board and the dust devils start over with the season; orders filled stay.
    ...(state.ordersFilled === undefined ? {} : { ordersFilled: state.ordersFilled }),
  };
}

function choose(state: SimState, config: SimConfig, unlock: string, option: string): SimState {
  if (!isUnlocked(state, unlock) || state.chosen?.[unlock] !== undefined) return state;
  const row = findUnlock(config, unlock);
  const options = row === null ? null : forkOptions(row);
  if (options === null || !options.some((candidate) => candidate.id === option)) return state;
  return { ...state, chosen: { ...state.chosen, [unlock]: option } };
}

function strikeOrder(state: SimState): SimState {
  const order = state.order;
  if (order === undefined || order.type !== 'strikes') return state;
  return { ...state, order: { ...order, progress: (order.progress ?? 0) + 1 } };
}

export function apply(state: SimState, config: SimConfig, action: SimAction): SimState {
  switch (action.type) {
    case 'strike': {
      const roll = strikeYield(state, config);
      return settleUnlocks(strikeOrder({ ...gain(state, roll.amount), rngState: roll.rngState }), config);
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
    case 'choose':
      return choose(state, config, action.unlock, action.option);
    case 'fill': {
      if (!canFill(state, config)) return state;
      const paid = { ...gain(state, orderReward(state, config)), ordersFilled: (state.ordersFilled ?? 0) + 1 };
      const rest = config.unlocks.orders!.rest;
      return settleUnlocks(drawOrder(paid, config, rest > 0 ? state.elapsedSeconds + rest : undefined), config);
    }
    case 'swap':
      if (!ordersOpen(state, config) || state.order === undefined || orderFilled(state)) return state;
      return drawOrder(state, config, state.order.from);
    case 'catch': {
      const table = config.unlocks.devils;
      if (table === undefined || !devilHere(state)) return state;
      const draw = nextRandom(state.rngState);
      const paid = gain(state, devilReward(state, config));
      const devil: DevilState = {
        until: 0,
        next: Math.ceil(state.elapsedSeconds) + devilGap(config, draw.value),
        whirlUntil: state.elapsedSeconds + table.whirlSeconds,
      };
      return settleUnlocks({ ...paid, rngState: draw.state, devil }, config);
    }
  }
}
