// The credit probe (docs/specs/unattended-roles.md, PR3): one output token on the cheapest priced model,
// its usage an overhead ledger row, and a refusal classified as the sessions classify one.
import { describe, expect, it } from 'vitest';
import { cheapestModel, probeCredit, type ProbeMessagesClient } from '../src/credit-probe.js';
import type { PriceTable } from '../src/pricing.js';
import { FakeDb } from './helpers/fake-db.js';

const TABLE: PriceTable = {
  'model-large': { input: 15, output: 75, cache_read: 1.5, cache_write_5m: 18.75, cache_write_1h: 30 },
  'model-small': { input: 1, output: 5, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 },
  'model-mid': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 },
};

function client(answer: () => Promise<{ id: string; usage: unknown }>): ProbeMessagesClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async create(params) {
      calls.push(params);
      return answer();
    },
  };
}

describe('credit probe', () => {
  it('picks the model with the lowest input plus output rate', () => {
    expect(cheapestModel(TABLE)).toBe('model-small');
    expect(cheapestModel({ b: TABLE['model-small']!, a: TABLE['model-small']! })).toBe('a');
    expect(() => cheapestModel({})).toThrow('lists no models');
  });

  it('asks for one output token on the cheapest model and records the usage as an overhead row, once per message id', async () => {
    const db = new FakeDb();
    // A large input so the row is above the ledger's four decimals.
    const c = client(async () => ({ id: 'msg_01', usage: { input_tokens: 10_000, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null, service_tier: 'standard' } }));
    expect(await probeCredit({ client: c, db, priceTable: TABLE })).toEqual({ outcome: 'ok', model: 'model-small', usd: 0.01 });
    expect(c.calls).toEqual([{ model: 'model-small', max_tokens: 1, messages: [{ role: 'user', content: 'Reply with one word.' }] }]);
    expect(db.ledger).toEqual([
      { id: 'ledger-1', billed_to: 'overhead', card_id: null, role_id: null, model: 'model-small', input_tokens: 10_000, cached_tokens: 0, output_tokens: 1, usd: 0.01, request_id: 'credit-probe/msg_01' },
    ]);
    // Overhead is never taken from the pool.
    expect(db.pool.balance_usd).toBe(50);
    await probeCredit({ client: c, db, priceTable: TABLE });
    expect(db.ledger).toHaveLength(1);
  });

  it('classifies a credit refusal, a tier cap and any other error', async () => {
    const db = new FakeDb();
    const refuse = (message: string) => client(async () => { throw new Error(message); });
    expect(await probeCredit({ client: refuse('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), db, priceTable: TABLE })).toMatchObject({ outcome: 'credit', model: 'model-small' });
    expect(await probeCredit({ client: refuse('429 {"type":"error","error":{"type":"rate_limit_error","message":"You have reached your API usage limits."}}'), db, priceTable: TABLE })).toMatchObject({ outcome: 'tier_cap' });
    expect(await probeCredit({ client: refuse('Connection error.'), db, priceTable: TABLE })).toEqual({ outcome: 'error', model: 'model-small', detail: 'Connection error.' });
    expect(db.ledger).toEqual([]);
  });

  it('is an error, not ok, when the answer has no usage or the ledger refuses the row', async () => {
    const db = new FakeDb();
    expect(await probeCredit({ client: client(async () => ({ id: 'msg_02', usage: null })), db, priceTable: TABLE })).toMatchObject({ outcome: 'error', detail: 'the probe answer msg_02 carried no usage' });
    db.recordUsage = async () => {
      throw new Error('record_usage down');
    };
    expect(await probeCredit({ client: client(async () => ({ id: 'msg_03', usage: { input_tokens: 8, output_tokens: 1 } })), db, priceTable: TABLE })).toMatchObject({
      outcome: 'error',
      detail: "the probe's usage could not be recorded: record_usage down",
    });
  });
});
