import { describe, expect, it } from 'vitest';
import { SessionBudgets } from '../src/budgets.js';

describe('SessionBudgets', () => {
  it('holds each running session budget less its spend, never below zero, until the card finishes', () => {
    const budgets = new SessionBudgets();
    budgets.start('a', 10);
    budgets.start('b', 2);
    budgets.record('a', 3.25);
    budgets.record('b', 5);
    expect(budgets.remaining()).toEqual(new Map([
      ['a', 6.75],
      ['b', 0],
    ]));
    budgets.finish('b');
    expect([...budgets.remaining().keys()]).toEqual(['a']);
    expect(budgets.budgetFor('b')).toBeUndefined();
  });

  it('only ever raises a session spend, and ignores a card it does not hold', () => {
    const budgets = new SessionBudgets();
    budgets.start('a', 10);
    budgets.record('a', 4);
    budgets.record('a', 2);
    budgets.record('ghost', 1);
    expect(budgets.remaining()).toEqual(new Map([['a', 6]]));
  });

  it('keeps an attended session unbounded', () => {
    const budgets = new SessionBudgets();
    budgets.start('a', Number.POSITIVE_INFINITY);
    budgets.record('a', 4);
    expect(budgets.budgetFor('a')).toBe(Number.POSITIVE_INFINITY);
    expect(budgets.remaining().get('a')).toBe(Number.POSITIVE_INFINITY);
  });
});
