import { describe, expect, it } from 'vitest';
import { UnknownModelError, fallbackPrice, parsePriceTable, priceUsage, round6 } from '../src/pricing.js';

// Rates are USD per million tokens. This table exists only to exercise the arithmetic;
// the live table comes from PRICE_TABLE_JSON.
const TABLE = JSON.stringify({
  'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 },
  'director-class': { input: 15, output: 75, cache_read: 1.5, cache_write_5m: 18.75, cache_write_1h: 30 },
  'host-class': { input: 1, output: 5, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 },
});

describe('parsePriceTable', () => {
  it('parses every model with its five rates', () => {
    const table = parsePriceTable(TABLE);
    expect(Object.keys(table)).toEqual(['builder-class', 'director-class', 'host-class']);
    expect(table['director-class']?.cache_write_1h).toBe(30);
  });

  it('rejects malformed tables', () => {
    expect(() => parsePriceTable('not json')).toThrow('not valid JSON');
    expect(() => parsePriceTable('[]')).toThrow('object keyed by model id');
    expect(() => parsePriceTable('{}')).toThrow('lists no models');
    expect(() => parsePriceTable('{"m":{"input":1}}')).toThrow('m.output must be a non-negative number');
    expect(() => parsePriceTable('{"m":{"input":-1,"output":1,"cache_read":1,"cache_write_5m":1,"cache_write_1h":1}}')).toThrow(
      'm.input',
    );
  });
});

describe('priceUsage', () => {
  const table = parsePriceTable(TABLE);

  it('prices every model in the table and maps tokens to ledger columns', () => {
    const usage = { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 4000, output_tokens: 500 };
    for (const model of Object.keys(table)) {
      const price = table[model]!;
      const row = priceUsage(table, model, usage);
      const expected = round6((1000 * price.input + 2000 * price.cache_write_5m + 4000 * price.cache_read + 500 * price.output) / 1e6);
      expect(row.usd).toBe(expected);
      expect(row.input_tokens).toBe(3000);
      expect(row.cached_tokens).toBe(4000);
      expect(row.output_tokens).toBe(500);
      expect(row.model).toBe(model);
    }
  });

  it('computes the builder-class example exactly', () => {
    const row = priceUsage(table, 'builder-class', {
      input_tokens: 1000,
      cache_creation_input_tokens: 2000,
      cache_creation_1h_input_tokens: 0,
      cache_read_input_tokens: 4000,
      output_tokens: 500,
    });
    // 0.003 + 0.0075 + 0.0012 + 0.0075
    expect(row.usd).toBe(0.0192);
  });

  it('prices the one-hour part of the cache writes at the one-hour rate and the rest at the five-minute rate', () => {
    const row = priceUsage(table, 'builder-class', {
      input_tokens: 1000,
      cache_creation_input_tokens: 2000,
      cache_creation_1h_input_tokens: 500,
      cache_read_input_tokens: 4000,
      output_tokens: 500,
    });
    // 0.003 input + 1500 × 3.75 + 500 × 6 (0.005625 + 0.003) + 0.0012 cache read + 0.0075 output
    expect(row.usd).toBe(0.020325);
    expect(row.input_tokens).toBe(3000);
  });

  it('never prices more one-hour tokens than there are cache writes', () => {
    const usage = { input_tokens: 0, cache_creation_input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 0 };
    expect(priceUsage(table, 'builder-class', { ...usage, cache_creation_1h_input_tokens: 5000 }).usd).toBe(0.0006);
  });

  it('rounds to six decimals', () => {
    const row = priceUsage(table, 'builder-class', {
      input_tokens: 1,
      cache_creation_input_tokens: 1,
      cache_creation_1h_input_tokens: 0,
      cache_read_input_tokens: 1,
      output_tokens: 1,
    });
    expect(row.usd).toBe(0.000022);
  });

  it('throws for a model that is not in the table', () => {
    expect(() =>
      priceUsage(table, 'missing-model', { input_tokens: 1, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }),
    ).toThrow(UnknownModelError);
  });
});

describe('fallbackPrice', () => {
  it('takes the highest of each rate across every model in the table', () => {
    const table = parsePriceTable(
      JSON.stringify({
        cheap: { input: 1, output: 40, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 },
        dear: { input: 15, output: 75, cache_read: 1.5, cache_write_5m: 18.75, cache_write_1h: 1 },
      }),
    );
    expect(fallbackPrice(table)).toEqual({ input: 15, output: 75, cache_read: 1.5, cache_write_5m: 18.75, cache_write_1h: 2 });
    expect(fallbackPrice(parsePriceTable(TABLE))).toEqual(parsePriceTable(TABLE)['director-class']);
  });
});
