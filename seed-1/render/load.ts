import { parseConfig } from '../sim/config';
import type { SimConfig } from '../sim/types';
import { parseStrings } from './strings';
import type { Strings } from './strings';

export interface GameData {
  config: SimConfig;
  strings: Strings;
}

// Relative paths, so the game works from any base path the site is served at.
export const SPAWN_TABLE_URL = 'config/spawn-table.json';
export const UNLOCKS_URL = 'config/unlocks.json';
export const STRINGS_URL = 'content/strings.json';

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function loadGameData(): Promise<GameData> {
  const [spawnTable, unlocks, strings] = await Promise.all([
    fetchJson(SPAWN_TABLE_URL),
    fetchJson(UNLOCKS_URL),
    fetchJson(STRINGS_URL),
  ]);
  return { config: parseConfig(spawnTable, unlocks), strings: parseStrings(strings) };
}
