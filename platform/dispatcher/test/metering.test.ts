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

type TurnEvent = Extract<AgentEvent, { type: 'turn_usage' }>;

function turnsOf(events: readonly AgentEvent[]): TurnEvent[] {
  return events.filter((event): event is TurnEvent => event.type === 'turn_usage');
}

function endOf(events: readonly AgentEvent[]): EndEvent | null {
  return events.find((event): event is EndEvent => event.type === 'end') ?? null;
}

// What the ledger ends up holding: record_usage rounds each row to four decimals.
function ledgerTotal(rows: readonly LedgerUsage[]): number {
  return round4(rows.reduce((total, row) => total + round4(row.usd), 0));
}

// Meters a parsed stream the way a session does: one row per turn, then the settle rows.
function meter(table: PriceTable, events: readonly AgentEvent[]) {
  const sessionMeter = new SessionMeter(table);
  const turnRows = turnsOf(events).map((turn) => sessionMeter.addTurn(turn).row);
  const settled = sessionMeter.settle(endOf(events));
  return { turnRows, settled, rows: [...turnRows, ...settled.rows] };
}

// The modelUsage block of a result line priced with our table: one-hour cache writes wherever the
// split does not say otherwise.
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

// ceil(characters / 3) over every text, thinking and tool input block of the assistant lines.
function expectedOutputTokens(lines: readonly string[]): number {
  let chars = 0;
  for (const line of lines) {
    const parsed = JSON.parse(line) as { type: string; message?: { content?: Array<Record<string, unknown>> } };
    if (parsed.type !== 'assistant') continue;
    for (const block of parsed.message?.content ?? []) {
      if (block.type === 'text') chars += String(block.text).length;
      if (block.type === 'thinking') chars += String(block.thinking).length;
      if (block.type === 'tool_use') chars += JSON.stringify(block.input).length;
    }
  }
  return Math.ceil(chars / 3);
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
      overcountUsd: 0,
    });
    expect(ledgerTotal(rows)).toBe(0.0343);
    expect(end.totalCostUsd).toBe(0.05404125);
  });

  it('estimates the output the stream did not report when the result line is missing', () => {
    const withoutResult = probeLines.filter((line) => !line.startsWith('{"type":"result"'));
    const cut = parseStream(withoutResult.join('\n'));
    const { turnRows, settled } = meter(LIVE, cut);
    const reported = turnRows.reduce((total, row) => total + row.output_tokens, 0);
    const shortfall = Math.max(0, expectedOutputTokens(withoutResult) - reported);
    expect(settled.basis).toBe('estimate');
    const expectedRows = round4((shortfall * LIVE_SONNET.output) / 1e6) > 0 ? [{ model: 'claude-sonnet-5', input_tokens: 0, cached_tokens: 0, output_tokens: shortfall, usd: round4((shortfall * LIVE_SONNET.output) / 1e6) }] : [];
    expect(settled.rows).toEqual(expectedRows);
    if (pinned) expect(settled.rows).toEqual([{ model: 'claude-sonnet-5', input_tokens: 0, cached_tokens: 0, output_tokens: 10, usd: 0.0001 }]);
  });

  it('counts the estimated shortfall in the live estimate for the ceiling check', () => {
    const sessionMeter = new SessionMeter(LIVE);
    const [turn] = turnsOf(events);
    const row = sessionMeter.addTurn({ ...turn!, contentChars: 3000 }).row;
    // 1000 expected output tokens, 2 reported: 998 × $10 per million on top of the recorded row.
    expect(sessionMeter.liveEstimateUsd()).toBeCloseTo(row.usd + 0.00998, 8);
  });

  it('prices a model missing from the table at the fallback rates and names it', () => {
    const table2 = parsePriceTable(JSON.stringify({ 'claude-sonnet-5': LIVE_SONNET, 'test-class': { ...LIVE_SONNET, output: 20 } }));
    const withExtra = probeLines.map((line) =>
      line.startsWith('{"type":"result"')
        ? line.replace('"modelUsage":{', '"modelUsage":{"mystery-model":{"inputTokens":1000,"outputTokens":500,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"costUSD":0.01},')
        : line,
    );
    const { settled } = meter(table2, parseStream(withExtra.join('\n')));
    expect(settled.fallbackModels).toEqual(['mystery-model']);
    // Fallback rates are the highest of each: input 2, output 20. 1000 × 2 + 500 × 20 = $0.012.
    expect(settled.rows.find((row) => row.model === 'mystery-model')).toEqual({ model: 'mystery-model', input_tokens: 1000, cached_tokens: 0, output_tokens: 500, usd: 0.012 });
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

  it('prices an unknown turn at the fallback rates and says so', () => {
    const sessionMeter = new SessionMeter(LIVE);
    const turn = sessionMeter.addTurn({ model: 'mystery-model', usage: usage(100), contentChars: 0 });
    expect(turn).toEqual({ fallback: true, row: { model: 'mystery-model', input_tokens: 1000, cached_tokens: 0, output_tokens: 100, usd: 0.003 } });
    expect(sessionMeter.settle(null).fallbackModels).toEqual(['mystery-model']);
  });

  it('puts a negative difference into overcountUsd and writes no row for it', () => {
    const sessionMeter = new SessionMeter(LIVE);
    sessionMeter.addTurn({ model: 'claude-sonnet-5', usage: usage(1000), contentChars: 0 });
    const settled = sessionMeter.settle(
      end([{ model: 'claude-sonnet-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: null }]),
    );
    // Recorded 0.002 + 0.01 = 0.012; the result line says 0.002 + 0.005 = 0.007.
    expect(settled).toEqual({ basis: 'result', rows: [], fallbackModels: [], overcountUsd: 0.005 });
  });

  it('counts cache writes beyond what the turns recorded at the one-hour rate unless the one-model result split says otherwise', () => {
    const modelUsage = [{ model: 'claude-sonnet-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 10_000, cost_usd: null }];
    const turnSplit = new SessionMeter(LIVE);
    turnSplit.addTurn({ model: 'claude-sonnet-5', usage: usage(0, { input_tokens: 0, cache_creation_input_tokens: 4000, cache_creation_1h_input_tokens: 0 }), contentChars: 0 });
    // 4000 five-minute tokens recorded at $0.01; 6000 more at the one-hour rate is $0.024.
    expect(turnSplit.settle(end(modelUsage)).rows).toEqual([{ model: 'claude-sonnet-5', input_tokens: 6000, cached_tokens: 0, output_tokens: 0, usd: 0.024 }]);

    const resultSplit = new SessionMeter(LIVE);
    resultSplit.addTurn({ model: 'claude-sonnet-5', usage: usage(0, { input_tokens: 0, cache_creation_input_tokens: 4000, cache_creation_1h_input_tokens: 0 }), contentChars: 0 });
    const endUsage = usage(0, { input_tokens: 0, cache_creation_input_tokens: 10_000, cache_creation_1h_input_tokens: 0 });
    // The result line puts all 10000 at five minutes: $0.025 in all, $0.015 still to record.
    expect(resultSplit.settle(end(modelUsage, endUsage)).rows).toEqual([{ model: 'claude-sonnet-5', input_tokens: 6000, cached_tokens: 0, output_tokens: 0, usd: 0.015 }]);
  });

  it('omits zero rows from an estimate and writes nothing for a session that reported nothing', () => {
    expect(new SessionMeter(LIVE).settle(null)).toEqual({ basis: 'estimate', rows: [], fallbackModels: [], overcountUsd: 0 });
    const sessionMeter = new SessionMeter(LIVE);
    sessionMeter.addTurn({ model: 'claude-sonnet-5', usage: usage(10), contentChars: 30 });
    expect(sessionMeter.settle(end([]))).toEqual({ basis: 'estimate', rows: [], fallbackModels: [], overcountUsd: 0 });
  });
});
