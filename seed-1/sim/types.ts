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

// unit opens a unit; multiplier raises all production; strike raises every strike's yield; weather
// starts the island's weather (WeatherTable); gems opens pressing the pile into gems (GemTable).
export type UnlockEffect =
  | { type: 'unit'; unit: string }
  | { type: 'multiplier'; value: number }
  | { type: 'strike'; value: number }
  | { type: 'weather' }
  | { type: 'gems' };

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

export interface UnlockTable {
  unlocks: UnlockRow[];
  weather?: WeatherTable;
  gems?: GemTable;
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
}

export type SimAction =
  | { type: 'strike' }
  | { type: 'buy'; unit: string }
  | { type: 'press' }
  | { type: 'perk'; perk: string };
