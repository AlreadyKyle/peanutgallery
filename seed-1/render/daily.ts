// Daily Dust (docs/specs/daily-dust.md), the Three-free and DOM-free half: the ?daily= link, the
// record a daily run keeps under its own key (never the main save's), and the result it ends with,
// as numbers, a glyph row and the text a player shares. tests/daily.test.ts runs it in Node; the page
// half is render/daily-ui.ts and the picture render/daily-card.ts.
import { DAILY_MARK_SECONDS, DAILY_SECONDS, dailyDate, dailyOver, dailyScore, dailySeed, isDailyDate } from '../sim/daily';
import { parseSavedState, SAVE_VERSION } from '../sim/save';
import type { SimConfig, SimState } from '../sim/types';
import { fill, formatDust } from './format';
import { Game, type GameOptions } from './game';
import { PLAY_URL } from './seed-code';
import type { Strings } from './strings';

export const DAILY_PARAM = 'daily';
/** Where a daily run keeps its record: one day at a time, apart from the main save under dust.save. */
export const DAILY_KEY = 'dust.daily';
export const DAILY_RECORD_VERSION = 1;
/** How many marks a full run has: one each DAILY_MARK_SECONDS. */
export const DAILY_MARKS = Math.round(DAILY_SECONDS / DAILY_MARK_SECONDS);

/** One glyph per mark, a little to a lot. Block elements, never emoji, so every font draws them the same. */
export const ROW_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
/**
 * The dust made in one half minute that reaches each glyph above the first. Fixed, not scaled to the
 * run, so two players' rows compare: a run that only buys units draws ▁▁▁▁▂▂▂▃, a casual one about
 * ▁▂▃▄▄▄▄▄, a busy one climbs to █ (tests/daily.test.ts plays all three).
 */
export const ROW_STEPS = [100, 300, 1_000, 3_000, 10_000, 30_000, 100_000] as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A date as the page shows it: "17 October 2026". No locale call, so every viewer reads the same. */
export function formatDailyDate(date: string): string {
  if (!isDailyDate(date)) return date;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export interface DailyAsk {
  /** The day to play. */
  date: string;
  /** Whether the link asked for a day it cannot have (a future or malformed date), so today opened instead. */
  refused: boolean;
}

/** The day a page's query string (`location.search`) asks for, or null when it has no ?daily=. */
export function dailyFromSearch(search: string, nowMs: number): DailyAsk | null {
  const asked = new URLSearchParams(search).get(DAILY_PARAM);
  if (asked === null) return null;
  const date = dailyDate(asked === '' ? null : asked, nowMs);
  return { date, refused: asked !== '' && asked !== date };
}

/** The link that opens a day's run. */
export function dailyLink(date: string, base = PLAY_URL): string {
  return `${base}?${DAILY_PARAM}=${date}`;
}

/** What a daily run keeps: its day, the run's state, the lifetime dust at each mark so far and the devils caught. */
export interface DailyRecord {
  date: string;
  state: SimState;
  marks: number[];
  caught: number;
}

/** A fresh record for a day: the run from the day's seed, nothing played. */
export function freshDaily(date: string, initial: SimState): DailyRecord {
  return { date, state: initial, marks: [], caught: 0 };
}

/**
 * How a daily run steps (render/game.ts): at most a second a tick, so a hidden tab or time away earns
 * nothing; not before the player's first action; landing on each half-minute mark; ending at the
 * run's length.
 */
export const DAILY_GAME: GameOptions = { maxStepSeconds: 1, endAtSeconds: DAILY_SECONDS, stopsEvery: DAILY_MARK_SECONDS, waitForAction: true };

/**
 * The Game a daily run plays. It has no store, so nothing it does can write the player's own save under
 * dust.save; the run's record is written by saveDaily, under DAILY_KEY only.
 */
export function createDailyGame(config: SimConfig, record: DailyRecord): Game {
  return new Game(config, record.state, null, DAILY_GAME);
}

/** Writes the record under DAILY_KEY and nowhere else. Storage errors are swallowed so the run goes on. */
export function saveDaily(store: Pick<Storage, 'setItem'> | null, record: DailyRecord): void {
  if (store === null) return;
  try {
    store.setItem(DAILY_KEY, serializeDaily(record));
  } catch {
    // ignored
  }
}

export function serializeDaily(record: DailyRecord): string {
  return JSON.stringify({ version: DAILY_RECORD_VERSION, date: record.date, state: record.state, marks: record.marks, caught: record.caught });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The record stored for `date`, or null for none, another day's, or anything malformed. The state goes
 * through parseSavedState, so a record can never hold a state a save could not, and it must be that
 * day's run: its seed is the day's and it has not played past the run's length.
 */
export function parseDaily(raw: string | null, date: string): DailyRecord | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['version'] !== DAILY_RECORD_VERSION || parsed['date'] !== date) return null;
  const state = parseSavedState(JSON.stringify({ version: SAVE_VERSION, state: parsed['state'] }));
  if (state === null || state.seed !== dailySeed(date) || state.elapsedSeconds > DAILY_SECONDS) return null;
  const marks = parsed['marks'];
  const caught = parsed['caught'];
  if (!Array.isArray(marks) || marks.length > DAILY_MARKS || !marks.every((m) => typeof m === 'number' && Number.isFinite(m) && m >= 0)) return null;
  if (typeof caught !== 'number' || !Number.isInteger(caught) || caught < 0) return null;
  return { date, state, marks: marks as number[], caught };
}

export interface DailyResult {
  date: string;
  /** The score: every bit of dust the run made (sim/daily.ts dailyScore). */
  score: number;
  unlocked: number;
  total: number;
  caught: number;
  orders: number;
  /** One level (0 to 7) per half minute: how much dust that half minute made, on ROW_STEPS. */
  levels: number[];
}

/** The level a half minute's dust reaches on ROW_STEPS: 0 to 7. */
export function rowLevel(dust: number): number {
  let level = 0;
  for (const at of ROW_STEPS) if (dust >= at) level += 1;
  return level;
}

/** The dust each half minute made, from the lifetime dust at each mark; a missing mark counts the run's end. */
export function halfMinutes(marks: readonly number[], final: number): number[] {
  const out: number[] = [];
  let previous = 0;
  for (let i = 0; i < DAILY_MARKS; i += 1) {
    const at = marks[i] ?? final;
    out.push(Math.max(0, at - previous));
    previous = Math.max(previous, at);
  }
  return out;
}

export function dailyResult(record: DailyRecord, config: SimConfig): DailyResult {
  const score = dailyScore(record.state);
  return {
    date: record.date,
    score,
    unlocked: record.state.unlocked.length,
    total: config.unlocks.unlocks.length,
    caught: record.caught,
    orders: record.state.ordersFilled ?? 0,
    levels: halfMinutes(record.marks, score).map(rowLevel),
  };
}

/** Whether the record's run has played its full length. */
export function dailyFinished(record: DailyRecord): boolean {
  return dailyOver(record.state);
}

/** The glyph row: one block per half minute. */
export function dailyRow(levels: readonly number[]): string {
  return levels.map((level) => ROW_GLYPHS[Math.max(0, Math.min(ROW_GLYPHS.length - 1, level))]).join('');
}

/** The score line: "385,393 dust in 4 minutes". */
export function dailyScoreLine(result: DailyResult, strings: Strings): string {
  return fill(strings.daily.score, { score: formatDust(result.score), minutes: String(DAILY_SECONDS / 60) });
}

/**
 * The run's highlights, one or two: its unlocks, then the dust devils it caught or, with none caught,
 * the orders it filled.
 */
export function dailyHighlights(result: DailyResult, strings: Strings): string[] {
  const out = [fill(strings.daily.unlocks, { count: String(result.unlocked), total: String(result.total) })];
  if (result.caught > 0) out.push(result.caught === 1 ? strings.daily.devilOne : fill(strings.daily.devilMany, { count: String(result.caught) }));
  else if (result.orders > 0) out.push(result.orders === 1 ? strings.daily.orderOne : fill(strings.daily.orderMany, { count: String(result.orders) }));
  return out;
}

/**
 * The text a player shares, without the link (the share sheet takes it apart):
 *
 *   Daily Dust · 17 October 2026
 *   385,393 dust in 4 minutes
 *   ▃▄▆▆▇▇██
 *   7 of 25 unlocks · 2 dust devils caught
 *
 * Facts of the run only: no countdown, no chance cue, no money.
 */
export function dailyText(result: DailyResult, strings: Strings): string {
  return [
    fill(strings.daily.textTitle, { date: formatDailyDate(result.date) }),
    dailyScoreLine(result, strings),
    dailyRow(result.levels),
    dailyHighlights(result, strings).join(' · '),
  ].join('\n');
}

/** The text with the day's link on its own last line, for the clipboard. */
export function dailyCopyText(result: DailyResult, strings: Strings): string {
  return `${dailyText(result, strings)}\n${dailyLink(result.date)}`;
}

/** The row in words, for a screen reader: "Dust made each half minute, from 1 to 8: 3, 4, 6, 6, 7, 7, 8, 8." */
export function dailyRowWords(result: DailyResult, strings: Strings): string {
  return fill(strings.daily.rowWords, { levels: result.levels.map((level) => String(level + 1)).join(', ') });
}

/** "1:20" for 80 seconds: the time played so far, as the footer shows it. */
export function formatClock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
