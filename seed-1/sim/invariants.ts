import type { SimState, UnlockEvent } from './types';

export const SECONDS_PER_HOUR = 3600;

// A RunLog is the accumulator a bot fills while it plays; checkInvariants
// reads only the log, so a saved log can be re-checked without replaying.
export interface RunLog {
  hours: number;
  simulatedSeconds: number;
  minDust: number;
  negativeAtSeconds: number | null;
  nonFiniteAtSeconds: number | null;
  unlocks: UnlockEvent[];
  stateHash: string;
  repeatStateHash: string;
}

export interface InvariantResult {
  name: string;
  ok: boolean;
  detail: string;
}

export function createRunLog(hours: number): RunLog {
  return {
    hours,
    simulatedSeconds: 0,
    minDust: 0,
    negativeAtSeconds: null,
    nonFiniteAtSeconds: null,
    unlocks: [],
    stateHash: '',
    repeatStateHash: '',
  };
}

export function stateIsFinite(state: SimState): boolean {
  const numbers = [state.seed, state.rngState, state.elapsedSeconds, state.dust, state.totalDust];
  for (const count of Object.values(state.owned)) numbers.push(count);
  for (const event of state.unlocked) numbers.push(event.atSeconds);
  return numbers.every((value) => Number.isFinite(value));
}

export function recordTick(log: RunLog, state: SimState): void {
  log.simulatedSeconds = state.elapsedSeconds;
  if (!stateIsFinite(state)) {
    if (log.nonFiniteAtSeconds === null) log.nonFiniteAtSeconds = state.elapsedSeconds;
    return;
  }
  if (state.dust < log.minDust) log.minDust = state.dust;
  if (state.dust < 0 && log.negativeAtSeconds === null) log.negativeAtSeconds = state.elapsedSeconds;
  for (let i = log.unlocks.length; i < state.unlocked.length; i += 1) {
    const event = state.unlocked[i];
    if (event !== undefined) log.unlocks.push({ id: event.id, atSeconds: event.atSeconds });
  }
}

function completedHours(log: RunLog): number {
  return Math.min(Math.floor(log.hours), Math.floor(log.simulatedSeconds / SECONDS_PER_HOUR));
}

function checkNoNegative(log: RunLog): InvariantResult {
  const name = 'no-negative-resource';
  if (log.negativeAtSeconds !== null) {
    return { name, ok: false, detail: `dust fell below zero at ${log.negativeAtSeconds} s (minimum ${log.minDust})` };
  }
  return { name, ok: true, detail: `dust never fell below zero (minimum ${log.minDust})` };
}

function checkFinite(log: RunLog): InvariantResult {
  const name = 'finite-state';
  if (log.nonFiniteAtSeconds !== null) {
    return { name, ok: false, detail: `a non-finite number appeared in the state at ${log.nonFiniteAtSeconds} s` };
  }
  return { name, ok: true, detail: `every number in the state stayed finite for ${log.simulatedSeconds} s` };
}

function checkUnlockEveryHour(log: RunLog): InvariantResult {
  const name = 'unlock-every-hour';
  const hours = completedHours(log);
  if (hours < 1) {
    return { name, ok: true, detail: 'the run completed less than one simulated hour, so no hour was checked' };
  }
  const missing: number[] = [];
  for (let hour = 0; hour < hours; hour += 1) {
    const start = hour * SECONDS_PER_HOUR;
    const end = start + SECONDS_PER_HOUR;
    const hit = log.unlocks.some((event) => event.atSeconds >= start && event.atSeconds < end);
    if (!hit) missing.push(hour);
  }
  if (missing.length > 0) {
    return { name, ok: false, detail: `no unlock in simulated hour ${missing.join(', ')}` };
  }
  return { name, ok: true, detail: `each of the ${hours} completed simulated hours has at least one unlock` };
}

function checkDeterministic(log: RunLog): InvariantResult {
  const name = 'deterministic-hash';
  if (log.stateHash.length === 0 || log.repeatStateHash.length === 0) {
    return { name, ok: false, detail: 'the run did not record both state hashes' };
  }
  if (log.stateHash !== log.repeatStateHash) {
    return { name, ok: false, detail: `the same seed produced ${log.stateHash} and then ${log.repeatStateHash}` };
  }
  return { name, ok: true, detail: `the same seed produced ${log.stateHash} twice` };
}

export function checkInvariants(log: RunLog): InvariantResult[] {
  return [checkNoNegative(log), checkFinite(log), checkUnlockEveryHour(log), checkDeterministic(log)];
}
