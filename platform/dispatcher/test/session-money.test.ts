// The session's money rules beside the metering in session.test.ts: the throttle's budget, API
// errors Claude Code writes as "<synthetic>" turns, a Console credit that ran out, an adapter's own
// request ids, premium tiers, and role models resolved when the session starts.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../src/adapters/types.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { runAgentSession, type SessionDeps } from '../src/session.js';
import { FakeAdapter, startEvent, untilAborted, usageEvent, type FakeOptions, type FakeScript } from './helpers/fake-adapter.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card, role } from './helpers/fake-db.js';

// 1000 input + N output tokens on builder-class cost 0.003 + N × 0.000015; premium-class is five times that.
const PRICE_TABLE = parsePriceTable(
  JSON.stringify({
    'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 },
    'premium-class': { input: 15, output: 75, cache_read: 1.5, cache_write_5m: 18.75, cache_write_1h: 30 },
  }),
);
const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
const STUDIO_KEY = 'ANTHROPIC_API_KEY';

function deps(db: FakeDb, adapter: FakeAdapter, overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    db,
    adapter,
    priceTable: PRICE_TABLE,
    sessionMaxTurns: 60,
    watchIntervalMs: 60_000,
    fallbackModel: 'builder-class',
    sessionMaxMs: 60 * 60_000,
    ledgerRetryMs: 1,
    alert: new RecordingAlerter(),
    log: silent,
    stopSignal: new AbortController().signal,
    now: () => NOW,
    ...overrides,
  };
}

async function run(script: FakeScript, overrides: Partial<SessionDeps> = {}, adapterOptions: FakeOptions = {}, roleModel = 'builder-class') {
  const db = new FakeDb();
  const c = card();
  db.cards = [c];
  const adapter = new FakeAdapter(script, adapterOptions);
  const alert = new RecordingAlerter();
  const result = await runAgentSession(c, role({ model: roleModel }), '/worktree', db.studio, deps(db, adapter, { alert, ...overrides }));
  return { db, adapter, alert, result };
}

const synthetic = (turn: number, text: string): AgentEvent[] => [
  { type: 'message', text },
  { type: 'turn_usage', turn, model: '<synthetic>', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, contentChars: text.length, thinking: false },
];

describe('the session budget', () => {
  it('passes the throttle budget to the adapter and stops at it, below the ceiling, as outcome budget', async () => {
    const spend: number[] = [];
    const { adapter, result } = await run(
      async (_spec, emit, signal) => {
        await emit(startEvent(undefined, STUDIO_KEY));
        await emit(usageEvent(1, 10));
        await emit(usageEvent(2, 100_000));
        await untilAborted(signal, 200);
      },
      { budgetUsd: 1, onSpend: (usd) => spend.push(usd) },
      { mode: 'unattended' },
    );
    expect(adapter.specs[0]?.maxBudgetUsd).toBe(1);
    expect(result.outcome).toBe('budget');
    expect(result.detail).toMatch(/^estimated session spend [\d.]+ reached the session budget 1, below the ceiling 3$/);
    expect(spend.length).toBeGreaterThanOrEqual(2);
    expect(spend.at(-1)).toBeGreaterThanOrEqual(1);
  });

  it('lets the ceiling win when it is the lower of the two', async () => {
    const { adapter, result } = await run(
      async (_spec, emit, signal) => {
        await emit(startEvent(undefined, STUDIO_KEY));
        await emit(usageEvent(1, 300_000));
        await untilAborted(signal, 200);
      },
      { budgetUsd: 10 },
      { mode: 'unattended' },
    );
    expect(adapter.specs[0]?.maxBudgetUsd).toBe(3);
    expect(result.outcome).toBe('ceiling');
  });

  it('maps the command line stopping at a budget below the ceiling to outcome budget', async () => {
    const { result } = await run(
      async (_spec, emit) => {
        await emit(startEvent(undefined, STUDIO_KEY));
        await emit(usageEvent(1, 10));
      },
      { budgetUsd: 2 },
      { mode: 'unattended', subtype: 'error_max_budget_usd', isError: true, exitCode: 1 },
    );
    expect(result).toMatchObject({ outcome: 'budget', detail: 'session reached its budget of 2 USD' });
  });

  it('starts no session when the throttle left nothing, so the card is not refused', async () => {
    const { adapter, result } = await run(async () => undefined, { budgetUsd: 0 }, { mode: 'unattended' });
    expect(result).toEqual({ outcome: 'insufficient_balance', detail: 'the throttle allowed 0 USD for this session', turns: 0 });
    expect(adapter.specs).toEqual([]);
  });

  it('gives an attended session its whole remaining ceiling', async () => {
    const { adapter, result } = await run(async (_spec, emit) => {
      await emit(startEvent());
      await emit(usageEvent(1, 10));
    });
    expect(adapter.specs[0]?.maxBudgetUsd).toBe(3);
    expect(result.outcome).toBe('completed');
  });
});

describe('API errors', () => {
  it('meters nothing for a <synthetic> turn and does not stop the session as an unknown model', async () => {
    const { db, alert, result } = await run(async (_spec, emit) => {
      await emit(startEvent());
      await emit(usageEvent(1, 100));
      for (const event of synthetic(2, 'API Error: 529 overloaded')) await emit(event);
      await emit(usageEvent(3, 100));
    });
    expect(result.outcome).toBe('completed');
    expect(db.ledger.map((row) => row.model)).toEqual(['builder-class', 'builder-class']);
    expect(alert.messages).toEqual([]);
  });

  it('stops as credit_exhausted when a <synthetic> turn says the credit balance is too low, and writes nothing for it', async () => {
    const { db, result } = await run(
      async (_spec, emit, signal) => {
        await emit(startEvent(undefined, STUDIO_KEY));
        for (const event of synthetic(1, 'Credit balance is too low')) await emit(event);
        await untilAborted(signal, 200);
      },
      {},
      { mode: 'unattended' },
    );
    expect(result).toMatchObject({ outcome: 'credit_exhausted', detail: 'the API refused the studio key for credit: Credit balance is too low' });
    expect(db.ledger).toEqual([]);
  });

  it('stops as credit_exhausted on an adapter error event about the Console limit', async () => {
    const { result } = await run(
      async (_spec, emit, signal) => {
        await emit(startEvent(undefined, STUDIO_KEY));
        await emit({ type: 'error', message: 'You have reached your specified API usage limits.' });
        await untilAborted(signal, 200);
      },
      {},
      { mode: 'unattended' },
    );
    expect(result.outcome).toBe('credit_exhausted');
  });

  it("stops as tier_cap on an adapter error event about the usage tier's monthly cap, never as credit", async () => {
    const { result } = await run(
      async (_spec, emit, signal) => {
        await emit(startEvent(undefined, STUDIO_KEY));
        await emit({
          type: 'error',
          message: 'the Managed Agents session could not be created: 429 {"type":"error","error":{"type":"rate_limit_error","message":"You have reached your API usage limits: your organization has crossed its monthly API usage threshold."},"error_code":"enforced_spend_limit_reached"}',
        });
        await untilAborted(signal, 200);
      },
      {},
      { mode: 'unattended' },
    );
    expect(result.outcome).toBe('tier_cap');
    expect(result.detail).toMatch(/^the API refused the studio key at its usage tier's monthly cap: the Managed Agents session could not be created: 429 /);
  });

  it('does not treat the agent writing about credit in its own reply as an API error', async () => {
    const { result } = await run(async (_spec, emit) => {
      await emit(startEvent());
      await emit({ type: 'message', text: 'Credit balance is too low is the error the probe checks for.' });
      await emit(usageEvent(1, 10));
    });
    expect(result.outcome).toBe('completed');
  });
});

describe('request ids and premium tiers', () => {
  it('writes a turn under the request id its adapter named', async () => {
    const { db } = await run(async (_spec, emit) => {
      await emit(startEvent());
      await emit({ ...usageEvent(1, 10), requestId: 'sevt_0001' } as AgentEvent);
      await emit(usageEvent(2, 10));
    });
    expect(db.ledger[0]?.request_id).toBe('sevt_0001');
    expect(db.ledger[1]?.request_id).toMatch(/^4c2f5a1e-7b3d-4e8a-9f01-2a3b4c5d6e7f\/[0-9a-f-]{36}\/turn\/2$/);
  });

  it('prices a turn at a premium tier at the table highest rates, runs on, and alerts', async () => {
    const { db, alert, result } = await run(async (_spec, emit) => {
      await emit(startEvent());
      await emit(usageEvent(1, 100, 'builder-class', { service_tier: 'priority' }));
    });
    expect(result.outcome).toBe('completed');
    // 1000 × 15 + 100 × 75 per million, premium-class rates.
    expect(db.ledger[0]?.usd).toBe(0.0225);
    expect(alert.messages).toEqual([
      expect.stringContaining("Card 4c2f5a1e metering: turns ran at a premium tier and were priced at the table's highest rates, which may be below the tier's price: builder-class: service_tier priority."),
    ]);
    expect(db.events.find((event) => event.payload.step === 'metering')?.payload).toMatchObject({ premium_tiers: ['builder-class: service_tier priority'] });
  });
});

describe('role models', () => {
  it('runs on the model the role resolves to when the session starts, not a stale roles.model', async () => {
    const { adapter, result } = await run(
      async (_spec, emit) => {
        await emit(startEvent());
        await emit(usageEvent(1, 10));
      },
      { resolveModel: () => 'builder-class' },
      {},
      'retired-model',
    );
    expect(adapter.specs[0]?.model).toBe('builder-class');
    expect(result.outcome).toBe('completed');
  });
});
