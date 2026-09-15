import { describe, expect, it } from 'vitest';
import { available, billingFor, canStart, concurrency, effectiveDailyCap, newYorkDate, spentToday, type StartConditions } from '../src/throttle.js';

const base: StartConditions = {
  paused: false,
  mode: 'attended',
  boardSessionActive: true,
  balanceUsd: 50,
  dailySpentUsd: 0,
  dailyCapUsd: 100,
  availableUsd: 50,
  smallestEstimateUsd: 2,
  running: 0,
  concurrency: 1,
};

describe('available', () => {
  it('subtracts the studio reserve and reserved estimates from the balance', () => {
    expect(available(50, 0, 0)).toBe(50);
    expect(available(50, 5, 2)).toBe(43);
    expect(available(1.23456, 0, 0)).toBe(1.2346);
  });
});

describe('billingFor', () => {
  it('bills attended sessions to the founder and unattended sessions to the studio', () => {
    expect(billingFor('attended')).toBe('founder');
    expect(billingFor('unattended')).toBe('studio');
  });
});

describe('spentToday', () => {
  it('counts the day spend only when the pool row is from today in New York', () => {
    const now = new Date('2026-09-15T03:30:00.000Z');
    expect(newYorkDate(now)).toBe('2026-09-14');
    expect(spentToday({ day: '2026-09-14', daily_spent_usd: 100 }, now)).toBe(100);
    expect(spentToday({ day: '2026-09-13', daily_spent_usd: 100 }, now)).toBe(0);
  });
});

describe('concurrency', () => {
  it('is one in attended mode whatever the balance', () => {
    expect(concurrency(50, 5, 'attended', 2)).toBe(1);
    expect(concurrency(0, 5, 'attended', 2)).toBe(1);
  });
  it('is min(2, floor(balance / rate)) in unattended mode', () => {
    expect(concurrency(50, 5, 'unattended', 2)).toBe(2);
    expect(concurrency(7, 5, 'unattended', 2)).toBe(1);
    expect(concurrency(4, 5, 'unattended', 2)).toBe(0);
  });
  it('honours the configured maximum and a zero rate', () => {
    expect(concurrency(50, 5, 'unattended', 1)).toBe(1);
    expect(concurrency(50, 0, 'unattended', 2)).toBe(0);
  });
});

describe('effectiveDailyCap', () => {
  it('is the smaller of the balance and the configured cap', () => {
    expect(effectiveDailyCap(50, 100)).toBe(50);
    expect(effectiveDailyCap(500, 100)).toBe(100);
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
  it('sleeps at the daily cap, measured against min(balance, cap), in unattended mode only', () => {
    const unattended = { ...base, mode: 'unattended' as const };
    expect(canStart({ ...unattended, dailySpentUsd: 100 })).toEqual({ ok: false, reason: 'daily_cap' });
    expect(canStart({ ...unattended, dailySpentUsd: 50 })).toEqual({ ok: false, reason: 'daily_cap' });
    expect(canStart({ ...unattended, dailySpentUsd: 49.99 })).toEqual({ ok: true });
    expect(canStart({ ...base, balanceUsd: 0, dailySpentUsd: 100 })).toEqual({ ok: true });
  });
  it('sleeps with no funded cards', () => {
    expect(canStart({ ...base, smallestEstimateUsd: null })).toEqual({ ok: false, reason: 'no_funded_cards' });
  });
  it('sleeps when the smallest estimate exceeds what is available, in unattended mode only', () => {
    expect(canStart({ ...base, mode: 'unattended', availableUsd: 1.99 })).toEqual({ ok: false, reason: 'insufficient_balance' });
    expect(canStart({ ...base, availableUsd: 0 })).toEqual({ ok: true });
  });
  it('sleeps when every session slot is taken', () => {
    expect(canStart({ ...base, running: 1 })).toEqual({ ok: false, reason: 'concurrency' });
    expect(canStart({ ...base, concurrency: 0 })).toEqual({ ok: false, reason: 'concurrency' });
  });
});
