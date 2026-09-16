import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStream } from '../src/adapters/stream.js';
import type { AgentEvent, EndEvent } from '../src/adapters/types.js';
import { SessionMeter } from '../src/metering.js';
import { parsePriceTable, priceUsage, round4, type LedgerUsage, type PriceTable, type TurnUsage } from '../src/pricing.js';

// The claude-sonnet-5 row of the live PRICE_TABLE_JSON on 2026-09-16, USD per million tokens.
const LIVE_SONNET = { input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4 };
const LIVE: PriceTable = parsePriceTable(JSON.stringify({ 'claude-sonnet-5': LIVE_SONNET }));
const PINNED_SESSION = 'c8f7d2e6-bad7-4361-b2f5-4ece9bc3c0d1';

const probe = readFileSync(new URL('./fixtures/probe.jsonl', import.meta.url), 'utf8');
const probeLines = probe.split('\n').filter((line) => line.length > 0);
const pinned = probe.includes(`"session_id":"${PINNED_SESSION}"`);
const isResult = (line: string) => line.startsWith('{"type":"result"');

type TurnEvent = Extract<AgentEvent, { type: 'turn_usage' }>;

function turnsOf(events: readonly AgentEvent[]): TurnEvent[] {
  return events.filter((event): event is TurnEvent => event.type === 'turn_usage');
}

function endOf(events: readonly AgentEvent[]): EndEvent | null {
  return events.find((event): event is EndEvent => event.type === 'end') ?? null;
}

function ledgerTotal(rows: readonly LedgerUsage[]): number {
  return round4(rows.reduce((total, row) => total + row.usd, 0));
}

// Meters a parsed stream the way a session does: each turn row written and committed as it arrives,
// then the settle rows.
function meter(table: PriceTable, events: readonly AgentEvent[]) {
  const sessionMeter = new SessionMeter(table);
  const turnRows = turnsOf(events).map((turn) => {
    const { row } = sessionMeter.addTurn(turn);
    sessionMeter.commit(row);
    return row;
  });
  const settled = sessionMeter.settle(endOf(events));
  return { turnRows, settled, rows: [...turnRows, ...settled.rows] };
}

// The result line's modelUsage priced with our table, one-hour cache writes wherever the result line
// does not say otherwise.
function pricedModelUsage(table: PriceTable, end: EndEvent): number {
  return round4(
    end.modelUsage.reduce((total, model) => {
      const usage: TurnUsage = {
        input_tokens: model.input_tokens,
        cache_creation_input_tokens: model.cache_creation_input_tokens,
        cache_creation_1h_input_tokens: end.modelUsage.length === 1 && end.usage ? end.usage.cache_creation_1h_input_tokens : model.cache_creation_input_tokens,
        cache_read_input_tokens: model.cache_read_input_tokens,
        output_tokens: model.output_tokens,
      };
      return total + round4(priceUsage(table, model.model, usage).usd);
    }, 0),
  );
}

function withResult(transform: (line: string) => string): AgentEvent[] {
  return parseStream(probeLines.map((line) => (isResult(line) ? transform(line) : line)).join('\n'));
}

describe('SessionMeter on the recorded probe', () => {
  const events = parseStream(probe);
  const end = endOf(events)!;
  const models = Object.fromEntries(end.modelUsage.map((model) => [model.model, LIVE_SONNET]));
  const table = parsePriceTable(JSON.stringify({ ...models, 'claude-sonnet-5': LIVE_SONNET }));

  it('settles to the modelUsage priced with our table, never below the per-turn rows', () => {
    const { turnRows, settled, rows } = meter(table, events);
    expect(settled.basis).toBe('result');
    expect(settled.fallbackModels).toEqual([]);
    expect(settled.mismatch).toBe(false);
    expect(ledgerTotal(rows)).toBe(pricedModelUsage(table, end));
    expect(ledgerTotal(rows)).toBeGreaterThanOrEqual(ledgerTotal(turnRows));
  });

  it.skipIf(!pinned)('records $0.0338 for the turn and $0.0005 for 47 unreported output tokens: $0.0343, not the CLI total', () => {
    const { turnRows, settled, rows } = meter(LIVE, events);
    expect(turnRows).toEqual([{ model: 'claude-sonnet-5', input_tokens: 8451, cached_tokens: 0, output_tokens: 2, usd: 0.0338 }]);
    expect(settled).toEqual({
      basis: 'result',
      rows: [{ model: 'claude-sonnet-5', input_tokens: 0, cached_tokens: 0, output_tokens: 47, usd: 0.0005 }],
      fallbackModels: [],
      turnModels: ['claude-sonnet-5'],
      overcountUsd: 0,
      mismatch: false,
      anomaly: false,
    });
    expect(ledgerTotal(rows)).toBe(0.0343);
    expect(end.totalCostUsd).toBe(0.05404125);
  });

  it('writes a turn row whose write failed again at settle, so the ledger is not a turn short', () => {
    const sessionMeter = new SessionMeter(LIVE);
    const [turn] = turnsOf(events);
    const { row } = sessionMeter.addTurn(turn!);
    const settled = sessionMeter.settle(end);
    expect(settled.rows[0]).toBe(row);
    expect(ledgerTotal(settled.rows)).toBe(pricedModelUsage(LIVE, end));
  });

  it('settles without the result line on an estimate that is not below what the session really spent', () => {
    const cut = parseStream(probeLines.filter((line) => !isResult(line)).join('\n'));
    const { settled, rows } = meter(LIVE, cut);
    expect(settled.basis).toBe('estimate');
    // The real result line: 49 output tokens, 47 of them unreported, and $0.0343 at our table.
    const unreported = settled.rows.reduce((total, row) => total + row.output_tokens, 0);
    expect(unreported).toBeGreaterThanOrEqual(end.usage!.output_tokens - turnsOf(cut).reduce((total, turn) => total + turn.usage.output_tokens, 0));
    expect(ledgerTotal(rows)).toBeGreaterThanOrEqual(pricedModelUsage(LIVE, end));
    // The turn had a thinking block: 1,024 output tokens, and one request in flight with the 8449
    // cached tokens read again, 2 input and 1,024 output.
    if (pinned) expect(settled.rows).toEqual([{ model: 'claude-sonnet-5', input_tokens: 2, cached_tokens: 8449, output_tokens: 2046, usd: 0.0222 }]);
  });

  it('checks the ceiling against the same estimate while the session runs', () => {
    const [turn] = turnsOf(events);
    const thinking = new SessionMeter(LIVE);
    thinking.addTurn({ ...turn!, contentChars: 3000, thinking: true });
    // 1,024 output tokens for the turn and 1,024 in flight, the cache read again and 2 more input.
    expect(thinking.liveEstimateUsd()).toBe(0.055974);
    const plain = new SessionMeter(LIVE);
    plain.addTurn({ ...turn!, contentChars: 3000, thinking: false });
    // 3000 characters is 1,000 tokens.
    expect(plain.liveEstimateUsd()).toBe(0.055734);
  });

  it('prices a side model missing from the table at the fallback rates and names it', () => {
    const table2 = parsePriceTable(JSON.stringify({ 'claude-sonnet-5': LIVE_SONNET, 'test-class': { ...LIVE_SONNET, output: 20 } }));
    const withExtra = withResult((line) =>
      line.replace('"modelUsage":{', '"modelUsage":{"mystery-model":{"inputTokens":1000,"outputTokens":500,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"costUSD":0.01},'),
    );
    const { settled } = meter(table2, withExtra);
    expect(settled).toMatchObject({ fallbackModels: ['mystery-model'], turnModels: ['claude-sonnet-5'], mismatch: false, basis: 'result' });
    // Fallback rates are the highest of each: input 2, output 20. 1000 × 2 + 500 × 20 = $0.012.
    expect(settled.rows.find((row) => row.model === 'mystery-model')).toEqual({ model: 'mystery-model', input_tokens: 1000, cached_tokens: 0, output_tokens: 500, usd: 0.012 });
  });

  it('reconciles a renamed modelUsage key on the total under the turn model, writing nothing twice', () => {
    const renamed = withResult((line) => line.replace('"modelUsage":{"claude-sonnet-5":', '"modelUsage":{"claude-sonnet-5-20260801":'));
    const { settled, rows } = meter(LIVE, renamed);
    expect(settled).toMatchObject({ basis: 'result', mismatch: true, fallbackModels: [], turnModels: ['claude-sonnet-5'] });
    expect(settled.rows.map((row) => row.model)).toEqual(['claude-sonnet-5']);
    expect(ledgerTotal(rows)).toBe(pricedModelUsage(LIVE, end));
  });

  it('settles a result line that reports fewer tokens than the turns on the estimate', () => {
    const zeroed = withResult((line) =>
      line.replace(/"claude-sonnet-5":\{"inputTokens":\d+,"outputTokens":\d+,"cacheReadInputTokens":\d+,"cacheCreationInputTokens":\d+/, '"claude-sonnet-5":{"inputTokens":0,"outputTokens":0,"cacheReadInputTokens":0,"cacheCreationInputTokens":0'),
    );
    expect(endOf(zeroed)?.modelUsage[0]).toMatchObject({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0 });
    const { settled, rows } = meter(LIVE, zeroed);
    expect(settled).toMatchObject({ basis: 'estimate', anomaly: true, overcountUsd: 0 });
    // Every class at the turns' count, and the thinking turn's output at 1,024 tokens.
    expect(settled.rows).toEqual([{ model: 'claude-sonnet-5', input_tokens: 0, cached_tokens: 0, output_tokens: 1022, usd: 0.0102 }]);
    expect(ledgerTotal(rows)).toBeGreaterThanOrEqual(pricedModelUsage(LIVE, end));
  });
});

describe('SessionMeter', () => {
  const usage = (output: number, extra: Partial<TurnUsage> = {}): TurnUsage => ({
    input_tokens: 1000,
    cache_creation_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: output,
    ...extra,
  });
  const end = (modelUsage: EndEvent['modelUsage'], endUsage: TurnUsage | null = null): EndEvent => ({
    type: 'end',
    subtype: 'success',
    isError: false,
    totalCostUsd: null,
    numTurns: 1,
    result: '',
    usage: endUsage,
    modelUsage,
    permissionDenials: [],
  });
  const reported = (model: string, input: number, output: number) => ({ model, input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null });
  const committed = (sessionMeter: SessionMeter, model: string, turnUsage: TurnUsage, contentChars = 0, thinking = false) => {
    const { row } = sessionMeter.addTurn({ model, usage: turnUsage, contentChars, thinking });
    sessionMeter.commit(row);
    return row;
  };

  it('prices an unknown turn at the fallback rates and says so', () => {
    const sessionMeter = new SessionMeter(LIVE);
    const turn = sessionMeter.addTurn({ model: 'mystery-model', usage: usage(100), contentChars: 0, thinking: false });
    expect(turn).toEqual({ fallback: true, row: { model: 'mystery-model', input_tokens: 1000, cached_tokens: 0, output_tokens: 100, usd: 0.003 } });
    expect(sessionMeter.settle(null)).toMatchObject({ fallbackModels: ['mystery-model'], turnModels: ['mystery-model'] });
  });

  it('puts a rounding overcount into overcountUsd and writes no row for it', () => {
    const sessionMeter = new SessionMeter(LIVE);
    // Each turn is $0.00006, recorded as $0.0001; the three together are $0.0002.
    for (let turn = 0; turn < 3; turn += 1) committed(sessionMeter, 'claude-sonnet-5', usage(6, { input_tokens: 0 }));
    const settled = sessionMeter.settle(end([reported('claude-sonnet-5', 0, 18)]));
    expect(settled).toMatchObject({ basis: 'result', rows: [], overcountUsd: 0.0001, anomaly: false });
  });

  it('counts cache writes beyond what the turns recorded at the one-hour rate unless the one-model result split says otherwise', () => {
    const modelUsage = [{ model: 'claude-sonnet-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 10_000, cost_usd: null }];
    const turn = usage(0, { input_tokens: 0, cache_creation_input_tokens: 4000, cache_creation_1h_input_tokens: 0 });
    const turnSplit = new SessionMeter(LIVE);
    committed(turnSplit, 'claude-sonnet-5', turn);
    // 4000 five-minute tokens recorded at $0.01; 6000 more at the one-hour rate is $0.024.
    expect(turnSplit.settle(end(modelUsage)).rows).toEqual([{ model: 'claude-sonnet-5', input_tokens: 6000, cached_tokens: 0, output_tokens: 0, usd: 0.024 }]);

    const resultSplit = new SessionMeter(LIVE);
    committed(resultSplit, 'claude-sonnet-5', turn);
    const endUsage = usage(0, { input_tokens: 0, cache_creation_input_tokens: 10_000, cache_creation_1h_input_tokens: 0 });
    // The result line puts all 10000 at five minutes: $0.025 in all, $0.015 still to record.
    expect(resultSplit.settle(end(modelUsage, endUsage)).rows).toEqual([{ model: 'claude-sonnet-5', input_tokens: 6000, cached_tokens: 0, output_tokens: 0, usd: 0.015 }]);
  });

  it('estimates a turn model the result line leaves out, and names the mismatch', () => {
    const table = parsePriceTable(JSON.stringify({ 'claude-sonnet-5': LIVE_SONNET, 'test-class': { ...LIVE_SONNET, output: 20 } }));
    const sessionMeter = new SessionMeter(table);
    committed(sessionMeter, 'claude-sonnet-5', usage(100));
    committed(sessionMeter, 'test-class', usage(10, { input_tokens: 0 }), 3000);
    const settled = sessionMeter.settle(end([reported('claude-sonnet-5', 1000, 100)]));
    // 3000 characters is 1,000 output tokens; 10 were recorded, so 990 at $20 per million.
    expect(settled).toEqual({
      basis: 'estimate',
      rows: [{ model: 'test-class', input_tokens: 0, cached_tokens: 0, output_tokens: 990, usd: 0.0198 }],
      fallbackModels: [],
      turnModels: ['claude-sonnet-5', 'test-class'],
      overcountUsd: 0,
      mismatch: true,
      anomaly: false,
    });
  });

  it('adds the characters of a late line to the estimate', () => {
    const quiet = new SessionMeter(LIVE);
    committed(quiet, 'claude-sonnet-5', usage(10, { input_tokens: 0 }));
    const late = new SessionMeter(LIVE);
    committed(late, 'claude-sonnet-5', usage(10, { input_tokens: 0 }));
    late.addContent({ model: 'claude-sonnet-5', contentChars: 3000, thinking: false });
    // 1,024 in flight either way; the late line adds 1,000 more.
    expect(quiet.settle(null).rows.map((row) => row.output_tokens)).toEqual([1024]);
    expect(late.settle(null).rows.map((row) => row.output_tokens)).toEqual([2024]);
  });

  it('writes nothing for a session that reported nothing, or whose estimate equals what was recorded', () => {
    expect(new SessionMeter(LIVE).settle(null)).toEqual({ basis: 'estimate', rows: [], fallbackModels: [], turnModels: [], overcountUsd: 0, mismatch: false, anomaly: false });
    const sessionMeter = new SessionMeter(LIVE);
    committed(sessionMeter, 'claude-sonnet-5', usage(10), 30);
    // A result line with no modelUsage: no request was in flight, and 30 characters is the 10 tokens reported.
    expect(sessionMeter.settle(end([]))).toMatchObject({ basis: 'estimate', rows: [], overcountUsd: 0 });
  });
});
