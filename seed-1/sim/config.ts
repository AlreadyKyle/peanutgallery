import type {
  DevilTable,
  ForkEffect,
  ForkOption,
  GemTable,
  MilestoneTable,
  OrderKind,
  OrderTable,
  PerkEffect,
  PerkRow,
  SimConfig,
  SpawnRow,
  SpawnTable,
  UnlockEffect,
  UnlockRow,
  UnlockTable,
  WeatherKind,
  WeatherTable,
} from './types';

// Validates raw JSON (from disk or fetch) into a SimConfig, throwing a plain
// Error that names the offending field. Unlock rows come back sorted by
// threshold so unlocks always resolve in ascending order.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string, where: string, min: number): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${where}: "${key}" must be a finite number of at least ${min}`);
  }
  return value;
}

function requireArray(record: Record<string, unknown>, key: string, where: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${where}: "${key}" must be a non-empty array`);
  }
  return value;
}

function parseSpawnRow(raw: unknown, index: number): SpawnRow {
  const where = `spawn-table rows[${index}]`;
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  return {
    id: requireString(raw, 'id', where),
    name: requireString(raw, 'name', where),
    baseCost: requireNumber(raw, 'baseCost', where, 1),
    rate: requireNumber(raw, 'rate', where, 0),
  };
}

function parseEffect(raw: unknown, where: string, unitIds: Set<string>): UnlockEffect {
  if (!isRecord(raw)) throw new Error(`${where}: "effect" must be an object`);
  const type = raw['type'];
  if (type === 'unit') {
    const unit = requireString(raw, 'unit', where);
    if (!unitIds.has(unit)) throw new Error(`${where}: effect names an unknown unit "${unit}"`);
    return { type: 'unit', unit };
  }
  if (type === 'multiplier') {
    return { type: 'multiplier', value: requireNumber(raw, 'value', where, 1) };
  }
  if (type === 'strike') {
    return { type: 'strike', value: requireNumber(raw, 'value', where, 1) };
  }
  if (type === 'weather') return { type: 'weather' };
  if (type === 'gems') return { type: 'gems' };
  if (type === 'fork') return { type: 'fork', options: parseForkOptions(raw, where, unitIds) };
  throw new Error(`${where}: effect type must be "unit", "multiplier", "strike", "weather", "gems" or "fork"`);
}

function parseForkEffect(raw: unknown, where: string, unitIds: Set<string>): ForkEffect {
  if (!isRecord(raw)) throw new Error(`${where}: "effect" must be an object`);
  const type = raw['type'];
  if (type === 'multiplier' || type === 'strike' || type === 'weather' || type === 'devil' || type === 'order') {
    return { type, value: requireNumber(raw, 'value', where, 1) };
  }
  if (type === 'unit') {
    const unit = requireString(raw, 'unit', where);
    if (!unitIds.has(unit)) throw new Error(`${where}: effect names an unknown unit "${unit}"`);
    return { type, unit, value: requireNumber(raw, 'value', where, 1) };
  }
  throw new Error(`${where}: a fork option's effect type must be "multiplier", "strike", "unit", "weather", "devil" or "order"`);
}

// A fork offers two or three options; the player picks one, and it lasts the season.
function parseForkOptions(raw: Record<string, unknown>, where: string, unitIds: Set<string>): ForkOption[] {
  const options = requireArray(raw, 'options', where).map((option, index) => {
    const at = `${where} options[${index}]`;
    if (!isRecord(option)) throw new Error(`${at}: must be an object`);
    return { id: requireString(option, 'id', at), name: requireString(option, 'name', at), effect: parseForkEffect(option['effect'], at, unitIds) };
  });
  if (options.length < 2 || options.length > 3) throw new Error(`${where}: a fork offers two or three options`);
  assertUniqueIds(options.map((option) => option.id), `${where} options`);
  return options;
}

function parseUnlockRow(raw: unknown, index: number, unitIds: Set<string>): UnlockRow {
  const where = `unlocks[${index}]`;
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  return {
    id: requireString(raw, 'id', where),
    name: requireString(raw, 'name', where),
    atTotalDust: requireNumber(raw, 'atTotalDust', where, 1),
    effect: parseEffect(raw['effect'], where, unitIds),
  };
}

function assertUniqueIds(ids: string[], where: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${where}: duplicate id "${id}"`);
    seen.add(id);
  }
}

function requireInteger(record: Record<string, unknown>, key: string, where: string, min: number): number {
  const value = requireNumber(record, key, where, min);
  if (!Number.isInteger(value)) throw new Error(`${where}: "${key}" must be a whole number`);
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string, where: string, min: number, fallback: number): number {
  return record[key] === undefined ? fallback : requireNumber(record, key, where, min);
}

function parseMilestones(raw: unknown): MilestoneTable {
  const where = 'spawn-table milestones';
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  const at = requireArray(raw, 'at', where).map((value, index) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`${where}: "at[${index}]" must be a whole number of at least 1`);
    return value;
  });
  for (let i = 1; i < at.length; i += 1) {
    if (at[i]! <= at[i - 1]!) throw new Error(`${where}: "at" must rise`);
  }
  return { at, factor: requireNumber(raw, 'factor', where, 1) };
}

export function parseSpawnTable(raw: unknown): SpawnTable {
  if (!isRecord(raw)) throw new Error('spawn-table: must be an object');
  const rows = requireArray(raw, 'rows', 'spawn-table').map(parseSpawnRow);
  assertUniqueIds(rows.map((row) => row.id), 'spawn-table');
  if (raw['milestones'] === undefined) return { rows };
  return { rows, milestones: parseMilestones(raw['milestones']) };
}

function parseWeatherKind(raw: unknown, index: number, unitIds: Set<string>): WeatherKind {
  const where = `weather kinds[${index}]`;
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  const units: Record<string, number> = {};
  const unitsRaw = raw['units'];
  if (unitsRaw !== undefined) {
    if (!isRecord(unitsRaw)) throw new Error(`${where}: "units" must be an object`);
    for (const id of Object.keys(unitsRaw)) {
      if (!unitIds.has(id)) throw new Error(`${where}: names an unknown unit "${id}"`);
      units[id] = requireNumber(unitsRaw, id, `${where} units`, 0);
    }
  }
  return {
    id: requireString(raw, 'id', where),
    name: requireString(raw, 'name', where),
    seconds: requireInteger(raw, 'seconds', where, 1),
    weight: requireNumber(raw, 'weight', where, 0),
    all: optionalNumber(raw, 'all', where, 0, 1),
    strike: optionalNumber(raw, 'strike', where, 0, 1),
    units,
  };
}

function parseWeather(raw: unknown, unitIds: Set<string>): WeatherTable {
  const where = 'unlocks weather';
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  const kinds = requireArray(raw, 'kinds', where).map((kind, index) => parseWeatherKind(kind, index, unitIds));
  assertUniqueIds(kinds.map((kind) => kind.id), where);
  if (!kinds.some((kind) => kind.weight > 0)) throw new Error(`${where}: at least one kind needs a weight above 0`);
  const gapMin = requireInteger(raw, 'gapMin', where, 1);
  const gapMax = requireInteger(raw, 'gapMax', where, gapMin);
  return { firstAfter: requireInteger(raw, 'firstAfter', where, 1), gapMin, gapMax, kinds };
}

function parsePerkEffect(raw: unknown, where: string, unitIds: Set<string>): PerkEffect {
  if (!isRecord(raw)) throw new Error(`${where}: "effect" must be an object`);
  const type = raw['type'];
  if (type === 'production' || type === 'strike' || type === 'weather') return { type, value: requireNumber(raw, 'value', where, 1) };
  if (type === 'thrift') {
    const value = requireNumber(raw, 'value', where, 0.01);
    if (value > 1) throw new Error(`${where}: a thrift "value" is a cost factor of at most 1`);
    return { type, value };
  }
  if (type === 'start') {
    const unit = requireString(raw, 'unit', where);
    if (!unitIds.has(unit)) throw new Error(`${where}: effect names an unknown unit "${unit}"`);
    return { type, unit, count: requireInteger(raw, 'count', where, 1) };
  }
  throw new Error(`${where}: perk effect type must be "production", "strike", "start", "weather" or "thrift"`);
}

function parseGems(raw: unknown, unitIds: Set<string>): GemTable {
  const where = 'unlocks gems';
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  const perks: PerkRow[] = requireArray(raw, 'perks', where).map((perk, index) => {
    const at = `gems perks[${index}]`;
    if (!isRecord(perk)) throw new Error(`${at}: must be an object`);
    return {
      id: requireString(perk, 'id', at),
      name: requireString(perk, 'name', at),
      cost: requireInteger(perk, 'cost', at, 1),
      effect: parsePerkEffect(perk['effect'], at, unitIds),
    };
  });
  assertUniqueIds(perks.map((perk) => perk.id), where);
  return { dustPerGem: requireNumber(raw, 'dustPerGem', where, 1), bonusPerGem: requireNumber(raw, 'bonusPerGem', where, 0), perks };
}

function parseOrderKind(raw: unknown, index: number): OrderKind {
  const where = `orders kinds[${index}]`;
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  const type = raw['type'];
  if (type !== 'own' && type !== 'gather' && type !== 'strikes') throw new Error(`${where}: "type" must be "own", "gather" or "strikes"`);
  const min = requireInteger(raw, 'min', where, 1);
  return { type, weight: requireNumber(raw, 'weight', where, 0), min, max: requireInteger(raw, 'max', where, min) };
}

function parseOrders(raw: unknown, unlockIds: Set<string>): OrderTable {
  const where = 'unlocks orders';
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  const opensAt = requireString(raw, 'opensAt', where);
  if (!unlockIds.has(opensAt)) throw new Error(`${where}: "opensAt" names an unknown unlock "${opensAt}"`);
  const kinds = requireArray(raw, 'kinds', where).map(parseOrderKind);
  if (!kinds.some((kind) => kind.weight > 0)) throw new Error(`${where}: at least one kind needs a weight above 0`);
  return {
    opensAt,
    rewardSeconds: requireNumber(raw, 'rewardSeconds', where, 0),
    bonusPerOrder: requireNumber(raw, 'bonusPerOrder', where, 0),
    budget: requireNumber(raw, 'budget', where, 1),
    kinds,
  };
}

function parseDevils(raw: unknown, unlockIds: Set<string>): DevilTable {
  const where = 'unlocks devils';
  if (!isRecord(raw)) throw new Error(`${where}: must be an object`);
  const opensAt = requireString(raw, 'opensAt', where);
  if (!unlockIds.has(opensAt)) throw new Error(`${where}: "opensAt" names an unknown unlock "${opensAt}"`);
  const gapMin = requireInteger(raw, 'gapMin', where, 1);
  return {
    opensAt,
    firstAfter: requireInteger(raw, 'firstAfter', where, 1),
    gapMin,
    gapMax: requireInteger(raw, 'gapMax', where, gapMin),
    lasts: requireInteger(raw, 'lasts', where, 1),
    rewardSeconds: requireNumber(raw, 'rewardSeconds', where, 0),
    whirlSeconds: requireInteger(raw, 'whirlSeconds', where, 0),
    whirlStrike: requireNumber(raw, 'whirlStrike', where, 1),
  };
}

export function parseUnlockTable(raw: unknown, spawnTable: SpawnTable): UnlockTable {
  if (!isRecord(raw)) throw new Error('unlocks: must be an object');
  const unitIds = new Set(spawnTable.rows.map((row) => row.id));
  const unlocks = requireArray(raw, 'unlocks', 'unlocks').map((row, index) => parseUnlockRow(row, index, unitIds));
  assertUniqueIds(unlocks.map((row) => row.id), 'unlocks');
  const gated = new Set<string>();
  for (const row of unlocks) {
    if (row.effect.type !== 'unit') continue;
    if (gated.has(row.effect.unit)) throw new Error(`unlocks: unit "${row.effect.unit}" is gated twice`);
    gated.add(row.effect.unit);
  }
  unlocks.sort((a, b) => a.atTotalDust - b.atTotalDust);
  const table: UnlockTable = { unlocks };
  // The layers after the units: each is optional, and a config without it plays exactly as before.
  if (raw['weather'] !== undefined) {
    if (!unlocks.some((row) => row.effect.type === 'weather')) throw new Error('unlocks: "weather" needs an unlock with a weather effect');
    table.weather = parseWeather(raw['weather'], unitIds);
  }
  if (raw['gems'] !== undefined) {
    if (!unlocks.some((row) => row.effect.type === 'gems')) throw new Error('unlocks: "gems" needs an unlock with a gems effect');
    table.gems = parseGems(raw['gems'], unitIds);
  }
  const unlockIds = new Set(unlocks.map((row) => row.id));
  if (raw['orders'] !== undefined) table.orders = parseOrders(raw['orders'], unlockIds);
  if (raw['devils'] !== undefined) table.devils = parseDevils(raw['devils'], unlockIds);
  for (const row of unlocks) {
    if (row.effect.type === 'weather' && table.weather === undefined) throw new Error(`unlocks: "${row.id}" opens weather, but there is no "weather" table`);
    if (row.effect.type === 'gems' && table.gems === undefined) throw new Error(`unlocks: "${row.id}" opens gems, but there is no "gems" table`);
  }
  return table;
}

export function parseConfig(spawnTableRaw: unknown, unlocksRaw: unknown): SimConfig {
  const spawnTable = parseSpawnTable(spawnTableRaw);
  const unlocks = parseUnlockTable(unlocksRaw, spawnTable);
  return { spawnTable, unlocks };
}
