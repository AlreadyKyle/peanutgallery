import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { haltDispatcher, resetHalt } from '../src/halt.js';
import { createLogger } from '../src/log.js';
import { stuckAfterMs } from '../src/pipeline.js';
import { tick, type TickDeps } from '../src/tick.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card } from './helpers/fake-db.js';

function deps(db: FakeDb, started: string[], overrides: Partial<TickDeps> = {}): TickDeps {
  return {
    db,
    mode: 'attended',
    boardSessionTtlMin: 3,
    maxConcurrency: 1,
    running: new Map<string, Date>(),
    stuckAfterMs: 3 * 60 * 60_000,
    now: () => NOW,
    log: createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() })),
    alert: new RecordingAlerter(),
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

  it('reserves the estimates of building and gated cards in unattended mode', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.pool.balance_usd = 5;
    db.cards = [card({ id: 'a', stage: 'gated', estimate_usd: 4 }), card({ id: 'b', estimate_usd: 2 })];
    expect(await tick(deps(db, [], { mode: 'unattended' }))).toEqual({ action: 'sleep', reason: 'insufficient_balance' });
  });

  it('sleeps while paused, without a board session or at the concurrency limit', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    db.studio.paused = true;
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'paused' });
    db.studio.paused = false;
    db.boardActive = false;
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'no_board_session' });
    db.boardActive = true;
    expect(await tick(deps(db, [], { running: new Map([['other-card', NOW]]) }))).toEqual({ action: 'sleep', reason: 'concurrency' });
    expect(db.cards[0]?.stage).toBe('funded');
  });

  it('sleeps over the daily cap in unattended mode, alerting once a day and counting only today', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.cards = [card()];
    db.pool.daily_spent_usd = 50;
    const alert = new RecordingAlerter();
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'daily_cap' });
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'daily_cap' });
    expect(alert.messages).toEqual(['The daily cap of $100.00 stopped the agents for 2026-09-14.']);
    expect(alert.pings).toBe(2);
    db.pool.day = '2026-09-13';
    expect(await tick(deps(db, [], { mode: 'unattended' }))).toEqual({ action: 'started', cardId: card().id });
  });

  it('starts a card in attended mode with an empty pool, over the cap and above the balance', async () => {
    const db = new FakeDb();
    db.pool = { ...db.pool, balance_usd: 0, daily_spent_usd: 500 };
    db.cards = [card({ estimate_usd: 12 })];
    expect(await tick(deps(db, []))).toEqual({ action: 'started', cardId: card().id });
  });

  it('sleeps when studio_state.agent_mode differs from the adapter', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    db.studio.agent_mode = 'unattended';
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'mode_mismatch' });
  });

  it('starts a funded card in unattended mode with no board session', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    db.studio.agent_mode = 'unattended';
    db.boardActive = false;
    const started: string[] = [];
    expect(await tick(deps(db, started, { mode: 'unattended' }))).toEqual({ action: 'started', cardId: card().id });
    expect(db.cards[0]?.stage).toBe('building');
    await Promise.resolve();
    expect(started).toEqual([card().id]);
  });

  it('writes the heartbeat and pings once per completed tick, and goes on when the write fails', async () => {
    const db = new FakeDb();
    const alert = new RecordingAlerter();
    expect(await tick(deps(db, [], { alert }))).toEqual({ action: 'sleep', reason: 'no_funded_cards' });
    expect(db.heartbeats).toEqual([NOW]);
    db.studio.paused = true;
    expect(await tick(deps(db, [], { alert }))).toEqual({ action: 'sleep', reason: 'paused' });
    expect(db.heartbeats).toHaveLength(2);
    db.studio.paused = false;
    db.heartbeatError = new Error('column "dispatcher_seen_at" of relation "studio_state" does not exist');
    expect(await tick(deps(db, [], { alert }))).toEqual({ action: 'sleep', reason: 'no_funded_cards' });
    expect(db.heartbeats).toHaveLength(2);
    expect(alert.pings).toBe(3);
  });

  it('sends no ping and writes no heartbeat when the studio_state read throws', async () => {
    const db = new FakeDb();
    db.getStudioState = async () => {
      throw new Error('db studio_state: fetch failed');
    };
    const alert = new RecordingAlerter();
    await expect(tick(deps(db, [], { alert }))).rejects.toThrow('fetch failed');
    expect(alert.pings).toBe(0);
    expect(db.heartbeats).toEqual([]);
  });

  it('claims nothing while halted, and does not ping, so the healthcheck reports the stop', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    const alert = new RecordingAlerter();
    haltDispatcher('git_tamper: the git configuration changed during card 4c2f5a1e');
    try {
      expect(await tick(deps(db, [], { alert }))).toEqual({ action: 'sleep', reason: 'halted' });
    } finally {
      resetHalt();
    }
    expect(db.claims).toBe(0);
    expect(db.cards[0]?.stage).toBe('funded');
    expect(db.heartbeats).toEqual([NOW]);
    expect(alert.pings).toBe(0);
  });

  it('forgets the stuck alert when a card finishes, so a later claim of it can alert again', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    const alert = new RecordingAlerter();
    const running = new Map<string, Date>();
    let finish: () => void = () => undefined;
    const runCard = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const later = new Date(NOW.getTime() + 3 * 60 * 60_000);
    expect(await tick(deps(db, [], { alert, running, runCard }))).toEqual({ action: 'started', cardId: card().id });
    await tick(deps(db, [], { alert, running, now: () => later, stuckAfterMs: 60_000 }));
    expect(alert.messages).toHaveLength(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(running.size).toBe(0);
    running.set(card().id, NOW);
    await tick(deps(db, [], { alert, running, now: () => later, stuckAfterMs: 60_000 }));
    expect(alert.messages).toHaveLength(2);
  });

  it('alerts once when a running card has been in the pipeline past the limit', async () => {
    const db = new FakeDb();
    const alert = new RecordingAlerter();
    const running = new Map([
      ['stuck-card-0000', new Date(NOW.getTime() - 3 * 60 * 60_000)],
      ['fresh-card-0000', new Date(NOW.getTime() - 60_000)],
    ]);
    const stuckAfterMs = 2 * 60 * 60_000;
    expect(await tick(deps(db, [], { alert, running, stuckAfterMs }))).toEqual({ action: 'sleep', reason: 'no_funded_cards' });
    expect(await tick(deps(db, [], { alert, running, stuckAfterMs }))).toEqual({ action: 'sleep', reason: 'no_funded_cards' });
    expect(alert.messages).toEqual(['Card stuckcar has been in the pipeline for 180 minutes, past its 120-minute limit. Check the dispatcher log.']);
  });

  it('sets the stuck limit from every bounded wait in the pipeline', () => {
    // 60 session + 15 git (three network git calls at 5) + 1 pull request head + 20 gate + 1 merge state
    // + 2 × (10 deploy + 15 smoke, the gate at the merge sha included) for this card and one ahead of it
    // on the merge lock + 2 retries + 10 margin.
    expect(stuckAfterMs(60)).toBe(159 * 60_000);
  });

  it('skips vetoed cards, community cards and cards without an executor', async () => {
    const db = new FakeDb();
    db.cards = [card({ id: 'v', director_stance: 'vetoed' }), card({ id: 'n', executor_role_id: null }), card({ id: 'c', source: 'community' })];
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'no_eligible_card' });
    expect(db.cards.map((c) => c.stage)).toEqual(['funded', 'funded', 'funded']);
  });
});
