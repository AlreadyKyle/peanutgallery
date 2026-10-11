import { describe, expect, it } from 'vitest';
import { awaySeconds, MAX_AWAY_SECONDS, parseSavedAt, parseSavedState, serializeState } from '../sim/save';
import { createSim } from '../sim/sim';
import { loadConfigFromDir } from '../bots/config';
import { greedyTick } from '../bots/greedy';
import { FIXTURE_CONFIG_DIR } from './paths';

const config = loadConfigFromDir(FIXTURE_CONFIG_DIR);

function playedState() {
  let state = createSim(config, 20260914);
  for (let i = 0; i < 1000; i += 1) state = greedyTick(state, config);
  return state;
}

describe('serializeState / parseSavedState', () => {
  it('round-trips a state reached after 1000 greedy ticks', () => {
    const state = playedState();
    expect(parseSavedState(serializeState(state))).toEqual(state);
  });

  it('rejects text that is not JSON', () => {
    expect(parseSavedState('not json')).toBeNull();
  });

  it('rejects a version other than 1', () => {
    const state = playedState();
    const wrapped = JSON.parse(serializeState(state)) as { version: number };
    wrapped.version = 2;
    expect(parseSavedState(JSON.stringify(wrapped))).toBeNull();
  });

  it('rejects a value that is not an object', () => {
    expect(parseSavedState(JSON.stringify('a string'))).toBeNull();
    expect(parseSavedState(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it('rejects a save missing a field', () => {
    const state = playedState();
    const wrapped = JSON.parse(serializeState(state)) as { state: Record<string, unknown> };
    delete wrapped.state['totalDust'];
    expect(parseSavedState(JSON.stringify(wrapped))).toBeNull();
  });

  it('rejects non-finite dust', () => {
    const raw = '{"version":1,"state":{"seed":1,"rngState":1,"elapsedSeconds":1,"dust":1e400,"totalDust":1,"owned":{},"unlocked":[]}}';
    expect(parseSavedState(raw)).toBeNull();
  });

  // A save is read from localStorage, which a player, an extension or a bug can leave holding any
  // number. Finite is not enough: dust below zero or a unit count below zero or between whole numbers
  // is a state the sim never reaches, and the game would carry it on and write it back every five seconds.
  describe('rejects a state the sim can never reach', () => {
    function withState(change: (state: Record<string, unknown>) => void): string {
      const wrapped = JSON.parse(serializeState(playedState())) as { state: Record<string, unknown> };
      change(wrapped.state);
      return JSON.stringify(wrapped);
    }

    it.each([
      ['negative dust', (s: Record<string, unknown>) => (s['dust'] = -500)],
      ['negative lifetime dust', (s: Record<string, unknown>) => (s['totalDust'] = -1)],
      ['negative elapsed seconds', (s: Record<string, unknown>) => (s['elapsedSeconds'] = -10)],
      ['a negative unit count', (s: Record<string, unknown>) => (s['owned'] = { gatherer: -40 })],
      ['a fractional unit count', (s: Record<string, unknown>) => (s['owned'] = { gatherer: 2.5 })],
    ])('%s', (_name, change) => {
      expect(parseSavedState(withState(change))).toBeNull();
    });
  });

  it('still reads a new game, a state with nothing owned, and a state with zero dust', () => {
    const fresh = createSim(config, 1);
    expect(parseSavedState(serializeState(fresh))).toEqual(fresh);
    const empty = { ...playedState(), dust: 0, owned: {} };
    expect(parseSavedState(serializeState(empty))).toEqual(empty);
  });
});

// Time away counts (a background tab, a closed page): the save carries when it was written and the
// game credits the gap, clamped so a clock set back or a months-old save cannot break the economy.
describe('savedAt and awaySeconds', () => {
  it('round-trips savedAt beside the state', () => {
    const state = playedState();
    const raw = serializeState(state, 1_760_000_000_000);
    expect(parseSavedState(raw)).toEqual(state);
    expect(parseSavedAt(raw)).toBe(1_760_000_000_000);
  });

  it('still loads a save written before savedAt existed', () => {
    const state = playedState();
    const raw = serializeState(state);
    expect(parseSavedState(raw)).toEqual(state);
    expect(parseSavedAt(raw)).toBeNull();
  });

  it('ignores a savedAt that is not a positive finite number', () => {
    const state = playedState();
    for (const savedAt of ['soon', -5, 0, null]) {
      const raw = JSON.stringify({ version: 1, savedAt, state });
      expect(parseSavedState(raw)).toEqual(state);
      expect(parseSavedAt(raw)).toBeNull();
    }
    expect(parseSavedAt('not json')).toBeNull();
  });

  it('credits the seconds between two clock readings', () => {
    expect(awaySeconds(1_000, 241_000)).toBe(240);
  });

  it('credits nothing when the clock went back', () => {
    expect(awaySeconds(10_000, 5_000)).toBe(0);
    expect(awaySeconds(Number.NaN, 5_000)).toBe(0);
  });

  it('credits at most 8 hours', () => {
    expect(MAX_AWAY_SECONDS).toBe(28_800);
    expect(awaySeconds(0, 30 * 24 * 60 * 60 * 1000)).toBe(MAX_AWAY_SECONDS);
  });
});

describe('a save that lists an unlock twice', () => {
  it('keeps the first of each unlock, so a multiplier is never applied twice', () => {
    const state = { ...createSim(config, 1), totalDust: 1e9, dust: 1e9 };
    const first = config.unlocks.unlocks[0]!;
    const raw = JSON.stringify({ version: 1, state: { ...state, unlocked: [{ id: first.id, atSeconds: 1 }, { id: first.id, atSeconds: 2 }] } });
    expect(parseSavedState(raw)?.unlocked).toEqual([{ id: first.id, atSeconds: 1 }]);
  });
});
