import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { SessionBudgets } from '../src/budgets.js';
import { haltDispatcher, resetHalt } from '../src/halt.js';
import { createLogger } from '../src/log.js';
import { stuckAfterMs } from '../src/pipeline.js';
import { leaseTtlSeconds, tick, type TickDeps } from '../src/tick.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card } from './helpers/fake-db.js';

// A pipeline that is still running, so the card keeps its session budget while the test reads it.
const stillRunning = () => new Promise<void>(() => undefined);

function deps(db: FakeDb, started: string[], overrides: Partial<TickDeps> = {}): TickDeps {
  return {
    db,
    mode: 'attended',
    boardSessionTtlMin: 3,
    maxConcurrency: 1,
    running: new Map<string, Date>(),
    budgets: new SessionBudgets(),
    leaseHolder: 'dispatcher-a',
    leaseTtlSeconds: 300,
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

describe('tick: dealing, resume by rule and the job queue (docs/specs/agent-system-core.md)', () => {
  it('deals due cards and resumes by rule before choosing a card, so a card dealt this tick can be chosen', async () => {
    const db = new FakeDb();
    db.cards = [card({ horizon: 'next' })];
    db.dueCards = [card().id];
    const started: string[] = [];
    expect(await tick(deps(db, started))).toEqual({ action: 'started', cardId: card().id });
    expect([db.dealCalls, db.resumeCalls]).toEqual([1, 1]);
  });

  it('logs a failed deal or resume and goes on with the tick', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    db.dealError = new Error('deal down');
    db.resumeError = new Error('resume down');
    const lines: string[] = [];
    const log = createLogger(new Writable({ write: (chunk, _enc, cb) => { lines.push(String(chunk)); cb(); } }));
    expect((await tick(deps(db, [], { log }))).action).toBe('started');
    const warnings = lines.map((line) => JSON.parse(line)).filter((line) => line.level === 'warn').map((line) => [line.msg, line.error]);
    expect(warnings).toEqual([['deal_due_cards failed', 'deal down'], ['resume_due_by_rule failed', 'resume down']]);
  });

  it('runs the job tick after the card path on every tick, a sleeping or failing one included, and not while halted', async () => {
    const db = new FakeDb();
    db.studio.paused = true;
    let jobTicks = 0;
    const jobTick = async () => void (jobTicks += 1);
    expect(await tick(deps(db, [], { jobTick }))).toEqual({ action: 'sleep', reason: 'paused' });
    expect(jobTicks).toBe(1);
    db.studio.paused = false;
    const failing = Object.assign(new FakeDb(), { getStudioState: async () => { throw new Error('studio_state down'); } });
    await expect(tick(deps(failing, [], { jobTick }))).rejects.toThrow('studio_state down');
    expect(jobTicks).toBe(2);
    haltDispatcher('test halt');
    try {
      expect(await tick(deps(db, [], { jobTick }))).toEqual({ action: 'sleep', reason: 'halted' });
      expect(jobTicks).toBe(2);
      expect(db.dealCalls).toBe(1);
    } finally {
      resetHalt();
    }
  });

  it('never lets a failing job tick stop the card path', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    expect((await tick(deps(db, [], { jobTick: async () => { throw new Error('queue down'); } }))).action).toBe('started');
  });
});

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

  it('holds what a building session may still spend, and nothing for a gated card, in unattended mode', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.pool.balance_usd = 5;
    const budgets = new SessionBudgets();
    budgets.start('a', 4);
    db.cards = [card({ id: 'a', stage: 'building', estimate_usd: 4 }), card({ id: 'g', stage: 'gated', estimate_usd: 4 }), card({ id: 'b', estimate_usd: 2 })];
    expect(await tick(deps(db, [], { mode: 'unattended', budgets, maxConcurrency: 2 }))).toEqual({ action: 'sleep', reason: 'insufficient_balance' });
    budgets.record('a', 3);
    expect(await tick(deps(db, [], { mode: 'unattended', budgets, maxConcurrency: 2, runCard: stillRunning }))).toEqual({ action: 'started', cardId: 'b' });
    expect(budgets.budgetFor('b')).toBe(3);
  });

  it('starts a runnable card in unattended mode with a pool under the hourly rate', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.pool.balance_usd = 3;
    db.cards = [card({ estimate_usd: 2, funded_usd: 2 })];
    const budgets = new SessionBudgets();
    expect(await tick(deps(db, [], { mode: 'unattended', budgets, runCard: stillRunning }))).toEqual({ action: 'started', cardId: card().id });
    expect(budgets.budgetFor(card().id)).toBe(3);
  });

  it('starts a card on its own bar and keeps another card bar from it', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.pool.balance_usd = 20;
    db.cards = [card({ id: 'a', estimate_usd: 10, funded_usd: 10, priority: 1 }), card({ id: 'c', estimate_usd: 10, funded_usd: 10, priority: 2 })];
    const budgets = new SessionBudgets();
    expect(await tick(deps(db, [], { mode: 'unattended', budgets, maxConcurrency: 2, runCard: stillRunning }))).toEqual({ action: 'started', cardId: 'a' });
    expect(budgets.budgetFor('a')).toBe(10);
    expect(await tick(deps(db, [], { mode: 'unattended', budgets, maxConcurrency: 2, running: new Map([['a', NOW]]), runCard: stillRunning }))).toEqual({ action: 'started', cardId: 'c' });
    expect(budgets.budgetFor('c')).toBe(10);
  });

  it('bounds an unattended budget by the Console credit left: a $50 pool with $10 of credit gives at most $10', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.pool.balance_usd = 50;
    db.creditPurchased = 10;
    db.cards = [card({ estimate_usd: 8, funded_usd: 8 })];
    const budgets = new SessionBudgets();
    const alert = new RecordingAlerter();
    expect(await tick(deps(db, [], { mode: 'unattended', budgets, alert, runCard: stillRunning }))).toEqual({ action: 'started', cardId: card().id });
    expect(budgets.budgetFor(card().id)).toBe(10);
    expect(alert.messages).toEqual(['Console credit needed: the pool holds $50.00 for the agents but $10.00 of Console credit is left. Buy credit and record it on /board.']);
  });

  it('sleeps on the Console credit, counting studio and overhead rows, and alerts once per purchase', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.pool.balance_usd = 5;
    db.creditPurchased = 3;
    db.ledger = [
      { id: 'l1', created_at: NOW.toISOString(), billed_to: 'overhead', card_id: null, role_id: null, model: 'builder-class', input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 1.5, request_id: 'probe/1' },
      { id: 'l2', created_at: NOW.toISOString(), billed_to: 'founder', card_id: null, role_id: null, model: 'builder-class', input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 9, request_id: 'probe/2' },
    ];
    db.cards = [card({ estimate_usd: 2, funded_usd: 2 })];
    const alert = new RecordingAlerter();
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'console_credit' });
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'console_credit' });
    expect(alert.messages).toEqual([
      'Console credit needed: the pool holds $5.00 for the agents but $1.50 of Console credit is left. Buy credit and record it on /board.',
      'Console credit needed: card 4c2f5a1e needs $2.00 and $1.50 of Console credit is left once running sessions are covered. Buy credit and record it on /board.',
    ]);
    db.creditPurchased = 10;
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'started', cardId: card().id });
  });

  it('starts nothing once the month-to-date studio spend reaches the monthly cap, and alerts once', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.studio.monthly_cap_usd = 5;
    db.ledger = [
      { id: 'l1', created_at: '2026-09-02T12:00:00.000Z', billed_to: 'studio', card_id: 'old', role_id: null, model: 'builder-class', input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 5, request_id: 'old/1' },
      { id: 'l2', created_at: '2026-08-31T12:00:00.000Z', billed_to: 'studio', card_id: 'old', role_id: null, model: 'builder-class', input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 40, request_id: 'old/2' },
    ];
    db.cards = [card()];
    const alert = new RecordingAlerter();
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'monthly_cap' });
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'monthly_cap' });
    expect(alert.messages).toEqual(['The monthly cap of $5.00 stopped the agents for 2026-09.']);
    // Only September's row counts; August's does not.
    db.studio.monthly_cap_usd = 10;
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'started', cardId: card().id });
  });

  it('reads the spend totals once a tick, from the New York month start and the tier month start', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.cards = [card()];
    expect((await tick(deps(db, [], { mode: 'unattended', runCard: stillRunning }))).action).toBe('started');
    // NOW is 14 September 2026: New York's month began at 04:00 UTC, UTC's at midnight.
    expect(db.spendTotalsCalls).toEqual([['2026-09-01T04:00:00.000Z', '2026-09-01T00:00:00.000Z']]);
  });

  it('stays below the usage tier cap the board reported, counting the tier month, and alerts once', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.studio.monthly_cap_usd = 500;
    db.studio.anthropic_tier_cap_usd = 100;
    const row = (id: string, created_at: string, billed_to: 'studio' | 'overhead' | 'founder', usd: number) =>
      ({ id, created_at, billed_to, card_id: null, role_id: null, model: 'builder-class', input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd, request_id: id }) as const;
    db.ledger = [
      // Inside the tier month (from 1 September 00:00 UTC) but before New York's month began.
      row('l1', '2026-09-01T02:00:00.000Z', 'studio', 60),
      row('l2', '2026-09-10T12:00:00.000Z', 'overhead', 39),
      // Founder rows are not the studio key's spend.
      row('l3', '2026-09-10T12:00:00.000Z', 'founder', 500),
      row('l4', '2026-08-31T12:00:00.000Z', 'studio', 400),
    ];
    db.cards = [card({ estimate_usd: 2, funded_usd: 2 })];
    const alert = new RecordingAlerter();
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'tier_cap' });
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'tier_cap' });
    expect(alert.messages).toEqual([
      'The usage tier cap of $100.00 a month stopped the agents: the studio key has spent $99.00 since 2026-09-01T00:00:00.000Z. It clears when the month turns, or when Anthropic raises the tier and the new limit is reported.',
    ]);
    // No tier cap reported: the monthly cap alone bounds the month.
    db.studio.anthropic_tier_cap_usd = null;
    expect(await tick(deps(db, [], { mode: 'unattended', alert, runCard: stillRunning }))).toEqual({ action: 'started', cardId: card().id });
  });

  it('alerts the usage tier cap once across the month turn in UTC, New York and Los Angeles, and again in the next tier month', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.studio.monthly_cap_usd = 500;
    db.studio.anthropic_tier_cap_usd = 100;
    const row = (id: string, created_at: string, usd: number) =>
      ({ id, created_at, billed_to: 'studio', card_id: null, role_id: null, model: 'builder-class', input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd, request_id: id }) as const;
    db.ledger = [row('sep', '2026-09-15T12:00:00.000Z', 99)];
    db.cards = [card({ estimate_usd: 2, funded_usd: 2 })];
    const alert = new RecordingAlerter();
    const at = (iso: string) => tick(deps(db, [], { mode: 'unattended', alert, now: () => new Date(iso) }));
    expect(await at('2026-09-30T12:00:00.000Z')).toEqual({ action: 'sleep', reason: 'tier_cap' });
    // Spend in October's first half hour, which September's window counts too.
    db.ledger.push(row('oct', '2026-10-01T00:30:00.000Z', 99));
    // The tier month's start moves on 1 October at 00:00 UTC, 04:00 UTC (New York) and 07:00 UTC (Los
    // Angeles); it is September's window until Los Angeles turns.
    for (const iso of ['2026-10-01T01:00:00.000Z', '2026-10-01T05:00:00.000Z', '2026-10-01T06:59:00.000Z']) {
      expect(await at(iso), iso).toEqual({ action: 'sleep', reason: 'tier_cap' });
    }
    expect(alert.messages).toEqual([
      'The usage tier cap of $100.00 a month stopped the agents: the studio key has spent $99.00 since 2026-09-01T00:00:00.000Z. It clears when the month turns, or when Anthropic raises the tier and the new limit is reported.',
    ]);
    // October's window, once every zone has turned: October's own spend still binds, so it alerts once more.
    for (const iso of ['2026-10-01T07:00:00.000Z', '2026-10-01T08:00:00.000Z']) {
      expect(await at(iso), iso).toEqual({ action: 'sleep', reason: 'tier_cap' });
    }
    expect(alert.messages).toHaveLength(2);
    expect(alert.messages[1]).toBe(
      'The usage tier cap of $100.00 a month stopped the agents: the studio key has spent $99.00 since 2026-10-01T00:00:00.000Z. It clears when the month turns, or when Anthropic raises the tier and the new limit is reported.',
    );
  });

  it('runs no platform code card and no card off horizon now', async () => {
    const db = new FakeDb();
    db.cards = [card({ id: 'site', folder: 'platform', lane: 'code' }), card({ id: 'later', horizon: 'later' })];
    expect(await tick(deps(db, []))).toEqual({ action: 'sleep', reason: 'no_eligible_card' });
    expect(db.claims).toBe(0);
  });

  it('starts a platform code card once studio_state.platform_lane_open is set', async () => {
    const db = new FakeDb();
    db.studio.platform_lane_open = true;
    db.cards = [card({ id: 'site', folder: 'platform', lane: 'code' }), card({ id: 'later', horizon: 'later' })];
    expect(await tick(deps(db, []))).toEqual({ action: 'started', cardId: 'site' });
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

  it('sleeps at the daily cap in unattended mode, alerting once a day and counting only today', async () => {
    const db = new FakeDb();
    db.studio.agent_mode = 'unattended';
    db.cards = [card()];
    db.pool.daily_spent_usd = 99;
    const alert = new RecordingAlerter();
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'daily_cap' });
    expect(await tick(deps(db, [], { mode: 'unattended', alert }))).toEqual({ action: 'sleep', reason: 'daily_cap' });
    expect(alert.messages).toEqual(['The daily cap of $100.00 stopped the agents for 2026-09-14.']);
    expect(alert.pings).toBe(2);
    db.pool.day = '2026-09-13';
    expect(await tick(deps(db, [], { mode: 'unattended' }))).toEqual({ action: 'started', cardId: card().id });
  });

  it('starts a card in attended mode with an empty pool, over the cap, with no credit and above the balance, on its full ceiling', async () => {
    const db = new FakeDb();
    db.pool = { ...db.pool, balance_usd: 0, daily_spent_usd: 500 };
    db.creditPurchased = 0;
    db.studio.monthly_cap_usd = null;
    db.cards = [card({ estimate_usd: 12 }), card({ id: 'other', estimate_usd: 5, funded_usd: 5, priority: 200 })];
    const budgets = new SessionBudgets();
    expect(await tick(deps(db, [], { budgets, runCard: stillRunning }))).toEqual({ action: 'started', cardId: card().id });
    expect(budgets.budgetFor(card().id)).toBe(Number.POSITIVE_INFINITY);
  });

  it('ticks only while it holds the lease: a second dispatcher claims nothing and does not ping until the lease lapses', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    const alertA = new RecordingAlerter();
    const alertB = new RecordingAlerter();
    expect(await tick(deps(db, [], { alert: alertA }))).toEqual({ action: 'started', cardId: card().id });
    db.cards.push(card({ id: 'second', priority: 200 }));
    expect(await tick(deps(db, [], { alert: alertB, leaseHolder: 'dispatcher-b' }))).toEqual({ action: 'sleep', reason: 'lease_held' });
    expect(await tick(deps(db, [], { alert: alertB, leaseHolder: 'dispatcher-b' }))).toEqual({ action: 'sleep', reason: 'lease_held' });
    expect(db.claims).toBe(1);
    expect(db.heartbeats).toHaveLength(1);
    expect([alertA.pings, alertB.pings]).toEqual([1, 0]);
    expect(alertB.messages).toEqual(['Another dispatcher holds the dispatcher lease, so this one claims no card. Stop one of them.']);
    // A holds it until 300 s after its last claim; then B takes it over.
    db.clock = () => NOW.getTime() + 301_000;
    expect(await tick(deps(db, [], { alert: alertB, leaseHolder: 'dispatcher-b' }))).toEqual({ action: 'started', cardId: 'second' });
    expect(db.lease?.holder).toBe('dispatcher-b');
    await db.releaseLease('dispatcher-a');
    expect(db.lease?.holder).toBe('dispatcher-b');
    await db.releaseLease('dispatcher-b');
    expect(db.lease).toBeNull();
  });

  it('holds the lease for five ticks, at least five minutes and at most the hour claim_dispatcher_lease allows', () => {
    expect(leaseTtlSeconds(60_000)).toBe(300);
    expect(leaseTtlSeconds(120_000)).toBe(600);
    expect(leaseTtlSeconds(1000)).toBe(300);
    expect(leaseTtlSeconds(60 * 60_000)).toBe(3600);
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

  it('drops a card session budget when its pipeline ends', async () => {
    const db = new FakeDb();
    db.cards = [card()];
    const budgets = new SessionBudgets();
    let finish: () => void = () => undefined;
    const runCard = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    await tick(deps(db, [], { budgets, runCard }));
    expect(budgets.budgetFor(card().id)).toBe(Number.POSITIVE_INFINITY);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(budgets.budgetFor(card().id)).toBeUndefined();
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

  // docs/specs/money-safety.md: a red main would fail every card's gate for a break it did not cause.
  it("claims nothing while main's gate has failed, alerts once per red sha, and claims again once main is green", async () => {
    const db = new FakeDb();
    db.cards = [card()];
    const started: string[] = [];
    const alert = new RecordingAlerter();
    let main: { sha: string; status: import('../src/github.js').GateStatus } = { sha: 'a'.repeat(40), status: { state: 'fail', conclusion: 'failure' } };
    const mainGate = async () => main;
    expect(await tick(deps(db, started, { alert, mainGate }))).toEqual({ action: 'sleep', reason: 'main_red' });
    expect(await tick(deps(db, started, { alert, mainGate }))).toEqual({ action: 'sleep', reason: 'main_red' });
    expect(alert.messages).toEqual([
      "main's gate failed at aaaaaaaa (failure), so no card is claimed until main is green again. Cards stay funded with their money; fix main with a pull request.",
    ]);
    expect(db.claims).toBe(0);
    // A cancelled or pending gate on main does not stop claiming: the card's own gate decides.
    main = { sha: 'b'.repeat(40), status: { state: 'fail', conclusion: 'cancelled' } };
    expect((await tick(deps(db, started, { alert, mainGate }))).action).toBe('started');
    db.cards = [card()];
    main = { sha: 'c'.repeat(40), status: { state: 'pending' } };
    expect((await tick(deps(db, started, { alert, mainGate }))).action).toBe('started');
    expect(started).toEqual([card().id, card().id]);
  });

  it("claims nothing while main's gate cannot be read, so no session is spent on a card that could not be pushed", async () => {
    const db = new FakeDb();
    db.cards = [card()];
    const mainGate = async (): Promise<never> => {
      throw new Error('github ref main: http 502');
    };
    expect(await tick(deps(db, [], { mainGate }))).toEqual({ action: 'sleep', reason: 'main_unreadable' });
    expect(db.claims).toBe(0);
  });
});
