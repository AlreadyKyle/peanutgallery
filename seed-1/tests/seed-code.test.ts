import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { greedyTick } from '../bots/greedy';
import { serializeState } from '../sim/save';
import { createSim } from '../sim/sim';
import { decodeSeed, encodeSeed, MAX_SEED_LENGTH, SEED_LIMITS, seedFromSearch, seedIsPlausible, seedLink } from '../render/seed-code';
import { BACKUP_KEY, SAVE_KEY, SEED_RUN_KEY } from '../render/game';
import { keepBackup, offerSeed, type SeedOfferElements } from '../render/seed-ui';
import { parseStrings } from '../render/strings';
import { FIXTURE_CONFIG_DIR, LIVE_CONTENT_DIR } from './paths';

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

  it('refuses a crafted seed that holds more than a played run could', () => {
    const state = played(600);
    const code = (value: unknown): string => `dust:v1:${Buffer.from(JSON.stringify({ version: 1, state: value })).toString('base64url')}`;
    expect(decodeSeed(code(state))).toEqual(state);
    expect(decodeSeed(code({ ...state, dust: 1e300, totalDust: 1e301 }))).toBeNull();
    expect(decodeSeed(code({ ...state, totalDust: SEED_LIMITS.dust }))).toBeNull();
    expect(decodeSeed(code({ ...state, dust: state.totalDust + 1000 }))).toBeNull();
    expect(decodeSeed(code({ ...state, owned: { ...state.owned, gatherer: SEED_LIMITS.owned + 1 } }))).toBeNull();
    expect(decodeSeed(code({ ...state, gems: SEED_LIMITS.gems + 1, season: 1, perks: [], pastDust: 1 }))).toBeNull();
    expect(decodeSeed(code({ ...state, pastDust: 1e25, season: 1, gems: 3, perks: [] }))).toBeNull();
    expect(decodeSeed(code({ ...state, elapsedSeconds: SEED_LIMITS.elapsedSeconds * 2 }))).toBeNull();
    // A big run inside the limits still opens.
    const big = { ...state, dust: 1e18, totalDust: 5e20, gems: 40, season: 6, perks: [], pastDust: 9e20 };
    expect(seedIsPlausible(big)).toBe(true);
    expect(decodeSeed(code(big))).toEqual(big);
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

describe('the backup before a seed', () => {
  function store(entries: Record<string, string>) {
    const map = new Map(Object.entries(entries));
    return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
  }

  it("keeps the player's own game when they start from a seed", () => {
    const s = store({ [SAVE_KEY]: 'own' });
    keepBackup(s);
    expect(s.map.get(BACKUP_KEY)).toBe('own');
  });

  it("never copies a seed's run over the player's own game", () => {
    const s = store({ [SAVE_KEY]: 'first seed', [BACKUP_KEY]: 'own', [SEED_RUN_KEY]: '1' });
    keepBackup(s);
    expect(s.map.get(BACKUP_KEY)).toBe('own');
  });

  it("keeps a seed's run when there is no backup to lose, and does nothing without a save", () => {
    const s = store({ [SAVE_KEY]: 'first seed', [SEED_RUN_KEY]: '1' });
    keepBackup(s);
    expect(s.map.get(BACKUP_KEY)).toBe('first seed');
    const empty = store({});
    keepBackup(empty);
    expect(empty.map.size).toBe(0);
  });
});

describe('the seed offer', () => {
  const strings = parseStrings(JSON.parse(readFileSync(join(LIVE_CONTENT_DIR, 'strings.json'), 'utf8')));

  function offer(own: ReturnType<typeof createSim> | null) {
    const focused: string[] = [];
    const node = (name: string) => ({
      textContent: '',
      hidden: false,
      addEventListener() {},
      focus: () => focused.push(name),
    });
    const dialog = { open: false, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; } };
    const elements = { dialog, title: node('title'), body: node('body'), replace: node('replace'), start: node('start'), keep: node('keep') };
    const store = { getItem: () => null, setItem() {} };
    offerSeed(elements as unknown as SeedOfferElements, played(60), own, config, strings, store, () => {}, () => {});
    return { focused, dialog };
  }

  it('starts on Keep my game when the player has a game to lose, so Enter never replaces it', () => {
    const { focused, dialog } = offer(played(30));
    expect(dialog.open).toBe(true);
    expect(focused).toEqual(['keep']);
  });

  it('leaves the focus where the dialog puts it when there is no game to lose', () => {
    expect(offer(null).focused).toEqual([]);
  });
});
