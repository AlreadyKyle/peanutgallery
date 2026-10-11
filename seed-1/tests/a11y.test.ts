import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { Announcer, controlsView, DUST_ANNOUNCE_INTERVAL_MS, dustStatus } from '../render/a11y';
import { parseStrings } from '../render/strings';
import { apply, createSim, step } from '../sim/sim';
import { LIVE_CONTENT_DIR, PACKAGE_DIR } from './paths';

const config = loadConfigFromDir(join(PACKAGE_DIR, 'tests', 'fixtures', 'config'));
const strings = parseStrings(JSON.parse(readFileSync(join(LIVE_CONTENT_DIR, 'strings.json'), 'utf8')));

describe('accessible controls view', () => {
  it('labels each unit with its name, cost and owned count, and marks what is unaffordable', () => {
    const state = createSim(config, 1);
    const view = controlsView(state, config, strings);
    const gatherer = view.units.find((unit) => unit.unit === 'gatherer')!;
    expect(gatherer).toEqual({ unit: 'gatherer', available: true, affordable: false, label: 'Buy Gatherer: costs 10 dust, 0 owned' });
    expect(view.units.filter((unit) => unit.available).map((unit) => unit.unit)).toEqual(['gatherer']);
  });

  it('follows the sim after a purchase', () => {
    let state = step(createSim(config, 1), config, 20);
    expect(controlsView(state, config, strings).units[0]!.affordable).toBe(true);
    state = apply(state, config, { type: 'buy', unit: 'gatherer' });
    expect(controlsView(state, config, strings).units[0]!.label).toBe('Buy Gatherer: costs 13 dust, 1 owned');
  });

  it('states dust and rate', () => {
    expect(dustStatus(createSim(config, 1), config, strings)).toBe('0 dust, 1.0 per second.');
  });

  it('does not change the state it reads', () => {
    const state = step(createSim(config, 1), config, 500);
    const before = JSON.stringify(state);
    controlsView(state, config, strings);
    new Announcer(config, strings, state, 0).tick(state, DUST_ANNOUNCE_INTERVAL_MS);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('live region announcer', () => {
  it('repeats the dust total at most once per interval', () => {
    const state = createSim(config, 1);
    const announcer = new Announcer(config, strings, state, 0);
    expect(announcer.tick(state, 1)).toBeNull();
    expect(announcer.tick(state, DUST_ANNOUNCE_INTERVAL_MS - 1)).toBeNull();
    expect(announcer.tick(state, DUST_ANNOUNCE_INTERVAL_MS)).toBe('0 dust, 1.0 per second.');
    expect(announcer.tick(state, DUST_ANNOUNCE_INTERVAL_MS + 5)).toBeNull();
  });

  it('announces an unlock at once, then not again', () => {
    const start = createSim(config, 1);
    const announcer = new Announcer(config, strings, start, 0);
    const later = step(start, config, 120);
    expect(later.unlocked.length).toBeGreaterThan(0);
    const message = announcer.tick(later, 1);
    expect(message).toMatch(/^Unlocked Cart\. Opens the Cart\. /);
    expect(announcer.tick(later, 2)).toBeNull();
  });

  it('announces a purchase at once and restarts the interval', () => {
    let state = step(createSim(config, 1), config, 20);
    const announcer = new Announcer(config, strings, state, 0);
    state = apply(state, config, { type: 'buy', unit: 'gatherer' });
    expect(announcer.bought(state, 'gatherer', 9_000)).toBe('Bought a Gatherer, 1 owned. 10 dust, 1.2 per second.');
    expect(announcer.tick(state, DUST_ANNOUNCE_INTERVAL_MS + 1)).toBeNull();
    expect(announcer.tick(state, 9_000 + DUST_ANNOUNCE_INTERVAL_MS)).not.toBeNull();
  });
});
