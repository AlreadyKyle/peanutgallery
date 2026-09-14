import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../sim';
import { loadConfigFromDir } from '../bots/config';
import { runGreedy } from '../bots/greedy';
import { FIXTURE_CONFIG_DIR } from './paths';

// Pinned against tests/fixtures/config, a frozen copy of the config, so a
// config-lane change to the live files cannot move these numbers.
const SEED = 20260914;
const HOURS = 10;

const EXPECTED_UNLOCKS = [
  { id: 'cart', atSeconds: 67 },
  { id: 'mill', atSeconds: 345 },
  { id: 'forge', atSeconds: 1039 },
  { id: 'foundry', atSeconds: 2754 },
  { id: 'sharper-tools', atSeconds: 5294 },
  { id: 'wider-paths', atSeconds: 8473 },
  { id: 'steady-hands', atSeconds: 12122 },
  { id: 'finer-sieves', atSeconds: 16322 },
  { id: 'longer-days', atSeconds: 19815 },
  { id: 'stronger-wheels', atSeconds: 23372 },
  { id: 'bright-lanterns', atSeconds: 26964 },
  { id: 'deeper-veins', atSeconds: 30540 },
  { id: 'polished-rails', atSeconds: 34159 },
];
const EXPECTED_HASH = '04107fc4137e64be';
const EXPECTED_TOTAL_DUST = 216817387.6530975;

describe('greedy bot, ten simulated hours, seed 20260914, fixture config', () => {
  const config = loadConfigFromDir(FIXTURE_CONFIG_DIR);
  const run = runGreedy(config, { seed: SEED, hours: HOURS });

  it('runs the full ten hours', () => {
    expect(run.log.simulatedSeconds).toBe(HOURS * 3600);
  });

  it('reaches every unlock at the pinned second', () => {
    expect(run.log.unlocks).toEqual(EXPECTED_UNLOCKS);
  });

  it('lands one multiplier in each hour from the second hour on', () => {
    const hours = run.log.unlocks.slice(4).map((event) => Math.floor(event.atSeconds / 3600));
    expect(hours).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('ends on the pinned total and state hash', () => {
    expect(run.state.totalDust).toBe(EXPECTED_TOTAL_DUST);
    expect(run.log.stateHash).toBe(EXPECTED_HASH);
    expect(run.log.repeatStateHash).toBe(EXPECTED_HASH);
  });

  it('holds every invariant', () => {
    expect(checkInvariants(run.log).map((result) => [result.name, result.ok])).toEqual([
      ['no-negative-resource', true],
      ['finite-state', true],
      ['unlock-every-hour', true],
      ['deterministic-hash', true],
    ]);
  });
});
