export interface SpawnRow {
  id: string;
  name: string;
  baseCost: number;
  rate: number;
}

export interface SpawnTable {
  rows: SpawnRow[];
}

export type UnlockEffect =
  | { type: 'unit'; unit: string }
  | { type: 'multiplier'; value: number };

export interface UnlockRow {
  id: string;
  name: string;
  atTotalDust: number;
  effect: UnlockEffect;
}

export interface UnlockTable {
  unlocks: UnlockRow[];
}

export interface SimConfig {
  spawnTable: SpawnTable;
  unlocks: UnlockTable;
}

export interface UnlockEvent {
  id: string;
  atSeconds: number;
}

export interface SimState {
  seed: number;
  rngState: number;
  elapsedSeconds: number;
  dust: number;
  totalDust: number;
  owned: Readonly<Record<string, number>>;
  unlocked: readonly UnlockEvent[];
}

export type SimAction = { type: 'strike' } | { type: 'buy'; unit: string };
