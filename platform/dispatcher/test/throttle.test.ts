import { describe, expect, it } from 'vitest';
import {
  billingFor,
  canStart,
  ceilingUsd,
  concurrency,
  holdUsd,
  newYorkDate,
  newYorkMonth,
  newYorkMonthStart,
  planStart,
  spentToday,
  type MoneyCard,
  type MoneyState,
  type StartConditions,
} from '../src/throttle.js';

const base: StartConditions = {
  paused: false,
  mode: 'attended',
  boardSessionActive: true,
  fundedCount: 1,
  runnableCount: 1,
  running: 0,
  concurrency: 1,
};

function money(overrides: Partial<MoneyState> = {}): MoneyState {
  return {
    balanceUsd: 50,
    studioReserveUsd: 0,
    incidentReserveUsd: 0,
    cardMaxUsd: 25,
    dailyCapUsd: 100,
    spentTodayUsd: 0,
    monthlyCapUsd: 500,
    spentThisMonthUsd: 0,
    creditPurchasedUsd: 1000,
    creditSpentUsd: 0,
    cards: [],
    spent: new Map(),
    running: new Map(),
    ...overrides,
  };
}

function moneyCard(overrides: Partial<MoneyCard> & { id: string }): MoneyCard {
  return { stage: 'funded', estimate_usd: 10, actual_usd: 0, funded_usd: 10, severity: null, ...overrides };
}

describe('billingFor', () => {
  it('bills attended sessions to the founder and unattended sessions to the studio, never to overhead', () => {
    expect(billingFor('attended')).toBe('founder');
    expect(billingFor('unattended')).toBe('studio');
  });
});

describe('New York calendar', () => {
  it('counts the day spend only when the pool row is from today in New York', () => {
    const now = new Date('2026-09-15T03:30:00.000Z');
    expect(newYorkDate(now)).toBe('2026-09-14');
    expect(spentToday({ day: '2026-09-14', daily_spent_usd: 100 }, now)).toBe(100);
    expect(spentToday({ day: '2026-09-13', daily_spent_usd: 100 }, now)).toBe(0);
  });

  it('starts the month at midnight New York time, in daylight time and in standard time', () => {
    expect(newYorkMonthStart(new Date('2026-09-22T15:00:00.000Z')).toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(newYorkMonthStart(new Date('2026-11-15T15:00:00.000Z')).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(newYorkMonthStart(new Date('2026-12-10T15:00:00.000Z')).toISOString()).toBe('2026-12-01T05:00:00.000Z');
    // Still September in New York.
    expect(newYorkMonth(new Date('2026-10-01T02:00:00.000Z'))).toBe('2026-09');
    expect(newYorkMonthStart(new Date('2026-10-01T02:00:00.000Z')).toISOString()).toBe('2026-09-01T04:00:00.000Z');
  });
});

describe('concurrency', () => {
  it('is one in attended mode whatever the balance', () => {
    expect(concurrency(50, 5, 'attended', 2)).toBe(1);
    expect(concurrency(0, 5, 'attended', 2)).toBe(1);
  });
  it('gives one slot in unattended mode below twice the hourly rate, so a pool under $5 still runs a card', () => {
    expect(concurrency(3, 5, 'unattended', 2)).toBe(1);
    expect(concurrency(0, 5, 'unattended', 2)).toBe(1);
    expect(concurrency(9.99, 5, 'unattended', 2)).toBe(1);
  });
  it('gives two slots once the balance covers two hours', () => {
    expect(concurrency(10, 5, 'unattended', 2)).toBe(2);
    expect(concurrency(50, 5, 'unattended', 2)).toBe(2);
  });
  it('honours the configured maximum, and gives one slot at a zero rate', () => {
    expect(concurrency(50, 5, 'unattended', 1)).toBe(1);
    expect(concurrency(50, 0, 'unattended', 2)).toBe(1);
  });
});

describe('canStart', () => {
  it('starts when every condition holds', () => {
    expect(canStart(base)).toEqual({ ok: true });
  });
  it('sleeps while paused', () => {
    expect(canStart({ ...base, paused: true })).toEqual({ ok: false, reason: 'paused' });
  });
  it('sleeps in attended mode without a board session', () => {
    expect(canStart({ ...base, boardSessionActive: false })).toEqual({ ok: false, reason: 'no_board_session' });
    expect(canStart({ ...base, mode: 'unattended', boardSessionActive: false })).toEqual({ ok: true });
  });
  it('sleeps with no funded cards, and with funded cards none of which may run', () => {
    expect(canStart({ ...base, fundedCount: 0, runnableCount: 0 })).toEqual({ ok: false, reason: 'no_funded_cards' });
    expect(canStart({ ...base, runnableCount: 0 })).toEqual({ ok: false, reason: 'no_eligible_card' });
  });
  it('sleeps when every session slot is taken', () => {
    expect(canStart({ ...base, running: 1 })).toEqual({ ok: false, reason: 'concurrency' });
    expect(canStart({ ...base, concurrency: 0 })).toEqual({ ok: false, reason: 'concurrency' });
  });
});

describe('holdUsd', () => {
  const state = { spent: new Map([['a', 4]]), running: new Map([['b', 3]]), cardMaxUsd: 25 };
  it('holds the unspent bar of a card waiting for, or between, sessions, whatever its stage before building', () => {
    for (const stage of ['proposed', 'designing', 'voted', 'funded', 'paused']) {
      expect(holdUsd(moneyCard({ id: 'a', stage }), state)).toBe(6);
    }
  });
  it('never holds less than nothing for an overspent card', () => {
    expect(holdUsd(moneyCard({ id: 'a', stage: 'paused', funded_usd: 3 }), state)).toBe(0);
  });
  it('holds what a building session may still spend, or its whole remaining ceiling when this process is not running it', () => {
    expect(holdUsd(moneyCard({ id: 'b', stage: 'building' }), state)).toBe(3);
    expect(holdUsd(moneyCard({ id: 'c', stage: 'building', estimate_usd: 10, actual_usd: 2 }), state)).toBe(13);
  });
  it('holds nothing for a gated, live or rejected card', () => {
    for (const stage of ['gated', 'live', 'rejected']) expect(holdUsd(moneyCard({ id: 'a', stage }), state)).toBe(0);
  });
  it('reads spend from the studio-billed sum, so founder-billed turns in actual_usd free no bar money', () => {
    expect(holdUsd(moneyCard({ id: 'f', stage: 'paused', funded_usd: 5, actual_usd: 5 }), state)).toBe(5);
  });
});

describe('planStart', () => {
  it('starts a card whose own full bar is its only money, with a budget of that bar (A of a $20 pool of two $10 bars)', () => {
    const a = moneyCard({ id: 'a' });
    const c = moneyCard({ id: 'c' });
    const plan = planStart(money({ balanceUsd: 20, cards: [a, c] }), a);
    expect(plan).toMatchObject({ ok: true, budgetUsd: 10, needUsd: 10 });
    expect(ceilingUsd(a.estimate_usd, 25)).toBe(15);
  });

  it('starts a lone fully funded card whose bar is the whole pool', () => {
    const a = moneyCard({ id: 'a' });
    expect(planStart(money({ balanceUsd: 10, cards: [a] }), a)).toMatchObject({ ok: true, budgetUsd: 10 });
  });

  it('keeps a partly filled card bar from another card', () => {
    const proposed = moneyCard({ id: 'p', stage: 'proposed', funded_usd: 5, estimate_usd: 8 });
    const x = moneyCard({ id: 'x', estimate_usd: 12 });
    expect(planStart(money({ balanceUsd: 15, cards: [proposed, x] }), x)).toMatchObject({ ok: false, reason: 'insufficient_balance', bounds: { availableUsd: 10 } });
  });

  it('does not let an overspent paused card raise what is available', () => {
    const paused = moneyCard({ id: 'p', stage: 'paused', funded_usd: 5 });
    const x = moneyCard({ id: 'x' });
    const plan = planStart(money({ balanceUsd: 10, cards: [paused, x], spent: new Map([['p', 8]]) }), x);
    expect(plan).toMatchObject({ ok: true, budgetUsd: 10, bounds: { availableUsd: 10 } });
  });

  it('holds nothing for a gated card, so its finished session frees the pool', () => {
    const gated = moneyCard({ id: 'g', stage: 'gated' });
    const x = moneyCard({ id: 'x' });
    expect(planStart(money({ balanceUsd: 10, cards: [gated, x] }), x)).toMatchObject({ ok: true, budgetUsd: 10 });
  });

  it('counts a building card as what its session may still spend, which shrinks as it spends', () => {
    const building = moneyCard({ id: 'b', stage: 'building' });
    const x = moneyCard({ id: 'x', estimate_usd: 4, funded_usd: 4 });
    const at = (left: number) => planStart(money({ balanceUsd: 14, cards: [building, x], running: new Map([['b', left]]) }), x);
    expect(at(10)).toMatchObject({ ok: true, budgetUsd: 4, bounds: { availableUsd: 4 } });
    expect(at(6)).toMatchObject({ ok: true, budgetUsd: 6, bounds: { availableUsd: 8 } });
  });

  it('lets an S1 card start on the incident reserve, and puts the reserve in its budget', () => {
    const s1 = moneyCard({ id: 's', severity: 's1', funded_usd: 0, estimate_usd: 10 });
    const s2 = moneyCard({ id: 't', severity: 's2', funded_usd: 0, estimate_usd: 10 });
    expect(planStart(money({ balanceUsd: 4, incidentReserveUsd: 8, cards: [s1] }), s1)).toMatchObject({ ok: true, budgetUsd: 12 });
    expect(planStart(money({ balanceUsd: 4, incidentReserveUsd: 8, cards: [s2] }), s2)).toMatchObject({ ok: false, reason: 'insufficient_balance' });
  });

  it('never gives a budget above the card ceiling left', () => {
    const x = moneyCard({ id: 'x', estimate_usd: 10, actual_usd: 12 });
    expect(planStart(money({ balanceUsd: 50, cards: [x] }), x)).toMatchObject({ ok: true, budgetUsd: 3 });
  });

  describe('Console credit', () => {
    it('bounds the budget by the credit left: a $50 pool with $10 of credit gives at most $10', () => {
      const x = moneyCard({ id: 'x', estimate_usd: 8, funded_usd: 50 });
      expect(planStart(money({ balanceUsd: 50, creditPurchasedUsd: 10, cards: [x] }), x)).toMatchObject({ ok: true, budgetUsd: 10 });
    });
    it('counts studio and overhead spend and the running sessions against the credit', () => {
      const building = moneyCard({ id: 'b', stage: 'building' });
      const x = moneyCard({ id: 'x', estimate_usd: 2, funded_usd: 2 });
      const state = money({ balanceUsd: 50, creditPurchasedUsd: 10, creditSpentUsd: 6, cards: [building, x], running: new Map([['b', 3]]) });
      expect(planStart(state, x)).toMatchObject({ ok: false, reason: 'console_credit', bounds: { creditUsd: 1 } });
    });
  });

  describe('monthly cap', () => {
    it('starts nothing once the month-to-date spend reaches the cap', () => {
      const x = moneyCard({ id: 'x', estimate_usd: 1, funded_usd: 1 });
      expect(planStart(money({ monthlyCapUsd: 500, spentThisMonthUsd: 500, cards: [x] }), x)).toMatchObject({ ok: false, reason: 'monthly_cap' });
      expect(planStart(money({ monthlyCapUsd: 500, spentThisMonthUsd: 496, cards: [x] }), x)).toMatchObject({ ok: true, budgetUsd: 1.5 });
    });
    it('starts nothing when studio_state has no monthly cap', () => {
      const x = moneyCard({ id: 'x' });
      expect(planStart(money({ monthlyCapUsd: null, cards: [x] }), x)).toMatchObject({ ok: false, reason: 'monthly_cap' });
    });
  });

  describe('daily cap', () => {
    it('bounds the budget by the cap left: $99 spent of $100 gives at most $1', () => {
      const small = moneyCard({ id: 's', estimate_usd: 0.5, funded_usd: 0.5 });
      expect(planStart(money({ spentTodayUsd: 99, cards: [small] }), small)).toMatchObject({ ok: true, budgetUsd: 0.75 });
      const x = moneyCard({ id: 'x', estimate_usd: 2, funded_usd: 2 });
      expect(planStart(money({ spentTodayUsd: 99, cards: [x] }), x)).toMatchObject({ ok: false, reason: 'daily_cap' });
      const big = moneyCard({ id: 'x', estimate_usd: 1, funded_usd: 1 });
      expect(planStart(money({ spentTodayUsd: 99, cards: [big] }), big)).toMatchObject({ ok: true, budgetUsd: 1 });
    });
    it('counts what running sessions may still spend against the cap', () => {
      const building = moneyCard({ id: 'b', stage: 'building' });
      const x = moneyCard({ id: 'x', estimate_usd: 8, funded_usd: 8 });
      const state = money({ spentTodayUsd: 85, cards: [building, x], running: new Map([['b', 8]]) });
      expect(planStart(state, x)).toMatchObject({ ok: false, reason: 'daily_cap', bounds: { dailyUsd: 7 } });
    });
    it('measures the cap against the day-start balance, so spending today does not shrink it', () => {
      // $80 spent today leaves $20 in the pool; min(balance, cap) would have stopped the day at $20.
      const x = moneyCard({ id: 'x', estimate_usd: 10, funded_usd: 10 });
      expect(planStart(money({ balanceUsd: 20, spentTodayUsd: 80, cards: [x] }), x)).toMatchObject({ ok: true, budgetUsd: 15, bounds: { dailyUsd: 20 } });
    });
    it('reports an empty pool as insufficient_balance, never as the daily cap', () => {
      const x = moneyCard({ id: 'x', funded_usd: 0 });
      expect(planStart(money({ balanceUsd: 0, cards: [x] }), x)).toMatchObject({ ok: false, reason: 'insufficient_balance' });
    });
  });
});
