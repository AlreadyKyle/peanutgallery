import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { ceilingUsd, runAgentSession, sessionPrompt, type SessionDeps } from '../src/session.js';
import { FakeAdapter, startEvent, untilAborted, usageEvent, type FakeOptions, type FakeScript } from './helpers/fake-adapter.js';
import { FakeDb, NOW, card, role } from './helpers/fake-db.js';

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
  const result = await runAgentSession(c, role(), '/worktree', db.studio, deps(db, adapter, overrides));
  return { result, adapter };
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
    expect(prompt).not.toMatch(/board|note|community/i);
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
    const { result } = await run(db, async (_spec, emit) => {
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
    expect(db.ledger[0]).toMatchObject({ card_id: card().id, role_id: 'role-builder-a', model: 'builder-class', input_tokens: 1000, cached_tokens: 0, output_tokens: 100 });
    expect(db.cards[0]?.actual_usd).toBe(0.0105);
    expect(db.pool.balance_usd).toBe(49.9895);
    expect(db.events.map((event) => event.type)).toEqual(['start', 'message', 'tool_call', 'tool_result']);
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

  it('aborts on an unknown model without a ledger row', async () => {
    const db = new FakeDb();
    const { result } = await run(db, async (_spec, emit) => {
      await emit(startEvent());
      await emit(usageEvent(1, 10, 'mystery-model'));
    });
    expect(result).toMatchObject({ outcome: 'unknown_model', detail: 'no price for model mystery-model' });
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
    expect(db.events[0]?.payload).toMatchObject({ mode: 'attended', api_key_source: 'ANTHROPIC_API_KEY' });
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
