// Pure budget throttle from Appendix A: what is available, how many sessions may run,
// and whether a tick may start a card at all.
import { round4 } from './pricing.js';

export type AgentMode = 'attended' | 'unattended';

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

// concurrency = min(2, floor(balance ÷ hourly rate)); attended mode runs one session at a time;
// DISPATCHER_MAX_CONCURRENCY caps it further.
export function concurrency(balanceUsd: number, hourlyRateUsd: number, mode: AgentMode, maxConcurrency: number): number {
  const modeCap = mode === 'attended' ? 1 : 2;
  const affordable = hourlyRateUsd > 0 ? Math.floor(balanceUsd / hourlyRateUsd) : 0;
  return Math.max(0, Math.min(modeCap, affordable, maxConcurrency));
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
  if (c.dailySpentUsd >= effectiveDailyCap(c.balanceUsd, c.dailyCapUsd)) {
    return { ok: false, reason: 'daily_cap' };
  }
  if (c.smallestEstimateUsd === null) {
    return { ok: false, reason: 'no_funded_cards' };
  }
  if (c.availableUsd < c.smallestEstimateUsd) {
    return { ok: false, reason: 'insufficient_balance' };
  }
  if (c.running >= c.concurrency) {
    return { ok: false, reason: 'concurrency' };
  }
  return { ok: true };
}
