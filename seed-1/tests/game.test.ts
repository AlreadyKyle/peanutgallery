import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { Game, keepUnreadable, SAVE_KEY, UNREADABLE_KEY } from '../render/game';
import { awaySeconds, parseSavedAt, parseSavedState } from '../sim/save';
import { createSim, step } from '../sim/sim';
import type { UnlockRow } from '../sim/types';
import { FIXTURE_CONFIG_DIR } from './paths';

const config = loadConfigFromDir(FIXTURE_CONFIG_DIR);

function memoryStore() {
  const items = new Map<string, string>();
  return { items, setItem: (key: string, value: string) => void items.set(key, value) };
}

describe('the running game', () => {
  it('steps by wall-clock time from its first tick, not from construction', () => {
    const game = new Game(config, createSim(config, 1));
    game.tick(10_000);
    expect(game.state.elapsedSeconds).toBe(0);
    game.tick(12_500);
    expect(game.state).toEqual(step(createSim(config, 1), config, 2.5));
  });

  it('tells its listeners about strikes, purchases and unlocks, in order', () => {
    const events: string[] = [];
    const rich = { ...createSim(config, 1), dust: 50, totalDust: 50 };
    const game = new Game(config, rich);
    game.listen({
      strike: (gain) => events.push(`strike ${gain > 0}`),
      bought: (unit, owned) => events.push(`bought ${unit} ${owned}`),
      unlocked: (rows: UnlockRow[]) => events.push(`unlocked ${rows.map((row) => row.id).join(',')}`),
    });
    game.act({ type: 'strike' });
    game.act({ type: 'buy', unit: 'gatherer' });
    game.act({ type: 'buy', unit: 'foundry' });
    game.tick(0);
    game.tick(200_000);
    expect(events[0]).toBe('strike true');
    expect(events[1]).toBe('bought gatherer 1');
    expect(events).not.toContain('bought foundry 1');
    expect(events.some((event) => event.startsWith('unlocked '))).toBe(true);
  });

  it('saves under dust.save with the time it was written, and stops saving when told', () => {
    const store = memoryStore();
    const game = new Game(config, createSim(config, 1), store);
    game.act({ type: 'strike' });
    game.save(1234);
    const raw = store.items.get(SAVE_KEY)!;
    expect(parseSavedState(raw)).toEqual(game.state);
    expect(parseSavedAt(raw)).toBe(1234);
    game.stopSaving();
    game.act({ type: 'strike' });
    game.save(5678);
    expect(parseSavedAt(store.items.get(SAVE_KEY)!)).toBe(1234);
  });

  it('keeps a save that does not read before a fresh game replaces it, and never writes over the first one kept', () => {
    const items = new Map<string, string>();
    const store = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
    const future = JSON.stringify({ version: 2, savedAt: 1, state: { dust: 5 } });
    expect(parseSavedState(future)).toBeNull();
    expect(keepUnreadable(store, future)).toBe(true);
    expect(items.get(UNREADABLE_KEY)).toBe(future);
    expect(keepUnreadable(store, 'not json {')).toBe(false);
    expect(items.get(UNREADABLE_KEY)).toBe(future);
    expect(keepUnreadable(null, future)).toBe(false);
    const refusing = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    expect(keepUnreadable(refusing, future)).toBe(false);
  });

  it('stamps a save with the time its state was stepped to, so a tab closed while hidden is still credited', () => {
    const store = memoryStore();
    const game = new Game(config, createSim(config, 1), store);
    game.tick(10_000);
    game.tick(12_000);
    // The tab is hidden from 12 s: no more frames, so no ticks, but the 5 s timer and pagehide still
    // save, two hours later.
    const hiddenAt = 12_000;
    const closedAt = hiddenAt + 2 * 3600 * 1000;
    game.save(hiddenAt + 5_000);
    game.save(closedAt);
    const raw = store.items.get(SAVE_KEY)!;
    expect(parseSavedAt(raw)).toBe(hiddenAt);
    expect(parseSavedState(raw)!.elapsedSeconds).toBe(2);
    // The next load credits the whole time since the state was last stepped: 2 hours.
    expect(awaySeconds(parseSavedAt(raw)!, closedAt)).toBe(2 * 3600);
  });
});
