import { describe, expect, it } from 'vitest';
import { SESSION_SOURCES, closedLane, orderCards, runnable, runnableInOrder, type SelectableCard } from '../src/select.js';

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
    horizon: 'now',
    folder: 'seed-1',
    lane: 'config',
    ...overrides,
  };
}

describe('runnable', () => {
  it('requires stage funded, no veto and an executor', () => {
    expect(runnable(card({ id: 'a' }))).toBe(true);
    expect(runnable(card({ id: 'a', stage: 'voted' }))).toBe(false);
    expect(runnable(card({ id: 'a', director_stance: 'vetoed' }))).toBe(false);
    expect(runnable(card({ id: 'a', executor_role_id: null }))).toBe(false);
  });
  it('accepts board, agent and decision sources and refuses community cards', () => {
    expect(SESSION_SOURCES).toEqual(['board', 'agent', 'decision']);
    for (const source of SESSION_SOURCES) expect(runnable(card({ id: 'a', source }))).toBe(true);
    expect(runnable(card({ id: 'a', source: 'community' }))).toBe(false);
  });
  it('runs only horizon now cards', () => {
    expect(runnable(card({ id: 'a', horizon: 'next' }))).toBe(false);
    expect(runnable(card({ id: 'a', horizon: 'later' }))).toBe(false);
  });
  it('keeps the platform code lane closed until the studio opens it, and every other lane open', () => {
    expect(closedLane({ folder: 'platform', lane: 'code' })).toBe(true);
    expect(closedLane({ folder: 'platform', lane: 'code' }, false)).toBe(true);
    expect(runnable(card({ id: 'a', folder: 'platform', lane: 'code' }))).toBe(false);
    expect(runnable(card({ id: 'a', folder: 'seed-1', lane: 'code' }))).toBe(true);
    expect(runnable(card({ id: 'a', folder: 'seed-1', lane: 'config' }))).toBe(true);
  });

  it('runs a platform code card once studio_state.platform_lane_open is set, with every other rule still applied', () => {
    expect(closedLane({ folder: 'platform', lane: 'code' }, true)).toBe(false);
    expect(runnable(card({ id: 'a', folder: 'platform', lane: 'code' }), true)).toBe(true);
    expect(runnable(card({ id: 'a', folder: 'platform', lane: 'code', source: 'community' }), true)).toBe(false);
    expect(runnable(card({ id: 'a', folder: 'platform', lane: 'code', stage: 'voted' }), true)).toBe(false);
    expect(runnable(card({ id: 'a', folder: 'platform', lane: 'code', director_stance: 'vetoed' }), true)).toBe(false);
    expect(runnable(card({ id: 'a', folder: 'seed-1', lane: 'config' }), true)).toBe(true);
  });
  it('leaves money to the throttle: an estimate above any pool is still runnable', () => {
    expect(runnable(card({ id: 'a', estimate_usd: 1_000_000 }))).toBe(true);
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

describe('runnableInOrder', () => {
  it('drops cards that may not run and orders the rest', () => {
    const cards = [
      card({ id: 'public', priority: 0, source: 'community' }),
      card({ id: 'late', priority: 100, created_at: '2026-09-14T13:00:00.000Z' }),
      card({ id: 'site', priority: 0, folder: 'platform', lane: 'code' }),
      card({ id: 'early', priority: 100, created_at: '2026-09-14T10:00:00.000Z' }),
      card({ id: 'parked', priority: 0, horizon: 'later' }),
    ];
    expect(runnableInOrder(cards).map((c) => c.id)).toEqual(['early', 'late']);
    expect(runnableInOrder(cards, true).map((c) => c.id)).toEqual(['site', 'early', 'late']);
    expect(runnableInOrder([])).toEqual([]);
  });
});
