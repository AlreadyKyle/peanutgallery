import { hashText } from './hash';
import type { SimState } from './types';

// Daily Dust (docs/specs/daily-dust.md): every UTC day, everyone plays the same run. The run's sim
// seed is a pure function of the day's date, so the same date always gives the same seed, on any
// device, with nothing read from a server. The run lasts DAILY_SECONDS of sim time and is scored by
// the dust it made. Like the rest of sim/, this reads no clock: the caller passes the time in.

/** The length of a daily run, in sim seconds: four minutes of play. */
export const DAILY_SECONDS = 240;
/** The run is summarised in marks this many seconds apart: eight of them in four minutes. */
export const DAILY_MARK_SECONDS = 30;
/** The earliest date a daily run opens for. */
export const DAILY_FIRST_DATE = '2026-01-01';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC calendar date of a wall-clock millisecond, as YYYY-MM-DD. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whether `text` is a real calendar date written YYYY-MM-DD (2026-02-30 is not). */
export function isDailyDate(text: string): boolean {
  const match = DATE.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * The day a daily run opens for: `asked` when it is a real date from DAILY_FIRST_DATE up to today
 * (UTC, from `nowMs`), and today otherwise. A future date is refused, so nobody plays tomorrow's run
 * early. YYYY-MM-DD strings sort as dates do.
 */
export function dailyDate(asked: string | null, nowMs: number): string {
  const today = utcDate(nowMs);
  if (asked === null || !isDailyDate(asked)) return today;
  if (asked < DAILY_FIRST_DATE || asked > today) return today;
  return asked;
}

/** The sim seed of a day's run: the first 32 bits of the sim's own hash of "dust-daily:<date>". */
export function dailySeed(date: string): number {
  return Number.parseInt(hashText(`dust-daily:${date}`).slice(0, 8), 16) >>> 0;
}

/** Whether a daily run has played its full length. */
export function dailyOver(state: SimState): boolean {
  return state.elapsedSeconds >= DAILY_SECONDS;
}

/** The sim seconds of play a daily run has left (0 once it is over). */
export function dailyLeft(state: SimState): number {
  return Math.max(0, DAILY_SECONDS - state.elapsedSeconds);
}

/**
 * A daily run's score: every bit of dust it made, from production, strikes, orders and dust devils,
 * across a press of the pile too (pastDust), so pressing never lowers it.
 */
export function dailyScore(state: SimState): number {
  return state.totalDust + (state.pastDust ?? 0);
}
