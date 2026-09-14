import type { SimConfig, SpawnRow, SpawnTable, UnlockEffect, UnlockRow, UnlockTable } from './types';

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
  throw new Error(`${where}: effect type must be "unit" or "multiplier"`);
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

export function parseSpawnTable(raw: unknown): SpawnTable {
  if (!isRecord(raw)) throw new Error('spawn-table: must be an object');
  const rows = requireArray(raw, 'rows', 'spawn-table').map(parseSpawnRow);
  assertUniqueIds(rows.map((row) => row.id), 'spawn-table');
  return { rows };
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
  return { unlocks };
}

export function parseConfig(spawnTableRaw: unknown, unlocksRaw: unknown): SimConfig {
  const spawnTable = parseSpawnTable(spawnTableRaw);
  const unlocks = parseUnlockTable(unlocksRaw, spawnTable);
  return { spawnTable, unlocks };
}
