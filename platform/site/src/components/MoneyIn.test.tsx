import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { books } from '../lib/books.test-fixture';
import { legal } from '../lib/legal';
import type { Money, Snapshot } from '../lib/source';
import { FundingLines, MoneyInFigures, NotOnCardStat, unspentOnBars } from './MoneyIn';

afterEach(() => {
  cleanup();
});

/** Every figure non-zero, in cents, adding up: 120 - 6 - 10 - 4 + 1.5 = 101.5 = 10.15 + 20.3 + 3.55 + 5 + 62.5. */
const EVERY: Money = books([], {
  payments: 7,
  received_usd: 120,
  stripe_fees_usd: 6,
  refunded_usd: 10,
  disputed_usd: 4,
  corrections_usd: 1.5,
  reserve_usd: 10.15,
  studio_usd: 20.3,
  incident_usd: 3.55,
  held_usd: 5,
  agent_credit_usd: 62.5,
  studio_pct_avg: 22.4,
  reconciled_at: '2026-09-23T04:00:00Z',
  last_run_ok: true,
});

/** The shown figures by label, in dollars, read back from the page. */
function shown(): Record<string, number> {
  const figures: Record<string, number> = {};
  for (const row of document.querySelectorAll('.stat')) {
    const label = row.querySelector('.stat-label')?.textContent ?? '';
    const value = row.querySelector('dd')?.textContent ?? '';
    figures[label] = Number(value.replace(/[$,]/g, ''));
  }
  return figures;
}

describe('Money in', () => {
  it('shows every figure with its description, and the shown figures add up', () => {
    render(<MoneyInFigures money={EVERY} />);
    const f = shown();
    expect(Object.keys(f)).toEqual([
      legal.received,
      legal.stripeFees,
      legal.refunded,
      legal.disputed,
      legal.corrections,
      legal.toReserve,
      legal.toStudio,
      legal.toIncident,
      legal.heldMoneyIn,
      legal.agentCredit,
    ]);
    for (const row of document.querySelectorAll('.stat')) expect(row.querySelector('.stat-description')?.textContent).not.toBe('');
    const left = f[legal.received]! - f[legal.stripeFees]! - f[legal.refunded]! - f[legal.disputed]! + f[legal.corrections]!;
    const right = f[legal.toReserve]! + f[legal.toStudio]! + f[legal.toIncident]! + f[legal.heldMoneyIn]! + f[legal.agentCredit]!;
    expect(Math.round(left * 100)).toBe(Math.round(right * 100));
    expect(Math.round(left * 100)).toBe(10150);
    expect(screen.getByText('from 7 contributions')).toBeTruthy();
    expect(screen.getByText(`${legal.describeStudio} At checkout they chose 22% on average, weighted by amount, and the default is 20%.`)).toBeTruthy();
  });

  it('leaves out held money and corrections at zero, and the average split when there is none', () => {
    render(<MoneyInFigures money={{ ...EVERY, corrections_usd: 0, held_usd: 0, studio_pct_avg: null, payments: 1 }} />);
    expect(Object.keys(shown())).toEqual([
      legal.received,
      legal.stripeFees,
      legal.refunded,
      legal.disputed,
      legal.toReserve,
      legal.toStudio,
      legal.toIncident,
      legal.agentCredit,
    ]);
    expect(screen.getByText(legal.describeStudio)).toBeTruthy();
    expect(screen.queryByText(/on average/)).toBeNull();
    expect(screen.getByText('from 1 contribution')).toBeTruthy();
  });

  it('says No contributions yet. in place of the figures with no payments, and keeps the reconciliation line', () => {
    render(<MoneyInFigures money={books()} />);
    expect(screen.getByText(legal.moneyInEmpty)).toBeTruthy();
    expect(document.querySelectorAll('.stat')).toHaveLength(0);
    expect(document.querySelectorAll('[data-reconcile]')).toHaveLength(1);
  });

  it('shows exactly one reconciliation line: the date when the last run passed, else not yet', () => {
    const lines = (money: Money) => {
      render(<MoneyInFigures money={money} />);
      const found = [...document.querySelectorAll('[data-reconcile]')].map((p) => p.textContent);
      cleanup();
      return found;
    };
    // The date holds together with no-break spaces (lib/format.ts formatDate).
    expect(lines(EVERY)).toEqual(['Reconciled with Stripe on 23\u00a0Sep\u00a02026.']);
    expect(lines({ ...EVERY, last_run_ok: null, reconciled_at: null })).toEqual([legal.notReconciled]);
    expect(lines({ ...EVERY, last_run_ok: false, reconciled_at: null })).toEqual([legal.notReconciled]);
  });
});

function snapshotWith(money: Money | null): Snapshot {
  return {
    pool: null,
    cards: [],
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    money,
    missing: money === null ? ['money'] : [],
  };
}

describe('the Funding band', () => {
  it("says how the pool is made up two ways and the test payment's three shares, and the figures add up (docs/specs/ledger-figures.md)", () => {
    // Production on 20 October 2026, after the migration: the balances hold the test payment's shares.
    const pool = { balance_usd: 0.4816, reserve_usd: 0.5244, incident_reserve_usd: 0.1887, held_usd: 0, daily_spent_usd: 0, day: '2026-10-20' };
    const money = books([], {
      reserve_usd: 0.451,
      incident_usd: 0.1623,
      agent_credit_usd: 3.0845,
      board_test_usd: 0.5019,
      not_on_card_usd: 0,
      short_usd: 0.2631,
      test: { paid_usd: 1, reserve_usd: 0.0734, incident_usd: 0.0264 },
    });
    const totals = { usd_total: 3.1048, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0, unlisted_usd: 0.2631 };
    const snapshot = { ...snapshotWith(money), pool, totals };
    render(<FundingLines snapshot={snapshot} />);
    expect(
      screen.getByText(
        'In the pool: $3.08 of agent credit and $0.50 from the test payment, less $3.10 of agent spend. That is $0.24 unspent on card bars, $0.50 of the test payment, less the $0.26 by which Not on a card yet is below zero.',
      ),
    ).toBeTruthy();
    expect(screen.getByText("The pool, the reserve and the emergency fund include the studio's own $1.00 test payment: $0.50, $0.07 and $0.03. It funds no card.")).toBeTruthy();
    expect(screen.getByText(legal.shortBy.replace('{usd}', '$0.26'))).toBeTruthy();
    const n = (usd: number) => Math.round(usd * 10000);
    // The pool = agent credit + the test payment's credit - agent spend
    //          = unspent on card bars + the test payment's credit + Not on a card yet - the shortfall.
    expect(n(pool.balance_usd)).toBe(n(money.agent_credit_usd) + n(money.board_test_usd) - n(totals.usd_total));
    expect(n(pool.balance_usd)).toBe(n(unspentOnBars(pool.balance_usd, money)) + n(money.board_test_usd) + n(money.not_on_card_usd) - n(money.short_usd));
    expect(n(unspentOnBars(pool.balance_usd, money))).toBe(2428);
    // The balances = the Money in figures + the test payment's shares.
    expect(n(pool.reserve_usd)).toBe(n(money.reserve_usd) + n(money.test!.reserve_usd));
    expect(n(pool.incident_reserve_usd)).toBe(n(money.incident_usd) + n(money.test!.incident_usd));
  });

  it('leaves the test payment and the shortfall out of the pool lines when there are none, and draws none without the totals', () => {
    const pool = { balance_usd: 1.5, reserve_usd: 0, incident_reserve_usd: 0, held_usd: 0, daily_spent_usd: 0, day: '2026-10-20' };
    const money = books([], { agent_credit_usd: 2, not_on_card_usd: 0.5 });
    const totals = { usd_total: 0.5, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 };
    render(<FundingLines snapshot={{ ...snapshotWith(money), pool, totals }} />);
    expect(screen.getByText('In the pool: $2.00 of agent credit, less $0.50 of agent spend. That is $1.00 unspent on card bars and $0.50 not on a card yet.')).toBeTruthy();
    expect(screen.queryByText(/test payment/)).toBeNull();
    cleanup();
    render(<FundingLines snapshot={{ ...snapshotWith(money), pool, totals, missing: ['totals'] }} />);
    expect(document.querySelector('[data-pool]')).toBeNull();
  });

  it("names the studio's test payment by the part of it in the pool, in a document without its shares", () => {
    // Production: a $1.00 payment whose agent credit, $0.5019, is board_test_usd (docs/specs/money-logic.md).
    render(<FundingLines snapshot={snapshotWith(books([], { board_test_usd: 0.5019 }))} />);
    expect(screen.getByText("The pool includes $0.50 of the studio's own test payment; it funds no card.")).toBeTruthy();
    expect(document.body.textContent).not.toContain('$1.00');
    cleanup();
    render(<FundingLines snapshot={snapshotWith(books([], { board_test_usd: 0 }))} />);
    expect(screen.queryByText(/test payment/)).toBeNull();
  });

  it('puts Not available right now. under the Not on a card yet label, never in the figure\'s place', () => {
    render(
      <dl>
        <NotOnCardStat snapshot={snapshotWith(null)} />
      </dl>,
    );
    const row = screen.getByText(legal.notOnCard).closest('.stat')!;
    expect(row.classList.contains('stat-unavailable')).toBe(true);
    expect(row.querySelector('dd')?.textContent).toBe(legal.partUnavailable);
    cleanup();
    render(
      <dl>
        <NotOnCardStat snapshot={snapshotWith(books([], { not_on_card_usd: 1.25 }))} />
      </dl>,
    );
    const loaded = screen.getByText(legal.notOnCard).closest('.stat')!;
    expect(loaded.classList.contains('stat-unavailable')).toBe(false);
    expect(loaded.querySelector('dd')?.textContent).toBe('$1.25');
  });
});
