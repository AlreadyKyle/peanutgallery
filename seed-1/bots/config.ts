import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../sim/config';
import type { SimConfig } from '../sim/types';

export const SPAWN_TABLE_FILE = 'spawn-table.json';
export const UNLOCKS_FILE = 'unlocks.json';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function loadConfigFromDir(dir: string): SimConfig {
  return parseConfig(readJson(join(dir, SPAWN_TABLE_FILE)), readJson(join(dir, UNLOCKS_FILE)));
}
