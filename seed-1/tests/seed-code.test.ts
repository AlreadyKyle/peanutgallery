import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { greedyTick } from '../bots/greedy';
import { serializeState } from '../sim/save';
import { createSim } from '../sim/sim';
import { decodeSeed, encodeSeed, MAX_SEED_LENGTH, seedFromSearch, seedLink } from '../render/seed-code';
import { FIXTURE_CONFIG_DIR } from './paths';

// Seeds (docs/specs/final-state.md, Seeds and instances): dust:v<saveVersion>:<base64url(save JSON)>.
const config = loadConfigFromDir(FIXTURE_CONFIG_DIR);

function played(seconds: number) {
  let state = createSim(config, 20260914);
  for (let i = 0; i < seconds; i += 1) state = greedyTick(state, config);
  return state;
}

describe('seed codes', () => {
  it('round-trips a played state exactly', () => {
    const state = played(3600);
    const code = encodeSeed(state);
    expect(code).toMatch(/^dust:v1:[A-Za-z0-9_-]+$/);
    expect(decodeSeed(code)).toEqual(state);
  });

  it('is the save JSON in base64url, without a savedAt', () => {
    const state = played(60);
    const body = encodeSeed(state).slice('dust:v1:'.length);
    const json = Buffer.from(body, 'base64url').toString('utf8');
    expect(json).toBe(serializeState(state));
    expect(json).not.toContain('savedAt');
  });

  it('stays short enough for a link', () => {
    expect(encodeSeed(played(21600)).length).toBeLessThan(1200);
  });

  it('refuses anything that is not a seed of this save version', () => {
    const state = played(60);
    const body = encodeSeed(state).slice('dust:v1:'.length);
    expect(decodeSeed(`dust:v2:${body}`)).toBeNull();
    expect(decodeSeed(`dirt:v1:${body}`)).toBeNull();
    expect(decodeSeed('dust:v1:')).toBeNull();
    expect(decodeSeed('dust:v1:not*base64')).toBeNull();
    expect(decodeSeed(`dust:v1:${Buffer.from('{"version":1}').toString('base64url')}`)).toBeNull();
    expect(decodeSeed(`dust:v1:${'A'.repeat(MAX_SEED_LENGTH)}`)).toBeNull();
    // A state the sim cannot reach is refused as a save would be: negative dust.
    const bad = JSON.stringify({ version: 1, state: { ...state, dust: -5 } });
    expect(decodeSeed(`dust:v1:${Buffer.from(bad).toString('base64url')}`)).toBeNull();
  });

  it('makes the play link and reads the code back from a query string', () => {
    const code = encodeSeed(played(10));
    const link = seedLink(code);
    expect(link).toBe(`https://play.mobmachine.games/?seed=${code}`);
    expect(seedFromSearch(new URL(link).search)).toBe(code);
    expect(seedFromSearch('?seed=')).toBeNull();
    expect(seedFromSearch('')).toBeNull();
    expect(decodeSeed(seedFromSearch(new URL(link).search)!)).toEqual(played(10));
  });
});
