import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LIST_COST_ROUNDING_USD, ManagedMeter, listCostUsd, type ManagedBilling, type RequestUsage } from '../src/adapters/managed-meter.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable, priceUsage, round4 } from '../src/pricing.js';
import { FakeDb, card } from './helpers/fake-db.js';

const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
const TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const SESSION = 'sesn_meter';
const STUDIO: ManagedBilling = { billed_to: 'studio', card_id: card().id, role_id: 'role-builder-a' };

// The three model requests of the doc-derived session fixture.
const REQUESTS = (JSON.parse(readFileSync(new URL('./fixtures/managed-session.json', import.meta.url), 'utf8')) as Array<{ type: string; id: string; model_usage?: RequestUsage }>).filter(
  (event): event is { type: string; id: string; model_usage: RequestUsage } => event.type === 'span.model_request_end',
);

function meterFor(db: FakeDb, billing: ManagedBilling = STUDIO, sessionId = SESSION) {
  return new ManagedMeter({ table: TABLE, model: 'builder-class', sessionId, billing, record: (input) => db.recordUsage(input), log: silent, retryMs: 1 });
}

function priced(usage: RequestUsage): number {
  return round4(priceUsage(TABLE, 'builder-class', { ...usage, cache_creation_1h_input_tokens: 0 }).usd);
}

async function meterAll(meter: ManagedMeter): Promise<number> {
  let total = 0;
  for (const event of REQUESTS) {
    await meter.request(event.id, event.model_usage);
    total = round4(total + priced(event.model_usage));
  }
  return total;
}

describe('ManagedMeter', () => {
  it('writes one row per model request under its event id, cache writes at the five-minute rate', async () => {
    const db = new FakeDb();
    db.cards = [card({ stage: 'building' })];
    const meter = meterFor(db);
    const total = await meterAll(meter);
    expect(db.ledger.map((row) => row.request_id)).toEqual(['sevt_req_end_1', 'sevt_req_end_2', 'sevt_req_end_3']);
    expect(db.ledger[1]).toMatchObject({ billed_to: 'studio', card_id: STUDIO.card_id, role_id: 'role-builder-a', model: 'builder-class', input_tokens: 412 + 1024, cached_tokens: 10227, output_tokens: 188 });
    expect(db.ledger[1]!.usd).toBe(round4((412 * 3 + 1024 * 3.75 + 10227 * 0.3 + 188 * 15) / 1_000_000));
    expect(meter.recordedUsd()).toBe(total);
    expect(db.pool.balance_usd).toBe(round4(50 - total));
  });

  it('writes a runtime row and a settle row that bring the session to its list cost', async () => {
    const db = new FakeDb();
    db.cards = [card({ stage: 'building' })];
    const meter = meterFor(db);
    const total = await meterAll(meter);
    const report = await meter.finish({ listCost: { amount: '12', currency: 'USD' }, activeSeconds: 900 });
    expect(report).toMatchObject({ settled: true, listCostUsd: 0.12, runtimeUsd: 0.02, overcountUsd: 0 });
    expect(db.ledger.slice(3)).toEqual([
      expect.objectContaining({ request_id: `${SESSION}/runtime`, model: 'managed-runtime', usd: 0.02, input_tokens: 0, output_tokens: 0 }),
      expect.objectContaining({ request_id: `${SESSION}/settle`, model: 'builder-class', usd: round4(0.12 - total - 0.02) }),
    ]);
    expect(round4(db.ledger.reduce((sum, row) => sum + row.usd, 0))).toBe(0.12);
  });

  it('covers a model request the stream never delivered with the settle row', async () => {
    const db = new FakeDb();
    const meter = meterFor(db);
    await meter.request(REQUESTS[0]!.id, REQUESTS[0]!.model_usage);
    const report = await meter.finish({ listCost: { amount: '5', currency: 'USD' }, activeSeconds: 0 });
    expect(report.settleUsd).toBe(round4(0.05 - priced(REQUESTS[0]!.model_usage)));
    expect(round4(db.ledger.reduce((sum, row) => sum + row.usd, 0))).toBe(0.05);
  });

  it('writes no row and reports an overcount when the rows exceed the list cost by more than its rounding', async () => {
    const db = new FakeDb();
    const meter = meterFor(db);
    const total = await meterAll(meter);
    const listCents = Math.floor((total - LIST_COST_ROUNDING_USD) * 100) - 1;
    const report = await meter.finish({ listCost: { amount: String(listCents), currency: 'USD' }, activeSeconds: 0 });
    expect(report.settled).toBe(true);
    expect(report.overcountUsd).toBe(round4(total - listCents / 100));
    expect(report.problems.join(' ')).toMatch(/above the session's list cost/);
    expect(db.ledger.map((row) => row.request_id)).not.toContain(`${SESSION}/settle`);
  });

  it('writes nothing twice when a restarted dispatcher meters the same session again', async () => {
    const db = new FakeDb();
    // The first process metered two requests and stopped before the session went idle.
    const first = meterFor(db);
    await first.request(REQUESTS[0]!.id, REQUESTS[0]!.model_usage);
    await first.request(REQUESTS[1]!.id, REQUESTS[1]!.model_usage);
    // Recovery meters the whole history and settles; a later recovery (the archive failed) does it again.
    for (let run = 0; run < 2; run += 1) {
      const again = meterFor(db);
      await meterAll(again);
      await again.finish({ listCost: { amount: '12', currency: 'USD' }, activeSeconds: 900 });
    }
    expect(db.ledger.map((row) => row.request_id)).toEqual(['sevt_req_end_1', 'sevt_req_end_2', 'sevt_req_end_3', `${SESSION}/runtime`, `${SESSION}/settle`]);
    expect(round4(db.ledger.reduce((sum, row) => sum + row.usd, 0))).toBe(0.12);
  });

  it('settles nothing, and says the session is left for recovery, while a request row is unwritten', async () => {
    class RefusingDb extends FakeDb {
      override async recordUsage(...args: Parameters<FakeDb['recordUsage']>) {
        if (args[0].request_id === 'sevt_req_end_2') throw new Error('db record_usage: connection reset');
        return super.recordUsage(...args);
      }
    }
    const db = new RefusingDb();
    const meter = meterFor(db);
    const results = [];
    for (const event of REQUESTS) results.push((await meter.request(event.id, event.model_usage)).written);
    expect(results).toEqual([true, false, true]);
    const report = await meter.finish({ listCost: { amount: '12', currency: 'USD' }, activeSeconds: 900 });
    expect(report.settled).toBe(false);
    expect(report.unwritten.map((row) => row.request_id)).toEqual(['sevt_req_end_2']);
    expect(db.ledger.map((row) => row.request_id)).toEqual(['sevt_req_end_1', 'sevt_req_end_3']);
  });

  it('bills a probe session as overhead, with no card and no role, and leaves the pool alone', async () => {
    const db = new FakeDb();
    const meter = meterFor(db, { billed_to: 'overhead', card_id: null, role_id: null }, 'sesn_probe');
    await meterAll(meter);
    await meter.finish({ listCost: { amount: '12', currency: 'USD' }, activeSeconds: 60 });
    expect(db.ledger.every((row) => row.billed_to === 'overhead' && row.card_id === null && row.role_id === null)).toBe(true);
    expect(db.ledger.at(-1)?.request_id).toBe('sesn_probe/settle');
    expect(db.pool.balance_usd).toBe(50);
  });

  it('reads list_cost only as whole cents in USD', () => {
    expect(listCostUsd({ amount: '2500', currency: 'USD' })).toBe(25);
    expect(listCostUsd({ amount: '25.00', currency: 'USD' })).toBeNull();
    expect(listCostUsd({ amount: '10', currency: 'EUR' })).toBeNull();
    expect(listCostUsd(null)).toBeNull();
  });
});
