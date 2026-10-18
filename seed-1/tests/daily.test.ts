import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import {
  createDailyGame,
  DAILY_KEY,
  dailyCopyText,
  dailyFromSearch,
  dailyHighlights,
  dailyResult,
  dailyRow,
  dailyText,
  formatClock,
  formatDailyDate,
  freshDaily,
  halfMinutes,
  parseDaily,
  rowLevel,
  saveDaily,
  serializeDaily,
  type DailyRecord,
  type DailyResult,
} from '../render/daily';
import { barLayout, dailyFacts, drawDailyCard } from '../render/daily-card';
import { SAVE_KEY } from '../render/game';
import { IMAGE_HEIGHT, IMAGE_WIDTH, type CardContext } from '../render/share-image';
import { parseStrings } from '../render/strings';
import { DAILY_MARK_SECONDS, DAILY_SECONDS, dailyDate, dailyLeft, dailyOver, dailyScore, dailySeed, isDailyDate, utcDate } from '../sim/daily';
import { hashText } from '../sim/hash';
import { serializeState } from '../sim/save';
import { createSim, step } from '../sim/sim';
import { LIVE_CONFIG_DIR, LIVE_CONTENT_DIR } from './paths';
import { ACTIVE, CASUAL, play, type Player } from './playtest';

// Daily Dust (docs/specs/daily-dust.md): the day's seed, the run's length and end, its record apart
// from the main save, and the result a player shares.
const config = loadConfigFromDir(LIVE_CONFIG_DIR);
const strings = parseStrings(JSON.parse(readFileSync(join(LIVE_CONTENT_DIR, 'strings.json'), 'utf8')));
const NOON = Date.parse('2026-10-17T12:00:00Z');
const DAY_MS = 86_400_000;

function memoryStore(entries: Record<string, string> = {}) {
  const items = new Map(Object.entries(entries));
  const writes: string[] = [];
  return {
    items,
    writes,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("the day's seed", () => {
  it('is the first 32 bits of the sim hash of dust-daily:<date>, and stays put', () => {
    expect(dailySeed('2026-10-17')).toBe(Number.parseInt(hashText('dust-daily:2026-10-17').slice(0, 8), 16));
    // Pinned: a change here gives every past day a different run.
    expect(dailySeed('2026-10-17')).toBe(2883958054);
    expect(dailySeed('2026-10-17')).toBe(dailySeed('2026-10-17'));
  });

  it('differs from day to day across a year', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 366; i += 1) seeds.add(dailySeed(utcDate(Date.parse('2026-01-01T00:00:00Z') + i * DAY_MS)));
    expect(seeds.size).toBe(366);
  });

  it('gives everyone the same run: the same date and the same play land on the same state', () => {
    const run = (): string => {
      const game = createDailyGame(config, freshDaily('2026-10-17', createSim(config, dailySeed('2026-10-17'))));
      game.act({ type: 'strike' });
      for (let t = 0; t <= 300_000; t += 250) {
        game.tick(t);
        if (t % 1000 === 0) game.act({ type: 'strike' });
      }
      return serializeState(game.state);
    };
    expect(run()).toBe(run());
  });
});

describe('the day a link opens', () => {
  it('reads dates as UTC calendar days', () => {
    expect(utcDate(Date.parse('2026-10-17T23:59:59Z'))).toBe('2026-10-17');
    expect(utcDate(Date.parse('2026-10-18T00:00:00Z'))).toBe('2026-10-18');
    expect(isDailyDate('2026-02-28')).toBe(true);
    expect(isDailyDate('2026-02-30')).toBe(false);
    expect(isDailyDate('2026-1-5')).toBe(false);
    expect(isDailyDate('tomorrow')).toBe(false);
  });

  it('opens a past day, and refuses a future one (or nonsense) for today', () => {
    expect(dailyDate('2026-10-17', NOON)).toBe('2026-10-17');
    expect(dailyDate('2026-10-01', NOON)).toBe('2026-10-01');
    expect(dailyDate('2026-10-18', NOON)).toBe('2026-10-17');
    expect(dailyDate('2999-01-01', NOON)).toBe('2026-10-17');
    expect(dailyDate('2025-12-31', NOON)).toBe('2026-10-17');
    expect(dailyDate('2026-02-30', NOON)).toBe('2026-10-17');
    expect(dailyDate(null, NOON)).toBe('2026-10-17');
  });

  it('reads ?daily= from the address, saying when it opened today instead of the day asked', () => {
    expect(dailyFromSearch('', NOON)).toBeNull();
    expect(dailyFromSearch('?seed=dust:v1:x', NOON)).toBeNull();
    expect(dailyFromSearch('?daily=', NOON)).toEqual({ date: '2026-10-17', refused: false });
    expect(dailyFromSearch('?daily=2026-10-16', NOON)).toEqual({ date: '2026-10-16', refused: false });
    expect(dailyFromSearch('?daily=2026-10-18', NOON)).toEqual({ date: '2026-10-17', refused: true });
    expect(dailyFromSearch('?daily=%3Cb%3E', NOON)).toEqual({ date: '2026-10-17', refused: true });
  });

  it('writes the day long, with no locale call', () => {
    expect(formatDailyDate('2026-10-17')).toBe('17 October 2026');
    expect(formatDailyDate('2027-01-05')).toBe('5 January 2027');
  });
});

describe('the run: four minutes of play', () => {
  const fresh = (): DailyRecord => freshDaily('2026-10-17', createSim(config, dailySeed('2026-10-17')));

  it('waits for the first action, then steps at most a second a tick, so time away earns nothing', () => {
    const game = createDailyGame(config, fresh());
    game.tick(0);
    game.tick(60_000);
    expect(game.state.elapsedSeconds).toBe(0);
    expect(game.idle).toBe(true);
    game.act({ type: 'strike' });
    expect(game.idle).toBe(false);
    game.tick(100_000);
    game.tick(100_500);
    expect(game.state.elapsedSeconds).toBeCloseTo(0.5, 9);
    // An hour in another tab: one second.
    game.tick(100_500 + 3_600_000);
    expect(game.state.elapsedSeconds).toBeCloseTo(1.5, 9);
  });

  it(`lands on each ${DAILY_MARK_SECONDS}-second mark, ends at exactly ${DAILY_SECONDS} seconds, and refuses play after`, () => {
    const game = createDailyGame(config, fresh());
    const marks: number[] = [];
    let ended = 0;
    game.listen({ mark: (index, state) => marks.push(index * 1000 + state.elapsedSeconds), ended: () => (ended += 1) });
    game.act({ type: 'strike' });
    for (let t = 0; t <= 400_000; t += 700) game.tick(t);
    expect(marks).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((i) => i * 1000 + i * DAILY_MARK_SECONDS));
    expect(game.state.elapsedSeconds).toBe(DAILY_SECONDS);
    expect(dailyOver(game.state)).toBe(true);
    expect(dailyLeft(game.state)).toBe(0);
    expect(game.over).toBe(true);
    expect(ended).toBe(1);
    const final = game.state;
    expect(game.act({ type: 'strike' })).toBe(final);
    game.tick(500_000);
    expect(game.state).toBe(final);
  });

  it('a record reopened after its end is over at once', () => {
    const game = createDailyGame(config, { ...fresh(), state: { ...fresh().state, elapsedSeconds: DAILY_SECONDS } });
    expect(game.over).toBe(true);
  });

  it('never touches the main save: the daily Game has no store, and its record goes under dust.daily alone', () => {
    const own = serializeState(step(createSim(config, 7), config, 900), 1_700_000_000_000);
    const store = memoryStore({ [SAVE_KEY]: own });
    const record = fresh();
    const game = createDailyGame(config, record);
    game.act({ type: 'strike' });
    for (let t = 0; t <= 300_000; t += 1000) {
      game.tick(t);
      game.save(t);
      saveDaily(store, { ...record, state: game.state });
    }
    expect(store.items.get(SAVE_KEY)).toBe(own);
    expect(new Set(store.writes)).toEqual(new Set([DAILY_KEY]));
    expect(parseDaily(store.items.get(DAILY_KEY) ?? null, '2026-10-17')?.state).toEqual(game.state);
  });

  it(`fits ${DAILY_SECONDS / 60} minutes to the pacing: an active player meets orders, a dust devil, the weather and a fork`, () => {
    const run = play(config, ACTIVE, DAILY_SECONDS);
    const kinds = new Set(run.moments.map((m) => m.kind));
    for (const kind of ['unlock', 'order', 'devil', 'weather', 'fork'] as const) expect(kinds, kind).toContain(kind);
    // A casual player still opens several unlocks and fills orders.
    const casual = play(config, CASUAL, DAILY_SECONDS);
    expect(casual.state.unlocked.length).toBeGreaterThanOrEqual(3);
    expect(casual.state.ordersFilled ?? 0).toBeGreaterThan(0);
  });
});

describe('the record kept for a day', () => {
  const record: DailyRecord = {
    date: '2026-10-17',
    state: { ...createSim(config, dailySeed('2026-10-17')), elapsedSeconds: 90, totalDust: 900, dust: 400 },
    marks: [100, 400, 800],
    caught: 1,
  };

  it('round-trips, and is that day only', () => {
    const raw = serializeDaily(record);
    expect(parseDaily(raw, '2026-10-17')).toEqual(record);
    expect(parseDaily(raw, '2026-10-16')).toBeNull();
    expect(parseDaily(null, '2026-10-17')).toBeNull();
    expect(parseDaily('not json', '2026-10-17')).toBeNull();
  });

  it("refuses a state that is not the day's run or has played past its length", () => {
    const other = serializeDaily({ ...record, state: { ...record.state, seed: 7 } });
    expect(parseDaily(other, '2026-10-17')).toBeNull();
    const long = serializeDaily({ ...record, state: { ...record.state, elapsedSeconds: DAILY_SECONDS + 1 } });
    expect(parseDaily(long, '2026-10-17')).toBeNull();
    const negative = serializeDaily({ ...record, caught: -1 });
    expect(parseDaily(negative, '2026-10-17')).toBeNull();
  });
});

describe('the result', () => {
  const result: DailyResult = { date: '2026-10-17', score: 385_393, unlocked: 7, total: 25, caught: 2, orders: 5, levels: [2, 4, 5, 5, 6, 6, 7, 7] };

  it('scores every bit of dust the run made, across a press too', () => {
    const state = { ...createSim(config, 1), totalDust: 1200, pastDust: 300 };
    expect(dailyScore(state)).toBe(1500);
    const record = { ...freshDaily('2026-10-17', state), marks: [100, 400] };
    expect(dailyResult(record, config).score).toBe(1500);
  });

  it('reads the row on a fixed scale, so two players compare', () => {
    expect([0, 99, 100, 299, 300, 1_000, 3_000, 10_000, 30_000, 99_999, 100_000, 1e9].map(rowLevel)).toEqual([0, 0, 1, 1, 2, 3, 4, 5, 6, 6, 7, 7]);
    expect(halfMinutes([100, 400], 1000)).toEqual([100, 300, 600, 0, 0, 0, 0, 0]);
    // A run left alone after its first strike stays on the first glyph.
    const game = createDailyGame(config, freshDaily('2026-10-17', createSim(config, dailySeed('2026-10-17'))));
    const marks: number[] = [];
    game.listen({ mark: (_i, state) => marks.push(dailyScore(state)) });
    game.act({ type: 'strike' });
    for (let t = 0; t <= 300_000; t += 1000) game.tick(t);
    expect(dailyRow(halfMinutes(marks, dailyScore(game.state)).map(rowLevel))).toBe('▁▁▁▁▁▁▁▁');
    // The rows ROW_STEPS documents, from the scripted players (tests/playtest.ts) on one seed.
    const row = (player: Player): string => {
      const at = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => dailyScore(play(config, player, k * DAILY_MARK_SECONDS, 1).state));
      return dailyRow(halfMinutes(at, at[7]!).map(rowLevel));
    };
    expect(row({ name: 'buys only', strikesPerSecond: 0, reactSeconds: 1000 })).toBe('▁▁▁▁▂▂▂▃');
    expect(row(CASUAL)).toBe('▁▂▃▄▄▄▄▄');
    expect(row(ACTIVE)).toMatch(/█$/);
  });

  it('shares five short lines: the day, the score, the row, the highlights and the link', () => {
    expect(dailyText(result, strings)).toBe(
      ['Daily Dust · 17 October 2026', '385,393 dust in 4 minutes', '▃▅▆▆▇▇██', '7 of 25 unlocks · 2 dust devils caught'].join('\n'),
    );
    expect(dailyCopyText(result, strings).split('\n').at(-1)).toBe('https://play.mobmachine.games/?daily=2026-10-17');
  });

  it('names one or two highlights: unlocks, then devils caught or else orders filled', () => {
    expect(dailyHighlights({ ...result, caught: 1 }, strings)).toEqual(['7 of 25 unlocks', '1 dust devil caught']);
    expect(dailyHighlights({ ...result, caught: 0 }, strings)).toEqual(['7 of 25 unlocks', '5 orders filled']);
    expect(dailyHighlights({ ...result, caught: 0, orders: 1 }, strings)).toEqual(['7 of 25 unlocks', '1 order filled']);
    expect(dailyHighlights({ ...result, caught: 0, orders: 0 }, strings)).toEqual(['7 of 25 unlocks']);
  });

  it('carries no countdown, chance cue, money, emoji or unfilled template key', () => {
    for (const variant of [result, { ...result, caught: 0 }, { ...result, caught: 0, orders: 0 }]) {
      const text = dailyCopyText(variant, strings);
      expect(text).not.toMatch(/\{\w+\}/);
      expect(text).not.toMatch(/\b(left|remaining|ends?|expires?|hurry|streak|luck|lucky|chance|odds|roll|win|prize|pay|price|cost|buy|\$|usd|dollars?)\b/i);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text.length).toBeLessThan(200);
    }
  });

  it('draws the card inside 1200 by 630: eight bars, the highlights and the address', () => {
    const texts: Array<{ text: string; x: number; y: number }> = [];
    const rects: Array<[number, number, number, number]> = [];
    const ctx = {
      fillRect: () => undefined,
      fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
      measureText: (text: string) => ({ width: text.length * 18 }),
      beginPath: () => undefined,
      arc: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      roundRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
    } as unknown as CardContext;
    const facts = dailyFacts(result, strings);
    drawDailyCard(ctx, facts);
    expect(texts.map((t) => t.text)).toEqual(
      expect.arrayContaining(['Daily Dust', '17 October 2026', '385,393', 'dust in 4 minutes', '7 of 25 unlocks', '2 dust devils caught', 'play.mobmachine.games/?daily=2026-10-17']),
    );
    expect(barLayout(facts.levels)).toHaveLength(8);
    for (const [x, y, w, h] of rects) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(IMAGE_WIDTH);
      expect(y + h).toBeLessThan(IMAGE_HEIGHT - 40);
    }
    for (const t of texts) expect(t.x + t.text.length * 18).toBeLessThanOrEqual(IMAGE_WIDTH);
  });

  it('shows time played as a clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(80.9)).toBe('1:20');
    expect(formatClock(DAILY_SECONDS)).toBe('4:00');
  });
});
