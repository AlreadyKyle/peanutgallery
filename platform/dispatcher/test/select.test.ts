import { describe, expect, it } from 'vitest';
import { SESSION_SOURCES, eligible, orderCards, selectCard, type SelectableCard } from '../src/select.js';

function card(overrides: Partial<SelectableCard> & { id: string }): SelectableCard {
  return {
    stage: 'funded',
    source: 'board',
    priority: 100,
    created_at: '2026-09-14T12:00:00.000Z',
    estimate_usd: 2,
    severity: null,
    director_stance: 'neutral',
    executor_role_id: 'role-builder-a',
    ...overrides,
  };
}

describe('eligible', () => {
  it('requires stage funded, no veto, an executor and a covered estimate', () => {
    expect(eligible(card({ id: 'a' }), 50, 0)).toBe(true);
    expect(eligible(card({ id: 'a', stage: 'voted' }), 50, 0)).toBe(false);
    expect(eligible(card({ id: 'a', director_stance: 'vetoed' }), 50, 0)).toBe(false);
    expect(eligible(card({ id: 'a', executor_role_id: null }), 50, 0)).toBe(false);
    expect(eligible(card({ id: 'a', estimate_usd: 51 }), 50, 0)).toBe(false);
  });
  it('accepts board, agent and decision sources and refuses community cards', () => {
    expect(SESSION_SOURCES).toEqual(['board', 'agent', 'decision']);
    for (const source of SESSION_SOURCES) {
      expect(eligible(card({ id: 'a', source }), 50, 0)).toBe(true);
    }
    expect(eligible(card({ id: 'a', source: 'community' }), 50, 0)).toBe(false);
  });
  it('lets an S1 card draw on the incident reserve', () => {
    expect(eligible(card({ id: 'a', estimate_usd: 60, severity: 's1' }), 50, 20)).toBe(true);
    expect(eligible(card({ id: 'a', estimate_usd: 60, severity: 's2' }), 50, 20)).toBe(false);
  });
});

describe('orderCards', () => {
  it('orders by priority, then created_at, then id', () => {
    const ordered = orderCards([
      card({ id: 'c', priority: 100, created_at: '2026-09-14T12:00:00.000Z' }),
      card({ id: 'b', priority: 100, created_at: '2026-09-14T11:00:00.000Z' }),
      card({ id: 'a', priority: 0, created_at: '2026-09-14T13:00:00.000Z' }),
      card({ id: 'd', priority: 100, created_at: '2026-09-14T11:00:00.000Z' }),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('selectCard', () => {
  it('returns the first eligible card in order', () => {
    const chosen = selectCard(
      [
        card({ id: 'directive', priority: 0, estimate_usd: 80 }),
        card({ id: 'old', created_at: '2026-09-14T10:00:00.000Z' }),
        card({ id: 'new', created_at: '2026-09-14T11:00:00.000Z' }),
      ],
      50,
      0,
    );
    expect(chosen?.id).toBe('old');
  });
  it('passes over a community card even when it is first in order', () => {
    const chosen = selectCard([card({ id: 'public', priority: 0, source: 'community' }), card({ id: 'board', priority: 100 })], 50, 0);
    expect(chosen?.id).toBe('board');
  });
  it('returns null when nothing fits', () => {
    expect(selectCard([card({ id: 'a', estimate_usd: 100 })], 50, 0)).toBeNull();
    expect(selectCard([], 50, 0)).toBeNull();
  });
});
