import { stateIsFinite } from './invariants';
import type { SimState, UnlockEvent } from './types';

// The save wrapper carries a version outside SimState so a format change
// never touches the shape tests/timeline.test.ts pins the hash of.

const SAVE_VERSION = 1;

export function serializeState(state: SimState): string {
  return JSON.stringify({ version: SAVE_VERSION, state });
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
  for (const entry of raw) {
    const event = parseUnlockEvent(entry);
    if (event === null) return null;
    events.push(event);
  }
  return events;
}

function parseState(raw: unknown): SimState | null {
  if (!isRecord(raw)) return null;
  const { seed, rngState, elapsedSeconds, dust, totalDust, owned, unlocked } = raw;
  if (typeof seed !== 'number' || typeof rngState !== 'number' || typeof elapsedSeconds !== 'number') return null;
  if (typeof dust !== 'number' || typeof totalDust !== 'number') return null;
  const parsedOwned = parseOwned(owned);
  const parsedUnlocked = parseUnlocked(unlocked);
  if (parsedOwned === null || parsedUnlocked === null) return null;
  const state: SimState = { seed, rngState, elapsedSeconds, dust, totalDust, owned: parsedOwned, unlocked: parsedUnlocked };
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
