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

  // docs/specs/design-review.md: a visual revision is a second session of the same claim.
  it("adds each session's spend to the card's, and gives the next session only what the claim's budget still holds", () => {
    const budgets = new SessionBudgets();
    budgets.start('a', 10);
    expect(budgets.nextSession('a')).toBe(10);
    budgets.record('a', 9);
    // The revision's meter starts again from zero; the card has spent 9 of 10.
    expect(budgets.nextSession('a')).toBe(1);
    budgets.record('a', 0.25);
    expect(budgets.remaining().get('a')).toBe(0.75);
    budgets.record('a', 0.5);
    expect(budgets.remaining().get('a')).toBe(0.5);
    expect(budgets.nextSession('ghost')).toBeUndefined();
  });

  it('gives a session nothing once the earlier sessions spent the budget, and holds nothing once closed', () => {
    const budgets = new SessionBudgets();
    budgets.start('a', 4);
    budgets.nextSession('a');
    budgets.record('a', 5);
    expect(budgets.nextSession('a')).toBe(0);
    budgets.start('b', 4);
    budgets.record('b', 1);
    budgets.close('b');
    expect(budgets.remaining().get('b')).toBe(0);
    expect(budgets.nextSession('b')).toBe(0);
  });

  it('keeps an attended session unbounded', () => {
    const budgets = new SessionBudgets();
    budgets.start('a', Number.POSITIVE_INFINITY);
    budgets.record('a', 4);
    expect(budgets.budgetFor('a')).toBe(Number.POSITIVE_INFINITY);
    expect(budgets.remaining().get('a')).toBe(Number.POSITIVE_INFINITY);
    expect(budgets.nextSession('a')).toBe(Number.POSITIVE_INFINITY);
  });
});
