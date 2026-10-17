import { stateIsFinite } from './invariants';
import type { DevilState, OrderState, SimState, UnlockEvent, WeatherState } from './types';

// The save wrapper carries a version outside SimState so a format change
// never touches the shape tests/timeline.test.ts pins the hash of.

// The wrapper also carries savedAt, the wall-clock millisecond the save was written, so the game can
// credit the time the player was away. It is optional: a save written before it existed still loads.

export const SAVE_VERSION = 1;

/** The most time away the game credits in one go: 8 hours. */
export const MAX_AWAY_SECONDS = 8 * 60 * 60;

export function serializeState(state: SimState, savedAt?: number): string {
  return JSON.stringify(savedAt === undefined ? { version: SAVE_VERSION, state } : { version: SAVE_VERSION, savedAt, state });
}

/**
 * The seconds between two wall-clock readings in milliseconds, as the sim should credit them: never
 * below zero (a clock set back) and never above MAX_AWAY_SECONDS. The caller reads the clock; the sim
 * never does.
 */
export function awaySeconds(fromMs: number, toMs: number): number {
  const seconds = (toMs - fromMs) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, MAX_AWAY_SECONDS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOwned(raw: unknown): Record<string, number> | null {
  if (!isRecord(raw)) return null;
  const owned: Record<string, number> = {};
  for (const [id, count] of Object.entries(raw)) {
    if (typeof count !== 'number') return null;
    owned[id] = count;
  }
  return owned;
}

function parseUnlockEvent(raw: unknown): UnlockEvent | null {
  if (!isRecord(raw)) return null;
  const { id, atSeconds } = raw;
  if (typeof id !== 'string' || typeof atSeconds !== 'number') return null;
  return { id, atSeconds };
}

function parseUnlocked(raw: unknown): UnlockEvent[] | null {
  if (!Array.isArray(raw)) return null;
  const events: UnlockEvent[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const event = parseUnlockEvent(entry);
    if (event === null) return null;
    // The sim records each unlock once; a save that lists one twice would apply its multiplier twice.
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  return events;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseWeather(raw: unknown): WeatherState | null {
  if (!isRecord(raw)) return null;
  const { kind, until, next } = raw;
  if (kind !== null && (typeof kind !== 'string' || kind.length === 0)) return null;
  if (typeof until !== 'number' || typeof next !== 'number' || !Number.isFinite(until) || !Number.isFinite(next)) return null;
  if (until < 0 || next < 0) return null;
  return { kind, until, next };
}

function parsePerks(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const perks: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || id.length === 0) return null;
    // A perk is bought once; a save that lists one twice would apply it twice.
    if (!perks.includes(id)) perks.push(id);
  }
  return perks;
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseChosen(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw)) return null;
  const chosen: Record<string, string> = {};
  for (const [unlock, option] of Object.entries(raw)) {
    if (typeof option !== 'string' || option.length === 0) return null;
    chosen[unlock] = option;
  }
  return chosen;
}

function parseOrder(raw: unknown): OrderState | null {
  if (!isRecord(raw)) return null;
  const { type, unit, target, progress, from } = raw;
  if (type !== 'own' && type !== 'gather' && type !== 'strikes') return null;
  if (!isTime(target)) return null;
  const order: OrderState = { type, target };
  if (unit !== undefined) {
    if (typeof unit !== 'string' || unit.length === 0) return null;
    order.unit = unit;
  }
  if (type === 'own' && order.unit === undefined) return null;
  if (progress !== undefined) {
    if (!isTime(progress)) return null;
    order.progress = progress;
  }
  if (from !== undefined) {
    if (!isTime(from)) return null;
    order.from = from;
  }
  return order;
}

function parseDevil(raw: unknown): DevilState | null {
  if (!isRecord(raw)) return null;
  const { until, next, whirlUntil } = raw;
  if (!isTime(until) || !isTime(next) || !isTime(whirlUntil)) return null;
  return { until, next, whirlUntil };
}

// The optional layers (weather, gems, perks, seasons, forks, orders, dust devils) are carried only when present, so a save from
// before they existed loads unchanged and a state without them hashes as it always did.
function parseLayers(raw: Record<string, unknown>, state: SimState): SimState | null {
  const out: SimState = { ...state };
  if (raw['weather'] !== undefined) {
    const weather = parseWeather(raw['weather']);
    if (weather === null) return null;
    out.weather = weather;
  }
  for (const key of ['gems', 'season', 'ordersFilled'] as const) {
    if (raw[key] === undefined) continue;
    if (!isCount(raw[key])) return null;
    out[key] = raw[key];
  }
  if (raw['pastDust'] !== undefined) {
    const pastDust = raw['pastDust'];
    if (typeof pastDust !== 'number' || !Number.isFinite(pastDust) || pastDust < 0) return null;
    out.pastDust = pastDust;
  }
  if (raw['perks'] !== undefined) {
    const perks = parsePerks(raw['perks']);
    if (perks === null) return null;
    out.perks = perks;
  }
  if (raw['chosen'] !== undefined) {
    const chosen = parseChosen(raw['chosen']);
    if (chosen === null) return null;
    out.chosen = chosen;
  }
  if (raw['order'] !== undefined) {
    const order = parseOrder(raw['order']);
    if (order === null) return null;
    out.order = order;
  }
  if (raw['devil'] !== undefined) {
    const devil = parseDevil(raw['devil']);
    if (devil === null) return null;
    out.devil = devil;
  }
  return out;
}

function parseState(raw: unknown): SimState | null {
  if (!isRecord(raw)) return null;
  const { seed, rngState, elapsedSeconds, dust, totalDust, owned, unlocked } = raw;
  if (typeof seed !== 'number' || typeof rngState !== 'number' || typeof elapsedSeconds !== 'number') return null;
  if (typeof dust !== 'number' || typeof totalDust !== 'number') return null;
  const parsedOwned = parseOwned(owned);
  const parsedUnlocked = parseUnlocked(unlocked);
  if (parsedOwned === null || parsedUnlocked === null) return null;
  const base: SimState = { seed, rngState, elapsedSeconds, dust, totalDust, owned: parsedOwned, unlocked: parsedUnlocked };
  const state = parseLayers(raw, base);
  if (state === null) return null;
  return stateIsFinite(state) && stateIsReachable(state) ? state : null;
}

// A save is read from localStorage, so finite is not enough: dust, lifetime dust and elapsed time never
// go below zero, and a unit count is a whole number of units, never below zero. A state that breaks
// this is one the sim cannot reach, and the game would carry it on and write it back.
function stateIsReachable(state: SimState): boolean {
  if (state.dust < 0 || state.totalDust < 0 || state.elapsedSeconds < 0) return false;
  return Object.values(state.owned).every((count) => Number.isInteger(count) && count >= 0);
}

export function parseSavedState(raw: string): SimState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['version'] !== SAVE_VERSION) return null;
  return parseState(parsed['state']);
}

/** When a save was written, or null for a save without a usable savedAt (older saves have none). */
export function parseSavedAt(raw: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const savedAt = parsed['savedAt'];
  return typeof savedAt === 'number' && Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null;
}
