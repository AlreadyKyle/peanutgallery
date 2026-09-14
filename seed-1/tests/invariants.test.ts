import { describe, expect, it } from 'vitest';
import { checkInvariants, createRunLog, createSim, recordTick, stateIsFinite } from '../sim';
import type { RunLog } from '../sim';
import { loadConfigFromDir } from '../bots/config';
import { runGreedy } from '../bots/greedy';
import { LIVE_CONFIG_DIR } from './paths';

function passingLog(): RunLog {
  const log = createRunLog(2);
  log.simulatedSeconds = 7200;
  log.unlocks = [
    { id: 'cart', atSeconds: 60 },
    { id: 'mill', atSeconds: 4000 },
  ];
  log.stateHash = 'abcd';
  log.repeatStateHash = 'abcd';
  return log;
}

function resultFor(log: RunLog, name: string) {
  const result = checkInvariants(log).find((entry) => entry.name === name);
  if (result === undefined) throw new Error(`no invariant named ${name}`);
  return result;
}

describe('checkInvariants', () => {
  it('passes a clean log', () => {
    expect(checkInvariants(passingLog()).every((result) => result.ok)).toBe(true);
  });

  it('fails when dust went negative', () => {
    const log = passingLog();
    log.negativeAtSeconds = 12;
    log.minDust = -3;
    const result = resultFor(log, 'no-negative-resource');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('12 s');
  });

  it('fails when a non-finite number appeared', () => {
    const log = passingLog();
    log.nonFiniteAtSeconds = 99;
    expect(resultFor(log, 'finite-state').ok).toBe(false);
  });

  it('fails when a completed hour has no unlock', () => {
    const log = passingLog();
    log.unlocks = [{ id: 'cart', atSeconds: 60 }];
    const result = resultFor(log, 'unlock-every-hour');
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('no unlock in simulated hour 1');
  });

  it('checks only hours the run completed', () => {
    const log = passingLog();
    log.simulatedSeconds = 3700;
    log.unlocks = [{ id: 'cart', atSeconds: 60 }];
    expect(resultFor(log, 'unlock-every-hour').ok).toBe(true);
  });

  it('skips the hour check for runs shorter than one hour', () => {
    const log = createRunLog(0.5);
    log.simulatedSeconds = 1800;
    log.stateHash = 'x';
    log.repeatStateHash = 'x';
    expect(resultFor(log, 'unlock-every-hour').ok).toBe(true);
  });

  it('fails when the two hashes differ or are missing', () => {
    const log = passingLog();
    log.repeatStateHash = 'ffff';
    expect(resultFor(log, 'deterministic-hash').ok).toBe(false);
    log.repeatStateHash = '';
    expect(resultFor(log, 'deterministic-hash').ok).toBe(false);
  });
});

describe('recordTick and stateIsFinite', () => {
  const config = loadConfigFromDir(LIVE_CONFIG_DIR);

  it('flags a state holding an infinite or missing number', () => {
    const state = createSim(config, 3);
    expect(stateIsFinite(state)).toBe(true);
    expect(stateIsFinite({ ...state, dust: Number.POSITIVE_INFINITY })).toBe(false);
    expect(stateIsFinite({ ...state, owned: { ...state.owned, cart: Number.NEGATIVE_INFINITY } })).toBe(false);
    expect(stateIsFinite({ ...state, totalDust: 0 / 0 })).toBe(false);
  });

  it('records the first bad tick and new unlocks', () => {
    const log = createRunLog(1);
    const state = createSim(config, 3);
    recordTick(log, { ...state, elapsedSeconds: 5, dust: -1 });
    recordTick(log, { ...state, elapsedSeconds: 6, dust: -2 });
    recordTick(log, { ...state, elapsedSeconds: 7, dust: 0, unlocked: [{ id: 'cart', atSeconds: 7 }] });
    recordTick(log, { ...state, elapsedSeconds: 8, dust: Number.POSITIVE_INFINITY });
    expect(log.negativeAtSeconds).toBe(5);
    expect(log.minDust).toBe(-2);
    expect(log.unlocks).toEqual([{ id: 'cart', atSeconds: 7 }]);
    expect(log.nonFiniteAtSeconds).toBe(8);
    expect(log.simulatedSeconds).toBe(8);
  });
});

describe('live config', () => {
  it('holds every invariant for ten greedy hours', () => {
    const config = loadConfigFromDir(LIVE_CONFIG_DIR);
    const run = runGreedy(config, { seed: 20260914, hours: 10 });
    const failures = checkInvariants(run.log).filter((result) => !result.ok);
    expect(failures).toEqual([]);
  });
});
