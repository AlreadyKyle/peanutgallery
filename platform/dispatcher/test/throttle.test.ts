import { describe, expect, it } from 'vitest';
import {
  billingFor,
  canStart,
  ceilingUsd,
  concurrency,
  holdUsd,
  newYorkDate,
  newYorkMonth,
  monthStartIn,
  newYorkMonthStart,
  planStart,
  spentToday,
  tierMonth,
  tierMonthStart,
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
    tierCapUsd: null,
    spentThisTierMonthUsd: 0,
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

  it('starts a month at local midnight in any zone, across a daylight-saving change on the 1st', () => {
    // Daylight time ends at 2 a.m. local on Sunday 1 November 2026; midnight is still daylight time.
    expect(monthStartIn(new Date('2026-11-01T12:00:00.000Z'), 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(monthStartIn(new Date('2026-11-01T12:00:00.000Z'), 'America/Los_Angeles').toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(monthStartIn(new Date('2026-12-15T12:00:00.000Z'), 'America/Los_Angeles').toISOString()).toBe('2026-12-01T08:00:00.000Z');
    expect(monthStartIn(new Date('2026-09-22T15:00:00.000Z'), 'UTC').toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(monthStartIn(new Date('2026-09-22T15:00:00.000Z'), 'Asia/Tokyo').toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });
});

describe('tierMonthStart', () => {
  it('starts at midnight UTC once the month has turned everywhere from UTC to Pacific', () => {
    expect(tierMonthStart(new Date('2026-09-22T15:00:00.000Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(tierMonthStart(new Date('2026-10-01T07:00:00.000Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('keeps counting a month that has not yet turned in New York or Los Angeles, so the window never starts after the reset', () => {
    // 1 October 03:00 UTC is still 30 September in New York: back to New York's start of September.
    expect(tierMonthStart(new Date('2026-10-01T03:00:00.000Z')).toISOString()).toBe('2026-09-01T04:00:00.000Z');
    // 06:59 UTC: October in New York, still September in Los Angeles.
    expect(tierMonthStart(new Date('2026-10-01T06:59:59.000Z')).toISOString()).toBe('2026-09-01T07:00:00.000Z');
  });

  it('names one tier month from the moment the last zone turns until it turns again', () => {
    expect(tierMonth(new Date('2026-09-30T12:00:00.000Z'))).toBe('2026-09');
    // UTC has turned, then New York, but Los Angeles is still in September.
    expect(tierMonth(new Date('2026-10-01T01:00:00.000Z'))).toBe('2026-09');
    expect(tierMonth(new Date('2026-10-01T05:00:00.000Z'))).toBe('2026-09');
    expect(tierMonth(new Date('2026-10-01T06:59:59.000Z'))).toBe('2026-09');
    expect(tierMonth(new Date('2026-10-01T07:00:00.000Z'))).toBe('2026-10');
    // Pacific standard time: Los Angeles turns at 08:00 UTC on 1 December.
    expect(tierMonth(new Date('2026-12-01T07:59:59.000Z'))).toBe('2026-11');
    expect(tierMonth(new Date('2026-12-01T08:00:00.000Z'))).toBe('2026-12');
    // Across the year: December until Los Angeles reaches January.
    expect(tierMonth(new Date('2027-01-01T05:00:00.000Z'))).toBe('2026-12');
    expect(tierMonth(new Date('2027-01-01T08:00:00.000Z'))).toBe('2027-01');
  });

  it('keeps one tier month for every tierMonthStart it counts', () => {
    // Every quarter hour from 30 September to 2 October: the month changes once, at the instant
    // tierMonthStart jumps into the next month.
    const seen = new Map<string, Set<string>>();
    for (let t = Date.parse('2026-09-30T00:00:00.000Z'); t <= Date.parse('2026-10-02T00:00:00.000Z'); t += 15 * 60_000) {
      const now = new Date(t);
      const month = tierMonth(now);
      if (!seen.has(month)) seen.set(month, new Set());
      seen.get(month)!.add(tierMonthStart(now).toISOString().slice(0, 7));
    }
    expect([...seen.keys()]).toEqual(['2026-09', '2026-10']);
    expect([...seen.get('2026-09')!]).toEqual(['2026-09']);
    expect([...seen.get('2026-10')!]).toEqual(['2026-10']);
  });

  it('never starts after the month start in UTC, New York or Los Angeles', () => {
    for (const iso of ['2026-10-01T00:30:00.000Z', '2026-10-01T04:30:00.000Z', '2026-10-01T09:00:00.000Z', '2026-11-01T05:30:00.000Z', '2026-12-31T23:59:00.000Z']) {
      const now = new Date(iso);
      for (const zone of ['UTC', 'America/New_York', 'America/Los_Angeles']) {
        expect(tierMonthStart(now).getTime(), `${iso} ${zone}`).toBeLessThanOrEqual(monthStartIn(now, zone).getTime());
      }
    }
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
  it('holds nothing for a gated card this process does not run, or a live or rejected card', () => {
    for (const stage of ['gated', 'live', 'rejected']) expect(holdUsd(moneyCard({ id: 'a', stage }), state)).toBe(0);
    for (const stage of ['live', 'rejected']) expect(holdUsd(moneyCard({ id: 'b', stage }), state)).toBe(0);
  });
  it('holds what a gated card this process still runs may spend on a visual revision', () => {
    expect(holdUsd(moneyCard({ id: 'b', stage: 'gated' }), state)).toBe(3);
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

  it('holds nothing for a gated card whose pipeline has closed its budget, so its finished session frees the pool', () => {
    const gated = moneyCard({ id: 'g', stage: 'gated' });
    const x = moneyCard({ id: 'x' });
    expect(planStart(money({ balanceUsd: 10, cards: [gated, x] }), x)).toMatchObject({ ok: true, budgetUsd: 10 });
    expect(planStart(money({ balanceUsd: 10, cards: [gated, x], running: new Map([['g', 0]]) }), x)).toMatchObject({ ok: true, budgetUsd: 10 });
  });

  // docs/specs/design-review.md: a visual revision spends from the claim's budget, so while the card
  // waits at gated its unspent budget stays held from the pool, the caps and the credit.
  it('holds a gated card budget that a revision may still spend, from the pool and from every cap', () => {
    const gated = moneyCard({ id: 'g', stage: 'gated' });
    const x = moneyCard({ id: 'x', estimate_usd: 2, funded_usd: 2 });
    const plan = planStart(money({ balanceUsd: 20, dailyCapUsd: 10, spentTodayUsd: 5, cards: [gated, x], running: new Map([['g', 3]]) }), x);
    expect(plan).toMatchObject({ ok: true, budgetUsd: 2, bounds: { availableUsd: 17, dailyUsd: 2 } });
    expect(planStart(money({ balanceUsd: 20, dailyCapUsd: 10, spentTodayUsd: 5, cards: [gated, x], running: new Map([['g', 4]]) }), x)).toMatchObject({ ok: false, reason: 'daily_cap' });
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

  describe('Console credit (PLAN.md §10 decision 65)', () => {
    it('is not a bound: a funded card starts with no credit recorded, and the budget ignores it', () => {
      const x = moneyCard({ id: 'x', estimate_usd: 8, funded_usd: 50 });
      const plan = planStart(money({ balanceUsd: 50, creditPurchasedUsd: 0, creditSpentUsd: 6, cards: [x] }), x);
      expect(plan).toMatchObject({ ok: true });
      expect(plan.bounds.creditUsd).toBe(Number.POSITIVE_INFINITY);
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

  describe('usage tier cap', () => {
    it('adds no bound when the board has reported no tier cap', () => {
      const x = moneyCard({ id: 'x', estimate_usd: 10, funded_usd: 10 });
      const plan = planStart(money({ tierCapUsd: null, spentThisTierMonthUsd: 10_000, cards: [x] }), x);
      expect(plan).toMatchObject({ ok: true, budgetUsd: 15 });
      expect(plan.bounds.tierUsd).toBe(Number.POSITIVE_INFINITY);
    });
    it('starts nothing once the tier month spend reaches the cap, even with the monthly cap above it', () => {
      const x = moneyCard({ id: 'x', estimate_usd: 1, funded_usd: 1 });
      expect(planStart(money({ monthlyCapUsd: 1000, tierCapUsd: 500, spentThisTierMonthUsd: 500, cards: [x] }), x)).toMatchObject({ ok: false, reason: 'tier_cap', bounds: { tierUsd: 0 } });
    });
    it('bounds the budget by what is left under the cap, less what running sessions may still spend', () => {
      const x = moneyCard({ id: 'x', estimate_usd: 2, funded_usd: 2 });
      expect(planStart(money({ monthlyCapUsd: 1000, tierCapUsd: 500, spentThisTierMonthUsd: 497, cards: [x] }), x)).toMatchObject({ ok: true, budgetUsd: 3 });
      const building = moneyCard({ id: 'b', stage: 'building' });
      const state = money({ monthlyCapUsd: 1000, tierCapUsd: 500, spentThisTierMonthUsd: 497, cards: [building, x], running: new Map([['b', 2]]) });
      expect(planStart(state, x)).toMatchObject({ ok: false, reason: 'tier_cap', bounds: { tierUsd: 1 } });
    });
    it('counts the tier month, which can hold spend the New York month no longer does', () => {
      // Early on the 1st the monthly cap has reset but the tier window still holds last month's spend.
      const x = moneyCard({ id: 'x', estimate_usd: 2, funded_usd: 2 });
      expect(planStart(money({ monthlyCapUsd: 500, spentThisMonthUsd: 0, tierCapUsd: 500, spentThisTierMonthUsd: 499.5, cards: [x] }), x)).toMatchObject({ ok: false, reason: 'tier_cap' });
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

// A running draft_card session (docs/specs/unattended-roles.md): its card is on next and holds no bar
// money, so what the session may still spend is held from every card and every cap, as a building
// card's is.
describe('a running role job', () => {
  it("holds what its session may still spend from the balance, the daily, monthly and tier caps", () => {
    const x = moneyCard({ id: 'x', estimate_usd: 2, funded_usd: 2 });
    const free = planStart(money({ balanceUsd: 10, cards: [x], tierCapUsd: 50 }), x);
    const held = planStart(money({ balanceUsd: 10, cards: [x], tierCapUsd: 50, jobsUsd: 0.75 }), x);
    expect(free).toMatchObject({ ok: true, bounds: { availableUsd: 10, dailyUsd: 100, monthlyUsd: 500, tierUsd: 50 } });
    expect(held).toMatchObject({ ok: true, bounds: { availableUsd: 9.25, dailyUsd: 99.25, monthlyUsd: 499.25, tierUsd: 49.25 } });
    expect(planStart(money({ balanceUsd: 2.5, cards: [x], jobsUsd: 0.75 }), x)).toMatchObject({ ok: false, reason: 'insufficient_balance' });
  });
});
