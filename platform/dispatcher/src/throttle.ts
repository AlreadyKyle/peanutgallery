// Pure budget throttle from Appendix A: whether a tick may start a card at all, how many sessions may
// run, and, in unattended mode, how much of the pool one card's session may spend. The pool holds
// customer money only, so the money rules apply to unattended sessions; an attended session runs on the
// founder's subscription and needs only a board session and a free slot, with its card ceiling as its
// only budget.
//
// The money rule (unattended only). spent_c is card c's studio-billed ledger sum, never actual_usd,
// which also counts founder-billed turns. Every card other than the candidate X holds money:
// - a proposed, designing, voted, funded or paused card holds the unspent part of its bar,
//   max(funded_c − spent_c, 0), whatever its horizon;
// - a building card holds what its session may still spend, max(budget_c − session_spent_c, 0), from
//   the running sessions' meters (budgets.ts), or its whole remaining ceiling when this process is not
//   running it;
// - a gated, live or rejected card holds nothing.
// available_X = balance − studio reserve − Σ holds of the other cards; an S1 card may add the incident
// reserve. X starts when what it still needs, max(estimate_X − spent_X, 0), fits available_X, what is
// left of the daily cap, what is left of the monthly cap, and the Console credit left. Its session
// budget is the smallest of those and its remaining ceiling, so the card ceiling bounds the budget and
// never the selection.
//
// The daily cap is measured against the day-start balance (the balance plus today's spend), so
// spending does not shrink the cap as the day goes on: min(day-start balance, cap) − spent today is
// min(balance, cap − spent today). Its balance side is covered by available_X, which is tighter, so the
// daily bound here is cap − spent today − what the running sessions may still spend, and a card that
// the balance stops is reported as insufficient_balance, never as the daily cap.
import { round4 } from './pricing.js';

export type AgentMode = 'attended' | 'unattended';

export function billingFor(mode: AgentMode): 'studio' | 'founder' {
  return mode === 'attended' ? 'founder' : 'studio';
}

export type MoneyReason = 'daily_cap' | 'monthly_cap' | 'console_credit' | 'insufficient_balance';

export type SleepReason = 'paused' | 'no_board_session' | 'no_funded_cards' | 'no_eligible_card' | 'concurrency' | MoneyReason;

export type StartDecision = { ok: true } | { ok: false; reason: SleepReason };

export interface StartConditions {
  paused: boolean;
  mode: AgentMode;
  boardSessionActive: boolean;
  // Cards in stage funded, and those of them a session may run for (select.ts runnable).
  fundedCount: number;
  runnableCount: number;
  running: number;
  concurrency: number;
}

// Whether a tick may try to start a card; the money is checked per card after this (planStart).
export function canStart(c: StartConditions): StartDecision {
  if (c.paused) return { ok: false, reason: 'paused' };
  if (c.mode === 'attended' && !c.boardSessionActive) return { ok: false, reason: 'no_board_session' };
  if (c.fundedCount === 0) return { ok: false, reason: 'no_funded_cards' };
  if (c.runnableCount === 0) return { ok: false, reason: 'no_eligible_card' };
  if (c.running >= c.concurrency) return { ok: false, reason: 'concurrency' };
  return { ok: true };
}

// The card ceiling: 150% of the estimate, capped by card_max_usd. It limits all of a card's spend.
export function ceilingUsd(estimateUsd: number, cardMaxUsd: number): number {
  return round4(Math.min(1.5 * estimateUsd, cardMaxUsd));
}

// Attended: one session. Unattended: one session whenever a card's money fits, which planStart
// decides per card, and two once the balance covers two hours at the hourly rate.
// DISPATCHER_MAX_CONCURRENCY caps both.
export function concurrency(balanceUsd: number, hourlyRateUsd: number, mode: AgentMode, maxConcurrency: number): number {
  if (mode === 'attended') return Math.min(1, maxConcurrency);
  const slots = hourlyRateUsd > 0 && balanceUsd >= 2 * hourlyRateUsd ? 2 : 1;
  return Math.max(0, Math.min(slots, maxConcurrency));
}

const NEW_YORK = 'America/New_York';

// The pool's day in New York as YYYY-MM-DD, the same calendar record_usage resets on.
export function newYorkDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NEW_YORK, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// The New York month as YYYY-MM.
export function newYorkMonth(now: Date): string {
  return newYorkDate(now).slice(0, 7);
}

// The instant New York's current month began: midnight on the 1st, New York time.
export function newYorkMonthStart(now: Date): Date {
  const [year, month] = newYorkMonth(now).split('-').map(Number) as [number, number];
  const midnightUtc = Date.UTC(year, month - 1, 1);
  // New York's offset at that midnight, read five hours after it in UTC (still the 1st in New York,
  // and never across a daylight-saving change, which happens at 2 a.m. local).
  const probe = new Date(midnightUtc + 5 * 60 * 60_000);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NEW_YORK, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(probe);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
  const offsetMs = wall - probe.getTime();
  return new Date(midnightUtc - offsetMs);
}

// daily_spent_usd resets only when usage is recorded, so a row from an earlier day has spent
// nothing today.
export function spentToday(pool: { day: string; daily_spent_usd: number }, now: Date): number {
  return pool.day === newYorkDate(now) ? pool.daily_spent_usd : 0;
}

// The stages whose bar money is held for the card between sessions.
export const HOLD_STAGES: readonly string[] = ['proposed', 'designing', 'voted', 'funded', 'paused'];

export interface MoneyCard {
  id: string;
  stage: string;
  estimate_usd: number;
  actual_usd: number;
  funded_usd: number;
  severity: string | null;
}

export interface MoneyState {
  balanceUsd: number;
  studioReserveUsd: number;
  incidentReserveUsd: number;
  cardMaxUsd: number;
  dailyCapUsd: number;
  spentTodayUsd: number;
  // null when studio_state carries no monthly cap: nothing may start until the board sets one.
  monthlyCapUsd: number | null;
  spentThisMonthUsd: number;
  // Console credit bought, and every studio and overhead ledger row ever written against it.
  creditPurchasedUsd: number;
  creditSpentUsd: number;
  // Every card that can hold money: the hold stages and building.
  cards: readonly MoneyCard[];
  // spent_c: each card's studio-billed ledger sum.
  spent: ReadonlyMap<string, number>;
  // What each session this process runs may still spend (budgets.ts).
  running: ReadonlyMap<string, number>;
}

export function holdUsd(card: MoneyCard, state: Pick<MoneyState, 'spent' | 'running' | 'cardMaxUsd'>): number {
  const spent = state.spent.get(card.id) ?? 0;
  if (HOLD_STAGES.includes(card.stage)) return Math.max(0, round4(card.funded_usd - spent));
  if (card.stage === 'building') {
    const left = state.running.get(card.id);
    return left !== undefined ? Math.max(0, left) : Math.max(0, round4(ceilingUsd(card.estimate_usd, state.cardMaxUsd) - card.actual_usd));
  }
  return 0;
}

// What the building cards' sessions may still spend, which the daily cap, the monthly cap and the
// Console credit must still cover.
export function runningHoldUsd(state: MoneyState): number {
  return round4(state.cards.filter((card) => card.stage === 'building').reduce((total, card) => total + holdUsd(card, state), 0));
}

export interface MoneyBounds {
  // balance − studio reserve − the other cards' holds, plus the incident reserve for an S1 card.
  availableUsd: number;
  // Each cap less its spend so far and what the running sessions may still spend.
  dailyUsd: number;
  monthlyUsd: number;
  // The Console credit bought, less every studio and overhead row, less the running sessions' budgets.
  creditUsd: number;
}

export function moneyBounds(state: MoneyState, x: MoneyCard): MoneyBounds {
  const others = state.cards.filter((card) => card.id !== x.id).reduce((total, card) => total + holdUsd(card, state), 0);
  const incident = x.severity === 's1' ? state.incidentReserveUsd : 0;
  const running = runningHoldUsd(state);
  return {
    availableUsd: round4(state.balanceUsd - state.studioReserveUsd - others + incident),
    dailyUsd: round4(state.dailyCapUsd - state.spentTodayUsd - running),
    monthlyUsd: state.monthlyCapUsd === null ? 0 : round4(state.monthlyCapUsd - state.spentThisMonthUsd - running),
    creditUsd: round4(state.creditPurchasedUsd - state.creditSpentUsd - running),
  };
}

export type StartPlan = { ok: true; budgetUsd: number; needUsd: number; bounds: MoneyBounds } | { ok: false; reason: MoneyReason; needUsd: number; bounds: MoneyBounds };

// Whether card X may start in unattended mode, and its session budget.
export function planStart(state: MoneyState, x: MoneyCard): StartPlan {
  const bounds = moneyBounds(state, x);
  const needUsd = Math.max(0, round4(x.estimate_usd - (state.spent.get(x.id) ?? 0)));
  const fits = (limit: number) => limit > 0 && needUsd <= limit;
  if (!fits(bounds.dailyUsd)) return { ok: false, reason: 'daily_cap', needUsd, bounds };
  if (!fits(bounds.monthlyUsd)) return { ok: false, reason: 'monthly_cap', needUsd, bounds };
  if (!fits(bounds.creditUsd)) return { ok: false, reason: 'console_credit', needUsd, bounds };
  if (!fits(bounds.availableUsd)) return { ok: false, reason: 'insufficient_balance', needUsd, bounds };
  const ceilingLeft = round4(ceilingUsd(x.estimate_usd, state.cardMaxUsd) - x.actual_usd);
  const budgetUsd = round4(Math.min(ceilingLeft, bounds.availableUsd, bounds.dailyUsd, bounds.monthlyUsd, bounds.creditUsd));
  return { ok: true, budgetUsd, needUsd, bounds };
}
