export interface SpawnRow {
  id: string;
  name: string;
  baseCost: number;
  rate: number;
}

// Milestones (optional): owning `at[i]` of one unit multiplies that unit's rate by `factor` once more.
export interface MilestoneTable {
  at: number[];
  factor: number;
}

export interface SpawnTable {
  rows: SpawnRow[];
  milestones?: MilestoneTable;
}

// What one side of a fork does once chosen: all production, every strike, one unit's rate, how long
// the weather lasts, what a caught dust devil gives, or what a filled order pays.
export type ForkEffect =
  | { type: 'multiplier'; value: number }
  | { type: 'strike'; value: number }
  | { type: 'unit'; unit: string; value: number }
  | { type: 'weather'; value: number }
  | { type: 'devil'; value: number }
  | { type: 'order'; value: number };

export interface ForkOption {
  id: string;
  name: string;
  effect: ForkEffect;
}

// unit opens a unit; multiplier raises all production; strike raises every strike's yield; weather
// starts the island's weather (WeatherTable); gems opens pressing the pile into gems (GemTable); fork
// asks the player to choose one of its options, which lasts the season (SimState.chosen).
export type UnlockEffect =
  | { type: 'unit'; unit: string }
  | { type: 'multiplier'; value: number }
  | { type: 'strike'; value: number }
  | { type: 'weather' }
  | { type: 'gems' }
  | { type: 'fork'; options: ForkOption[] };

export interface UnlockRow {
  id: string;
  name: string;
  atTotalDust: number;
  effect: UnlockEffect;
}

// One kind of weather: how long it lasts, how often it is picked (weight), and what it multiplies while
// it lasts: all production, every strike, or named units' rates.
export interface WeatherKind {
  id: string;
  name: string;
  seconds: number;
  weight: number;
  all: number;
  strike: number;
  units: Record<string, number>;
}

// Weather (optional): once its unlock opens, the first spell starts `firstAfter` seconds later and each
// clear spell between two kinds lasts a whole number of seconds from gapMin to gapMax, rolled on the
// sim's seeded generator.
export interface WeatherTable {
  firstAfter: number;
  gapMin: number;
  gapMax: number;
  kinds: WeatherKind[];
}

export type PerkEffect =
  | { type: 'production'; value: number }
  | { type: 'strike'; value: number }
  | { type: 'start'; unit: string; count: number }
  | { type: 'weather'; value: number }
  | { type: 'thrift'; value: number };

export interface PerkRow {
  id: string;
  name: string;
  cost: number;
  effect: PerkEffect;
}

// Gems (optional), the rebirth layer: pressing the pile ends the season for floor(cbrt(totalDust /
// dustPerGem)) gems. Dust, units and unlocks start over; gems and perks stay. Every unspent gem adds
// bonusPerGem to production; perks cost gems and last for good.
export interface GemTable {
  dustPerGem: number;
  bonusPerGem: number;
  perks: PerkRow[];
}

// One kind of order the island can place. own: own `min` to `max` more of one unit the player can
// afford within `budget` seconds of production; gather: gather `min` to `max` seconds of production
// more lifetime dust; strikes: strike `min` to `max` times.
export interface OrderKind {
  type: 'own' | 'gather' | 'strikes';
  weight: number;
  min: number;
  max: number;
}

// Orders (optional), the mid-session goals: from the unlock `opensAt`, one order is on the board at a
// time, drawn on the seeded generator. Filling it pays `rewardSeconds` of production at once and adds
// `bonusPerOrder` to production for good, for up to `bonusCap` orders; the next one is drawn at once
// and can be filled `rest` seconds later. Swapping an order draws another.
export interface OrderTable {
  opensAt: string;
  rewardSeconds: number;
  bonusPerOrder: number;
  bonusCap: number;
  budget: number;
  rest: number;
  kinds: OrderKind[];
}

// Dust devils (optional), the rare event: from the unlock `opensAt`, the first devil spins onto the
// island `firstAfter` seconds later and stays `lasts` seconds; the next comes a whole number of seconds
// from gapMin to gapMax after one leaves or is caught. Catching one pays `rewardSeconds` of production
// and whirls every strike by `whirlStrike` for `whirlSeconds`.
export interface DevilTable {
  opensAt: string;
  firstAfter: number;
  gapMin: number;
  gapMax: number;
  lasts: number;
  rewardSeconds: number;
  whirlSeconds: number;
  whirlStrike: number;
}

export interface UnlockTable {
  unlocks: UnlockRow[];
  weather?: WeatherTable;
  gems?: GemTable;
  orders?: OrderTable;
  devils?: DevilTable;
}

export interface SimConfig {
  spawnTable: SpawnTable;
  unlocks: UnlockTable;
}

export interface UnlockEvent {
  id: string;
  atSeconds: number;
}

// The weather now: `kind` is the spell in force until `until`, or null for clear skies until `next`.
export interface WeatherState {
  kind: string | null;
  until: number;
  next: number;
}

// The order on the board: what it asks for, the number to reach (units owned, lifetime dust or
// strikes), for strikes how many have landed since it was placed, and the second it can be filled from.
export interface OrderState {
  type: OrderKind['type'];
  unit?: string;
  target: number;
  progress?: number;
  from?: number;
}

// The dust devils: `until` above 0 means one is on the island until then; otherwise the next one comes
// at `next`. `whirlUntil` is when the whirl from the last one caught ends (strikes multiplied till then).
export interface DevilState {
  until: number;
  next: number;
  whirlUntil: number;
}

// The optional fields are absent until their layer starts (weather at its unlock, the gem fields at
// the first press), so a state from a config without those layers hashes exactly as before
// (tests/timeline.test.ts pins that hash).
export interface SimState {
  seed: number;
  rngState: number;
  elapsedSeconds: number;
  dust: number;
  totalDust: number;
  owned: Readonly<Record<string, number>>;
  unlocked: readonly UnlockEvent[];
  weather?: WeatherState;
  /** Unspent gems. */
  gems?: number;
  /** Perks bought, in order. */
  perks?: readonly string[];
  /** How many times the pile has been pressed. */
  season?: number;
  /** Lifetime dust of every season before this one. */
  pastDust?: number;
  /** The forks chosen this season: the fork unlock's id to the option's id. */
  chosen?: Readonly<Record<string, string>>;
  /** The order on the board, from its opening unlock. */
  order?: OrderState;
  /** Orders filled, across every season. */
  ordersFilled?: number;
  /** The dust devils, from their opening unlock. */
  devil?: DevilState;
}

export type SimAction =
  | { type: 'strike' }
  | { type: 'buy'; unit: string }
  | { type: 'press' }
  | { type: 'perk'; perk: string }
  | { type: 'choose'; unlock: string; option: string }
  | { type: 'fill' }
  | { type: 'swap' }
  | { type: 'catch' };
