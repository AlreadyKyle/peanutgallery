import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { parsePriceTable, priceUsage, round4 } from '../src/pricing.js';
import { ceilingUsd, runAgentSession, sessionPrompt, type SessionDeps } from '../src/session.js';
import { FakeAdapter, startEvent, untilAborted, usageEvent, type FakeOptions, type FakeScript } from './helpers/fake-adapter.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card, role } from './helpers/fake-db.js';
import type { UsageInput } from '../src/db.js';

// USD per million tokens; 1000 input + N output tokens cost 0.003 + N × 0.000015.
const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));

function deps(db: FakeDb, adapter: FakeAdapter, overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    db,
    adapter,
    priceTable: PRICE_TABLE,
    sessionMaxTurns: 60,
    boardSessionTtlMin: 3,
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

async function run(db: FakeDb, script: FakeScript, overrides: Partial<SessionDeps> = {}, cardOverrides = {}, adapterOptions: FakeOptions = {}) {
  const c = card(cardOverrides);
  db.cards = [c];
  const adapter = new FakeAdapter(script, adapterOptions);
  const alert = (overrides.alert as RecordingAlerter | undefined) ?? new RecordingAlerter();
  const result = await runAgentSession(c, role(), '/worktree', db.studio, deps(db, adapter, { ...overrides, alert }));
  return { result, adapter, alert };
}

// A database whose record_usage throws for rows the predicate picks, `times` times each call site.
class FailingDb extends FakeDb {
  attempts = 0;
  ids: Array<string | null> = [];
  constructor(
    private readonly fails: (input: UsageInput) => boolean,
    private times: number,
  ) {
    super();
  }
  override async recordUsage(input: UsageInput) {
    this.ids.push(input.request_id);
    if (this.fails(input) && this.times > 0) {
      this.times -= 1;
      this.attempts += 1;
      throw new Error('db record_usage: connection reset');
    }
    return super.recordUsage(input);
  }
}

describe('ceilingUsd', () => {
  it('is 150% of the estimate capped by card_max_usd', () => {
    expect(ceilingUsd(2, 25)).toBe(3);
    expect(ceilingUsd(20, 25)).toBe(25);
    expect(ceilingUsd(1.2345, 25)).toBe(1.8518);
  });
});

describe('sessionPrompt', () => {
  it('carries the card, its money, the allowed paths, the definition of done and the stop rule, and nothing else', () => {
    const prompt = sessionPrompt(card(), ['seed-1/config', 'seed-1/content'], 3);
    expect(prompt).toContain('Card 4c2f5a1e: spawn table row gatherer: baseCost changes from 10 to 11');
    expect(prompt).toContain('Bucket: game. Lane: config. Folder: seed-1.');
    expect(prompt).toContain('Estimate: $2.00. Ceiling: $3.00 (the session stops there).');
    expect(prompt).toContain('Raise the gatherer base cost by one.');
    expect(prompt).toContain('check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11');
    expect(prompt).toContain('Allowed paths: seed-1/config, seed-1/content.');
    expect(prompt).toContain('Definition of done:');
    expect(prompt).toContain('- every check: line in the acceptance test is true in this working tree');
    expect(prompt).toContain('- the invariants pass: the commands your role prompt names all exit 0');
    expect(prompt).toContain('- only files under the allowed paths changed');
    expect(prompt).toContain('- no git, gh or network; the dispatcher commits and pushes');
    expect(prompt).toContain('Do not run git.');
    expect(prompt).toContain('Stop as soon as the acceptance check holds');
    expect(prompt).not.toContain('Design spec');
    expect(prompt).not.toContain('Never edit');
    expect(prompt).not.toMatch(/board|note|community/i);
  });

  it('names the kernel file and folder names as never to be created or edited, in every lane', () => {
    for (const [lane, allowed] of [['config', ['seed-1/config', 'seed-1/content']], ['code', ['seed-1']]] as const) {
      const prompt = sessionPrompt(card({ lane }), allowed, 3);
      expect(prompt).toContain('Never create or edit a file or folder with one of these names, at any depth: .claude, CLAUDE.md, CLAUDE.local.md,');
    }
  });

  it('names the kernel paths inside a code lane as never to be edited', () => {
    const prompt = sessionPrompt(card({ lane: 'code' }), ['seed-1'], 3);
    expect(prompt).toContain('Allowed paths: seed-1.\nNever edit, even inside the allowed paths: seed-1/CLAUDE.md, seed-1/bots,');
    expect(prompt).toContain('seed-1/sim/invariants.ts');
  });

  it('names the design spec, between the acceptance test and the allowed paths, only when the card has one', () => {
    const url = 'https://peanutgallery.games/specs/gatherer-cost';
    const prompt = sessionPrompt(card({ design_spec_url: url }), ['seed-1/config', 'seed-1/content'], 3);
    expect(prompt).toContain(`\n\nDesign spec: ${url}\n\nAllowed paths:`);
    expect(prompt.indexOf('Acceptance test:')).toBeLessThan(prompt.indexOf('Design spec:'));
    expect(sessionPrompt(card({ design_spec_url: '   ' }), ['seed-1/config'], 3)).not.toContain('Design spec');
  });

  it('rounds the estimate and the ceiling to cents', () => {
    const prompt = sessionPrompt(card({ estimate_usd: 1.2345 }), ['seed-1/config'], ceilingUsd(1.2345, 25));
    expect(prompt).toContain('Estimate: $1.23. Ceiling: $1.85 (the session stops there).');
  });
});

describe('runAgentSession metering', () => {
  it('records one ledger row per turn and completes', async () => {
    const db = new FakeDb();
    const { result, alert } = await run(db, async (_spec, emit) => {
      await emit(startEvent());
      await emit({ type: 'message', text: 'Reading the spawn table.' });
      await emit({ type: 'tool_call', toolUseId: 't1', name: 'Read', input: { file_path: 'seed-1/config/spawn-table.json' } });
      await emit(usageEvent(1, 100));
      await emit({ type: 'tool_result', toolUseId: 't1', content: '{}', isError: false });
      await emit(usageEvent(2, 200));
      await emit(usageEvent(3, 0, 'builder-class', { input_tokens: 0 }));
    });
    expect(result).toEqual({ outcome: 'completed', detail: 'session completed in 3 turns', turns: 3 });
    expect(db.ledger.map((row) => row.usd)).toEqual([0.0045, 0.006]);
    expect(db.ledger[0]).toMatchObject({ billed_to: 'founder', card_id: card().id, role_id: 'role-builder-a', model: 'builder-class', input_tokens: 1000, cached_tokens: 0, output_tokens: 100 });
    expect(db.cards[0]?.actual_usd).toBe(0.0105);
    // Attended turns run on the founder's subscription: priced and charged to the card, not the pool.
    expect(db.pool).toMatchObject({ balance_usd: 50, daily_spent_usd: 0 });
    expect(db.events.map((event) => event.type)).toEqual(['start', 'message', 'tool_call', 'tool_result']);
    // The result line agrees with the turns, so there is nothing to settle and nothing to alert.
    expect(alert.messages).toEqual([]);
  });

  it('settles against the result line so the card is charged the modelUsage priced with our table', async () => {
    const db = new FakeDb();
    // The turns report 10 output tokens each; the result line counts 5000 over the session.
    const modelUsage = [{ model: 'builder-class', input_tokens: 2000, output_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 9.99 }];
    const { result, alert } = await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent());
        await emit(usageEvent(1, 10));
        await emit(usageEvent(2, 10));
      },
      {},
      {},
      { modelUsage },
    );
    expect(result.outcome).toBe('completed');
    const priced = round4(priceUsage(PRICE_TABLE, 'builder-class', { input_tokens: 2000, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5000 }).usd);
    expect(priced).toBe(0.081);
    expect(db.ledger.map((row) => [row.output_tokens, row.usd])).toEqual([
      [10, 0.0032],
      [10, 0.0032],
      [4980, 0.0746],
    ]);
    expect(db.ledger[2]).toMatchObject({ billed_to: 'founder', card_id: card().id, role_id: 'role-builder-a', model: 'builder-class', input_tokens: 0 });
    expect(db.cards[0]?.actual_usd).toBe(priced);
    expect(alert.messages).toEqual([]);
  });

  it('aborts before the estimated spend crosses the ceiling, counting output the stream has not reported', async () => {
    const db = new FakeDb();
    const { result } = await run(db, async (_spec, emit, signal) => {
      await emit(startEvent());
      // 10 output tokens reported ($0.0032 recorded), but 600000 characters written: about 200000
      // tokens, $3 at the output rate, against a $3 ceiling.
      await emit(usageEvent(1, 10, 'builder-class', {}, 600_000));
      await untilAborted(signal, 200);
    });
    expect(result).toMatchObject({ outcome: 'ceiling', turns: 1 });
    expect(db.ledger.map((row) => row.usd)).toEqual([0.0032]);
  });

  it('writes an estimate row and alerts once when a killed session leaves no result line', async () => {
    const db = new FakeDb();
    const stop = new AbortController();
    const { result, alert } = await run(
      db,
      async (_spec, emit, signal) => {
        await emit(startEvent());
        await emit(usageEvent(1, 100, 'builder-class', {}, 3000));
        stop.abort('dispatcher stopping');
        await untilAborted(signal, 2000);
      },
      { stopSignal: stop.signal },
      {},
      { resultOnAbort: false },
    );
    expect(result.outcome).toBe('stopped');
    // 3000 characters is 1,000 output tokens for the turn. The request in flight adds the turn's 1,000
    // input tokens again and 1,024 output: 2,000 input and 2,024 output in all, $0.0364.
    expect(db.ledger.map((row) => [row.input_tokens, row.output_tokens, row.usd])).toEqual([
      [1000, 100, 0.0045],
      [1000, 1924, 0.0319],
    ]);
    expect(db.cards[0]?.actual_usd).toBe(0.0364);
    expect(db.events.filter((event) => event.type === 'error')).toEqual([
      {
        card_id: card().id,
        role_id: 'role-builder-a',
        type: 'error',
        payload: {
          step: 'metering',
          basis: 'estimate',
          rows: [{ model: 'builder-class', input_tokens: 1000, cached_tokens: 0, output_tokens: 1924, usd: 0.0319, request_id: expect.stringMatching(/\/settle\/1$/) }],
          unwritten_rows: [],
          billed_to: 'founder',
          fallback_models: [],
          mismatch: false,
          anomaly: false,
          overcount_usd: 0,
          cli_total_cost_usd: null,
        },
      },
    ]);
    expect(alert.messages).toHaveLength(1);
    expect(alert.messages[0]).toContain('Card 4c2f5a1e metering');
  });

  it('retries a failed turn write, and a turn the ledger refuses three times is written at settle', async () => {
    const once = new FailingDb((input) => input.output_tokens === 10, 1);
    const { result: completed } = await run(once, async (_spec, emit) => {
      await emit(startEvent());
      await emit(usageEvent(1, 10));
    });
    expect(completed.outcome).toBe('completed');
    expect(once.ledger.map((row) => row.usd)).toEqual([0.0032]);

    const refused = new FailingDb((input) => input.output_tokens === 10, 3);
    const { result, alert } = await run(refused, async (_spec, emit, signal) => {
      await emit(startEvent());
      await emit(usageEvent(1, 10));
      await untilAborted(signal, 200);
    });
    expect(result).toEqual({ outcome: 'error', detail: 'the ledger refused turn 1: db record_usage: connection reset', turns: 1 });
    expect(refused.attempts).toBe(3);
    // The row was not counted as recorded, so settle wrote it once and nothing else, with the id every
    // attempt carried.
    expect(refused.ledger.map((row) => [row.output_tokens, row.usd])).toEqual([[10, 0.0032]]);
    expect(new Set(refused.ids).size).toBe(1);
    expect(refused.ledger[0]?.request_id).toMatch(new RegExp(`^${card().id}/[0-9a-f-]{36}/turn/1$`));
    expect(refused.cards[0]?.actual_usd).toBe(0.0032);
    expect(alert.messages).toEqual([]);
  });

  it('writes a turn once when the ledger commits it but the reply is lost, retrying with the same request id', async () => {
    class LostReplyDb extends FakeDb {
      ids: Array<string | null> = [];
      lost = 1;
      override async recordUsage(input: UsageInput) {
        this.ids.push(input.request_id);
        const result = await super.recordUsage(input);
        if (this.lost > 0) {
          this.lost -= 1;
          throw new Error('db record_usage: TypeError: fetch failed');
        }
        return result;
      }
    }
    const db = new LostReplyDb();
    const { result } = await run(db, async (_spec, emit) => {
      await emit(startEvent());
      await emit(usageEvent(1, 10));
    });
    expect(result.outcome).toBe('completed');
    expect(db.ids).toHaveLength(2);
    expect(db.ids[1]).toBe(db.ids[0]);
    expect(db.ledger).toHaveLength(1);
    expect(db.cards[0]?.actual_usd).toBe(0.0032);
  });

  it('logs the settle rows before it writes them, and the estimate beside the settled total', async () => {
    const lines: string[] = [];
    const log = createLogger(new Writable({ write: (chunk, _enc, cb) => { lines.push(String(chunk)); cb(); } }));
    class NotingDb extends FakeDb {
      override async recordUsage(input: UsageInput) {
        lines.push(`write ${input.request_id}`);
        return super.recordUsage(input);
      }
    }
    const db = new NotingDb();
    const modelUsage = [{ model: 'builder-class', input_tokens: 2000, output_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0.09 }];
    await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent());
        await emit(usageEvent(1, 10));
        await emit(usageEvent(2, 10));
      },
      { log },
      {},
      { modelUsage },
    );
    const settling = lines.findIndex((line) => line.includes('"msg":"settle rows"'));
    const write = lines.findIndex((line) => /^write .*\/settle\/1$/.test(line));
    expect(settling).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(settling);
    expect(JSON.parse(lines[settling]!).rows).toEqual([
      { request_id: expect.stringMatching(/\/settle\/1$/), model: 'builder-class', input_tokens: 0, cached_tokens: 0, output_tokens: 4980, usd: 0.0746 },
    ]);
    const checks = lines.filter((line) => line.includes('"msg":"metering estimate check"')).map((line) => JSON.parse(line) as Record<string, unknown>);
    // Two turns of 1,000 input and 10 output, and a request in flight of 1,000 input and 1,024 output.
    expect(checks).toEqual([
      expect.objectContaining({ card: card().id, basis: 'result', turns: 2, estimate_usd: 0.02466, settled_usd: 0.081, cli_total_cost_usd: null }),
    ]);
  });

  it('names a settle row the ledger refuses, with its amount, for the board to post by hand', async () => {
    const db = new FailingDb((input) => input.output_tokens === 4980, 3);
    const modelUsage = [{ model: 'builder-class', input_tokens: 2000, output_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null }];
    const { result, alert } = await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent());
        await emit(usageEvent(1, 10));
        await emit(usageEvent(2, 10));
      },
      {},
      {},
      { modelUsage },
    );
    expect(result.outcome).toBe('completed');
    expect(db.attempts).toBe(3);
    expect(db.ledger).toHaveLength(2);
    expect(db.events.find((event) => event.type === 'error')?.payload).toMatchObject({
      unwritten_rows: [{ model: 'builder-class', output_tokens: 4980, usd: 0.0746, error: 'db record_usage: connection reset' }],
    });
    expect(alert.messages).toEqual([expect.stringMatching(/rows not written, to post by hand: \S+\/settle\/1 builder-class 0\.0746 USD/)]);
  });

  it('reconciles a renamed modelUsage key under the turn model and alerts', async () => {
    const db = new FakeDb();
    const modelUsage = [{ model: 'builder-class-20260801', input_tokens: 2000, output_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null }];
    const { alert } = await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent());
        await emit(usageEvent(1, 10));
        await emit(usageEvent(2, 10));
      },
      {},
      {},
      { modelUsage },
    );
    // Priced at builder-class's rates, the renamed key's rows total $0.081, once.
    expect(db.ledger.map((row) => [row.model, row.usd])).toEqual([
      ['builder-class', 0.0032],
      ['builder-class', 0.0032],
      ['builder-class', 0.0746],
    ]);
    expect(db.cards[0]?.actual_usd).toBe(0.081);
    expect(alert.messages).toEqual([expect.stringContaining('modelUsage names builder-class-20260801 but the turns named builder-class')]);
  });

  it('settles a zeroed modelUsage on the estimate and alerts', async () => {
    const db = new FakeDb();
    const modelUsage = [{ model: 'builder-class', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null }];
    const { alert } = await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent());
        await emit(usageEvent(1, 100, 'builder-class', {}, 3000));
      },
      {},
      {},
      { modelUsage },
    );
    // The turn's 1,000 estimated output tokens, not the result line's zero: 900 more at $15 per million.
    expect(db.ledger.map((row) => [row.output_tokens, row.usd])).toEqual([
      [100, 0.0045],
      [900, 0.0135],
    ]);
    expect(db.events.find((event) => event.type === 'error')?.payload).toMatchObject({ basis: 'estimate', anomaly: true });
    expect(alert.messages).toEqual([expect.stringContaining('modelUsage reported fewer tokens than the turns')]);
  });

  it('meters a side model at fallback rates and alerts about it once per process', async () => {
    const alert = new RecordingAlerter();
    const modelUsage = [
      { model: 'builder-class', input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null },
      { model: 'side-model', input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null },
    ];
    for (let session = 0; session < 2; session += 1) {
      const db = new FakeDb();
      await run(
        db,
        async (_spec, emit) => {
          await emit(startEvent());
          await emit(usageEvent(1, 100));
        },
        { alert },
        {},
        { modelUsage },
      );
      // 100 × $3 + 10 × $15 per million at the fallback rates, which are builder-class's here.
      expect(db.ledger.map((row) => [row.model, row.usd])).toEqual([
        ['builder-class', 0.0045],
        ['side-model', 0.0005],
      ]);
    }
    expect(alert.messages).toEqual([expect.stringContaining('Model side-model is missing from PRICE_TABLE_JSON')]);
  });

  it('records an unattended session with no init line as the founder\'s spend and alerts', async () => {
    const db = new FakeDb();
    const { alert } = await run(
      db,
      async (_spec, emit) => {
        await emit(usageEvent(1, 100));
      },
      {},
      {},
      { mode: 'unattended' },
    );
    expect(db.ledger).toEqual([expect.objectContaining({ billed_to: 'founder', usd: 0.0045 })]);
    expect(db.pool).toMatchObject({ balance_usd: 50, daily_spent_usd: 0 });
    expect(alert.messages).toEqual([expect.stringContaining('no init line confirmed the studio key')]);
  });

  it('aborts when the session runs past its wall clock', async () => {
    const db = new FakeDb();
    const { result } = await run(
      db,
      async (_spec, emit, signal) => {
        await emit(startEvent());
        await untilAborted(signal, 2000);
      },
      { sessionMaxMs: 20 },
    );
    expect(result).toMatchObject({ outcome: 'wall_clock' });
  });

  it('bills unattended turns to the studio and takes them from the pool', async () => {
    const db = new FakeDb();
    const { result } = await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent(undefined, 'ANTHROPIC_API_KEY'));
        await emit(usageEvent(1, 100));
      },
      {},
      {},
      { mode: 'unattended' },
    );
    expect(result.outcome).toBe('completed');
    expect(db.ledger.map((row) => row.billed_to)).toEqual(['studio']);
    expect(db.pool).toMatchObject({ balance_usd: 49.9955, daily_spent_usd: 0.0045 });
  });

  it('aborts with ceiling on the turn that crosses it and finishes as paused-worthy', async () => {
    const db = new FakeDb();
    const { result } = await run(db, async (_spec, emit, signal) => {
      await emit(startEvent());
      await emit(usageEvent(1, 100_000));
      await emit(usageEvent(2, 100_000));
      await emit(usageEvent(3, 100_000));
      await untilAborted(signal, 200);
    });
    // ceiling is 3 USD; turn 1 costs 1.503, turn 2 crosses it.
    expect(result).toMatchObject({ outcome: 'ceiling', turns: 2 });
    expect(db.ledger).toHaveLength(2);
    expect(db.cards[0]?.actual_usd).toBe(3.006);
  });

  it('aborts on the turn cap even when the turn reports no usage', async () => {
    const db = new FakeDb();
    const { result } = await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent());
        await emit(usageEvent(1, 10));
        await emit(usageEvent(2, 10));
        await emit(usageEvent(3, 0, 'builder-class', { input_tokens: 0 }));
      },
      { sessionMaxTurns: 2 },
    );
    expect(result).toMatchObject({ outcome: 'turn_cap', detail: 'turn 3 exceeds the cap 2' });
    expect(db.ledger).toHaveLength(2);
  });

  it('records an unknown model at the fallback rates and then aborts', async () => {
    const db = new FakeDb();
    const { result, alert } = await run(db, async (_spec, emit, signal) => {
      await emit(startEvent());
      await emit(usageEvent(1, 10, 'mystery-model'));
      await untilAborted(signal, 200);
    });
    expect(result).toMatchObject({ outcome: 'unknown_model', detail: 'no price for model mystery-model' });
    // The only row in the table is builder-class, so the fallback rates are its rates.
    expect(db.ledger).toEqual([expect.objectContaining({ model: 'mystery-model', input_tokens: 1000, output_tokens: 10, usd: 0.0032 })]);
    expect(db.events.find((event) => event.type === 'error')?.payload).toMatchObject({ step: 'metering', basis: 'result', fallback_models: ['mystery-model'] });
    expect(alert.messages).toHaveLength(1);
  });

  it('never starts a session whose model has no price', async () => {
    const db = new FakeDb();
    const adapter = new FakeAdapter(async () => undefined);
    const c = card();
    db.cards = [c];
    const result = await runAgentSession(c, role({ model: 'mystery-model' }), '/worktree', db.studio, deps(db, adapter));
    expect(result).toEqual({ outcome: 'unknown_model', detail: 'no price for model mystery-model', turns: 0 });
    expect(adapter.specs).toHaveLength(0);
    expect(db.ledger).toHaveLength(0);
  });

  it('refuses a session whose init line exposes an excluded tool', async () => {
    const db = new FakeDb();
    const { result } = await run(db, async (_spec, emit) => {
      await emit(startEvent(['Read', 'WebFetch']));
      await emit(usageEvent(1, 10));
    });
    expect(result).toMatchObject({ outcome: 'refused', detail: 'session exposes excluded tools: WebFetch' });
    expect(db.ledger).toHaveLength(0);
  });

  it('refuses an attended session that bills an API key', async () => {
    const db = new FakeDb();
    const { result } = await run(db, async (_spec, emit) => {
      await emit(startEvent(undefined, 'ANTHROPIC_API_KEY'));
      await emit(usageEvent(1, 10));
    });
    expect(result).toMatchObject({ outcome: 'refused', detail: 'session is billed to the wrong account (ANTHROPIC_API_KEY)' });
    expect(db.ledger).toHaveLength(0);
    expect(db.events[0]?.payload).toMatchObject({
      mode: 'attended',
      api_key_source: 'ANTHROPIC_API_KEY',
      refusal: 'session is billed to the wrong account (ANTHROPIC_API_KEY)',
    });
  });

  it('decides the refusal before it writes the start event', async () => {
    const seen: { signal: AbortSignal | null; abortedAtStart: boolean | null } = { signal: null, abortedAtStart: null };
    class OrderDb extends FakeDb {
      override async insertEvent(...args: Parameters<FakeDb['insertEvent']>) {
        if (args[2] === 'start') seen.abortedAtStart = seen.signal?.aborted ?? null;
        await super.insertEvent(...args);
      }
    }
    const db = new OrderDb();
    const { result } = await run(db, async (_spec, emit, signal) => {
      seen.signal = signal;
      await emit(startEvent(['Read', 'WebFetch']));
    });
    expect(result).toMatchObject({ outcome: 'refused', detail: 'session exposes excluded tools: WebFetch' });
    expect(seen.abortedAtStart).toBe(true);
    expect(db.events[0]?.payload).toMatchObject({ refusal: 'session exposes excluded tools: WebFetch' });
  });

  it('records the spend of a session on the wrong account as the founder\'s, never the pool\'s', async () => {
    const db = new FakeDb();
    const modelUsage = [{ model: 'builder-class', input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null }];
    const { result, alert } = await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent(undefined, 'none'));
      },
      {},
      {},
      { mode: 'unattended', modelUsage },
    );
    expect(result.outcome).toBe('refused');
    expect(db.ledger).toEqual([expect.objectContaining({ billed_to: 'founder', usd: 0.0045 })]);
    expect(db.pool).toMatchObject({ balance_usd: 50, daily_spent_usd: 0 });
    expect(alert.messages).toEqual([expect.stringContaining('the init line reported apiKeySource none')]);

    const attended = await run(
      new FakeDb(),
      async (_spec, emit) => {
        await emit(startEvent(undefined, 'ANTHROPIC_API_KEY'));
      },
      {},
      {},
      { modelUsage },
    );
    expect(attended.alert.messages).toEqual([expect.stringContaining('the init line reported apiKeySource ANTHROPIC_API_KEY')]);
  });

  it('refuses an unattended session that bills anything but the studio key', async () => {
    const db = new FakeDb();
    const { result } = await run(
      db,
      async (_spec, emit) => {
        await emit(startEvent(undefined, 'none'));
        await emit(usageEvent(1, 10));
      },
      {},
      {},
      { mode: 'unattended' },
    );
    expect(result).toMatchObject({ outcome: 'refused', detail: 'session is billed to the wrong account (none)' });
    expect(db.ledger).toHaveLength(0);

    const unreported = await run(
      new FakeDb(),
      async (_spec, emit) => {
        await emit(startEvent(undefined, null));
      },
      {},
      {},
      { mode: 'unattended' },
    );
    expect(unreported.result).toMatchObject({ outcome: 'refused', detail: 'session is billed to the wrong account (unreported)' });
  });

  it('refuses before starting when the role names an excluded tool', async () => {
    const db = new FakeDb();
    const adapter = new FakeAdapter(async () => undefined);
    const c = card();
    db.cards = [c];
    const result = await runAgentSession(c, role({ tools_json: ['Read', 'Task'] }), '/worktree', db.studio, deps(db, adapter));
    expect(result).toMatchObject({ outcome: 'refused', turns: 0 });
    expect(adapter.specs).toHaveLength(0);
  });

  it('does not start when the card has already reached its ceiling', async () => {
    const db = new FakeDb();
    const { result, adapter } = await run(db, async () => undefined, {}, { actual_usd: 3 });
    expect(result).toMatchObject({ outcome: 'ceiling', turns: 0 });
    expect(adapter.specs).toHaveLength(0);
  });
});

describe('runAgentSession watch', () => {
  it('aborts when the board session lapses', async () => {
    const db = new FakeDb();
    db.boardActive = false;
    const { result } = await run(db, async (_spec, emit, signal) => {
      await emit(startEvent());
      await untilAborted(signal, 2000);
    }, { watchIntervalMs: 5 });
    expect(result).toMatchObject({ outcome: 'board_session_lapsed' });
  });

  it('lets an unattended session run on when no board member is signed in', async () => {
    const db = new FakeDb();
    db.boardActive = false;
    const { result } = await run(
      db,
      async (_spec, emit, signal) => {
        await emit(startEvent(undefined, 'ANTHROPIC_API_KEY'));
        // Long enough for the watch to fire several times at the 5 ms interval below.
        await untilAborted(signal, 50);
        await emit(usageEvent(1, 100));
      },
      { watchIntervalMs: 5 },
      {},
      { mode: 'unattended' },
    );
    expect(result).toEqual({ outcome: 'completed', detail: 'session completed in 1 turns', turns: 1 });
    expect(db.ledger).toHaveLength(1);
    expect(db.events[0]?.payload).toMatchObject({ mode: 'unattended', api_key_source: 'ANTHROPIC_API_KEY' });
  });

  it('aborts when the board pauses the studio', async () => {
    const db = new FakeDb();
    db.studio.paused = true;
    const { result } = await run(db, async (_spec, emit, signal) => {
      await emit(startEvent());
      await untilAborted(signal, 2000);
    }, { watchIntervalMs: 5 });
    expect(result).toMatchObject({ outcome: 'paused_by_board' });
  });

  it('aborts when the dispatcher stops', async () => {
    const db = new FakeDb();
    const stop = new AbortController();
    const { result } = await run(db, async (_spec, emit, signal) => {
      await emit(startEvent());
      stop.abort('dispatcher stopping');
      await untilAborted(signal, 2000);
    }, { stopSignal: stop.signal });
    expect(result).toMatchObject({ outcome: 'stopped', detail: 'dispatcher stopping' });
  });

  it('passes the budget remaining under the ceiling and the fallback model to the adapter', async () => {
    const db = new FakeDb();
    db.cards = [card({ actual_usd: 1 })];
    const adapter = new FakeAdapter(async (_spec, emit) => {
      await emit(startEvent());
    });
    await runAgentSession(db.cards[0]!, role({ model: '' }), '/worktree', db.studio, deps(db, adapter));
    expect(adapter.specs[0]).toMatchObject({ maxBudgetUsd: 2, model: 'builder-class', maxTurns: 60, worktree: '/worktree', folder: 'seed-1' });
  });
});
