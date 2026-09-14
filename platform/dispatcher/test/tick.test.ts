import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { tick, type TickDeps } from '../src/tick.js';
import { FakeDb, NOW, card } from './helpers/fake-db.js';

function deps(db: FakeDb, started: string[], overrides: Partial<TickDeps> = {}): TickDeps {
  return {
    db,
    mode: 'attended',
    boardSessionTtlMin: 3,
    maxConcurrency: 1,
    running: new Set<string>(),
    now: () => NOW,
    log: createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() })),
    runCard: async (c) => {
      started.push(c.id);
    },
    ...overrides,
  };
}

describe('tick', () => {
  it('claims a funded card exactly once when two ticks race', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    const started: string[] = [];
    const [a, b] = await Promise.all([tick(deps(db, started)), tick(deps(db, started))]);
    const outcomes = [a, b].map((o) => o.action).sort();
    expect(outcomes).toEqual(['claim_lost', 'started']);
    expect(db.claims).toBe(2);
    expect(db.cards[0]?.stage).toBe('building');
    await Promise.resolve();
    expect(started).toEqual([card().id]);
  });

  it('sleeps once the card is building', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    const started: string[] = [];
    expect((await tick(deps(db, started))).action).toBe('started');
    expect(await tick(deps(db, started))).toEqual({ action: 'sleep', reason: 'no_funded_cards' });
  });

  it('reserves the estimates of building and gated cards', async () => {
    const db = new FakeDb();
    db.pool.balance_usd = 5;
    db.cards = [card({ id: 'a', stage: 'gated', estimate_usd: 4 }), card({ id: 'b', estimate_usd: 2 })];
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'insufficient_balance' });
  });

  it('sleeps while paused, without a board session, over the daily cap or at the concurrency limit', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    db.studio.paused = true;
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'paused' });
    db.studio.paused = false;
    db.boardActive = false;
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'no_board_session' });
    db.boardActive = true;
    db.pool.daily_spent_usd = 50;
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'daily_cap' });
    db.pool.daily_spent_usd = 0;
    expect(await tick(deps(db, [], { running: new Set(['other-card']) }))).toEqual({ action: 'sleep', reason: 'concurrency' });
    expect(db.cards[0]?.stage).toBe('funded');
  });

  it('sleeps when studio_state.agent_mode differs from the adapter', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    db.studio.agent_mode = 'unattended';
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'mode_mismatch' });
  });

  it('skips vetoed cards, community cards and cards without an executor', async () => {
    const db = new FakeDb();
    db.cards = [card({ id: 'v', director_stance: 'vetoed' }), card({ id: 'n', executor_role_id: null }), card({ id: 'c', source: 'community' })];
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'no_eligible_card' });
    expect(db.cards.map((c) => c.stage)).toEqual(['funded', 'funded', 'funded']);
  });
});
