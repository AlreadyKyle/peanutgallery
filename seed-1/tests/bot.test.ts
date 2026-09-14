import { describe, expect, it } from 'vitest';
import { createSim, hashState } from '../sim';
import { USAGE, parseArgs } from '../bots/args';
import { loadConfigFromDir } from '../bots/config';
import { chooseBuy, runGreedy } from '../bots/greedy';
import { FIXTURE_CONFIG_DIR } from './paths';

const config = loadConfigFromDir(FIXTURE_CONFIG_DIR);

describe('parseArgs', () => {
  it('reads every flag', () => {
    expect(parseArgs(['--config-dir', 'seed-1/config', '--hours', '10', '--seed', '20260914', '--real-seconds', '60', '--json'])).toEqual({
      configDir: 'seed-1/config',
      hours: 10,
      seed: 20260914,
      realSeconds: 60,
      json: true,
    });
  });

  it('defaults the optional flags and skips the separator pnpm forwards', () => {
    expect(parseArgs(['--', '--config-dir', 'config', '--hours', '1', '--seed', '1'])).toEqual({
      configDir: 'config',
      hours: 1,
      seed: 1,
      realSeconds: null,
      json: false,
    });
  });

  it('rejects missing or malformed values', () => {
    expect(() => parseArgs(['--hours', '1', '--seed', '1'])).toThrow('--config-dir is required');
    expect(() => parseArgs(['--config-dir', 'config', '--seed', '1'])).toThrow('--hours is required');
    expect(() => parseArgs(['--config-dir', 'config', '--hours', 'ten', '--seed', '1'])).toThrow('--hours');
    expect(() => parseArgs(['--config-dir', 'config', '--hours', '1', '--seed', '1.5'])).toThrow('integer');
    expect(() => parseArgs(['--config-dir', '--hours', '1', '--seed', '1'])).toThrow('needs a value');
    expect(() => parseArgs(['--config-dir', 'config', '--hours', '1', '--seed', '1', '--fast'])).toThrow('unknown argument --fast');
    expect(USAGE).toContain('--config-dir');
  });
});

describe('chooseBuy', () => {
  it('buys nothing with an empty purse', () => {
    expect(chooseBuy(createSim(config, 1), config)).toBeNull();
  });

  it('prefers the best rate per dust among affordable units', () => {
    const start = createSim(config, 1);
    const unlocked = [{ id: 'cart', atSeconds: 0 }];
    // Gatherer 0.2/10 = 0.02 per dust beats cart 1.5/150 = 0.01.
    expect(chooseBuy({ ...start, unlocked, dust: 200, totalDust: 200 }, config)).toBe('gatherer');
    // After four gatherers the fifth costs 24 and drops to 0.0083 per dust.
    const owned = { ...start.owned, gatherer: 4 };
    expect(chooseBuy({ ...start, unlocked, owned, dust: 200, totalDust: 200 }, config)).toBe('cart');
    // With only 100 dust the cart is out of reach, so the gatherer wins again.
    expect(chooseBuy({ ...start, unlocked, owned, dust: 100, totalDust: 100 }, config)).toBe('gatherer');
  });
});

describe('runGreedy', () => {
  it('gives the first play half the real-second budget and still hashes the replay identically', () => {
    let ticks = 0;
    const clock = () => {
      ticks += 1;
      return ticks;
    };
    // The clock advances one second per reading: one at the start, then one
    // per budget check. A budget of 6 stops the first play once three checks
    // have passed, at the third multiple of 256; the replay reads no clock.
    const run = runGreedy(config, { seed: 5, hours: 10, realSecondsBudget: 6, clock });
    expect(run.log.simulatedSeconds).toBe(3 * 256 - 1);
    expect(ticks).toBe(4);
    expect(run.log.stateHash).toBe(run.log.repeatStateHash);
    expect(hashState(run.state)).toBe(run.log.stateHash);
  });

  it('honours fractional hours', () => {
    expect(runGreedy(config, { seed: 5, hours: 0.5 }).log.simulatedSeconds).toBe(1800);
  });
});
