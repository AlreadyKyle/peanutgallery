import { describe, expect, it } from 'vitest';
import { easeOutBack, gathererPath, gathererPhase, hash01, ISLAND_HALF, pileScale, shownCount, STRUCTURE_SLOTS, TRACK_RADIUS, UNIT_CAPS } from '../render/world';
import { loadConfigFromDir } from '../bots/config';
import { LIVE_CONFIG_DIR } from './paths';

describe('the diorama model', () => {
  it('has a picture for every unit in the live spawn table, within a cap', () => {
    const config = loadConfigFromDir(LIVE_CONFIG_DIR);
    for (const row of config.spawnTable.rows) expect(UNIT_CAPS[row.id], row.id).toBeGreaterThan(0);
    expect(shownCount('gatherer', 0)).toBe(0);
    expect(shownCount('gatherer', 3)).toBe(3);
    expect(shownCount('gatherer', 10_000)).toBe(UNIT_CAPS['gatherer']);
    expect(shownCount('nobody', 5)).toBe(0);
  });

  it('has a slot for every building it draws, on the island and clear of the track', () => {
    for (const [unit, slots] of Object.entries(STRUCTURE_SLOTS)) {
      expect(slots.length, unit).toBe(UNIT_CAPS[unit]);
      for (const slot of slots) {
        expect(Math.abs(slot.x)).toBeLessThan(ISLAND_HALF - 0.6);
        expect(Math.abs(slot.z)).toBeLessThan(ISLAND_HALF - 0.6);
        expect(Math.hypot(slot.x, slot.z)).toBeGreaterThan(TRACK_RADIUS + 0.8);
      }
    }
  });

  it('grows the pile with lifetime dust and keeps it inside the track', () => {
    let previous = 0;
    for (const total of [0, 10, 1e3, 1e5, 1e7, 1e9]) {
      const scale = pileScale(total);
      expect(scale).toBeGreaterThanOrEqual(previous);
      previous = scale;
    }
    expect(pileScale(1e300)).toBeLessThan(TRACK_RADIUS - 0.5);
    expect(pileScale(Number.NaN)).toBe(pileScale(0));
  });

  it('is deterministic: the same index walks the same lane at the same time', () => {
    expect(gathererPath(5)).toEqual(gathererPath(5));
    expect(gathererPhase(gathererPath(5), 12.5)).toEqual(gathererPhase(gathererPath(5), 12.5));
    for (let i = 0; i < 1000; i += 1) {
      const h = hash01(i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    const phase = gathererPhase(gathererPath(0), 3);
    expect(phase.along).toBeGreaterThanOrEqual(0);
    expect(phase.along).toBeLessThanOrEqual(1);
  });

  it('pops in with an overshoot that settles at one', () => {
    expect(easeOutBack(0)).toBe(0);
    expect(easeOutBack(1)).toBe(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => easeOutBack(i / 50)))).toBeGreaterThan(1);
  });
});
