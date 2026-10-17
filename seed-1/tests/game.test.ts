import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { Game, SAVE_KEY } from '../render/game';
import { parseSavedAt, parseSavedState } from '../sim/save';
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
});
