// Pure budget throttle from Appendix A: what is available, how many sessions may run,
// and whether a tick may start a card at all. The pool holds customer money only, so the
// money rules apply to unattended sessions; an attended session runs on the founder's
// subscription and needs only a board session and a free slot.
import type { Billing } from './db.js';
import { round4 } from './pricing.js';

export type AgentMode = 'attended' | 'unattended';

export function billingFor(mode: AgentMode): Billing {
  return mode === 'attended' ? 'founder' : 'studio';
}

export type SleepReason =
  | 'paused'
  | 'no_board_session'
  | 'daily_cap'
  | 'no_funded_cards'
  | 'insufficient_balance'
  | 'concurrency';

export type StartDecision = { ok: true } | { ok: false; reason: SleepReason };

export interface StartConditions {
  paused: boolean;
  mode: AgentMode;
  boardSessionActive: boolean;
  balanceUsd: number;
  dailySpentUsd: number;
  dailyCapUsd: number;
  availableUsd: number;
  smallestEstimateUsd: number | null;
  running: number;
  concurrency: number;
}

// available = balance − studio reserve − Σ estimates of cards already building or gated.
// The 10% chargeback reserve is held in pool.reserve_usd, outside balance_usd.
export function available(balanceUsd: number, studioReserveUsd: number, reservedEstimateUsd: number): number {
  return round4(balanceUsd - studioReserveUsd - reservedEstimateUsd);
}

// Unattended: min(2, floor(balance ÷ hourly rate)). Attended: one session, whatever the balance.
// DISPATCHER_MAX_CONCURRENCY caps both.
export function concurrency(balanceUsd: number, hourlyRateUsd: number, mode: AgentMode, maxConcurrency: number): number {
  if (mode === 'attended') return Math.min(1, maxConcurrency);
  const affordable = hourlyRateUsd > 0 ? Math.floor(balanceUsd / hourlyRateUsd) : 0;
  return Math.max(0, Math.min(2, affordable, maxConcurrency));
}

// The pool's day in New York as YYYY-MM-DD, the same calendar record_usage resets on.
export function newYorkDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// daily_spent_usd resets only when usage is recorded, so a row from an earlier day has spent
// nothing today.
export function spentToday(pool: { day: string; daily_spent_usd: number }, now: Date): number {
  return pool.day === newYorkDate(now) ? pool.daily_spent_usd : 0;
}

// Daily cap is min(balance, studio_state.daily_cap_usd).
export function effectiveDailyCap(balanceUsd: number, dailyCapUsd: number): number {
  return Math.min(balanceUsd, dailyCapUsd);
}

export function canStart(c: StartConditions): StartDecision {
  if (c.paused) {
    return { ok: false, reason: 'paused' };
  }
  if (c.mode === 'attended' && !c.boardSessionActive) {
    return { ok: false, reason: 'no_board_session' };
  }
  if (c.mode === 'unattended' && c.dailySpentUsd >= effectiveDailyCap(c.balanceUsd, c.dailyCapUsd)) {
    return { ok: false, reason: 'daily_cap' };
  }
  if (c.smallestEstimateUsd === null) {
    return { ok: false, reason: 'no_funded_cards' };
  }
  if (c.mode === 'unattended' && c.availableUsd < c.smallestEstimateUsd) {
    return { ok: false, reason: 'insufficient_balance' };
  }
  if (c.running >= c.concurrency) {
    return { ok: false, reason: 'concurrency' };
  }
  return { ok: true };
}
