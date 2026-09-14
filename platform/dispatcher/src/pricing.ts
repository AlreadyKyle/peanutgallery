// Pure pricing: turns a stream-json usage block into a ledger row at list price.
// Rates come from PRICE_TABLE_JSON (USD per million tokens). An unknown model throws;
// the caller pauses the card rather than pricing at zero.

export interface ModelPrice {
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
}

export type PriceTable = Readonly<Record<string, ModelPrice>>;

export interface TurnUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export interface LedgerUsage {
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  usd: number;
}

const RATE_KEYS = ['input', 'output', 'cache_read', 'cache_write_5m', 'cache_write_1h'] as const;

export class UnknownModelError extends Error {
  readonly model: string;
  constructor(model: string) {
    super(`no price for model ${model}`);
    this.name = 'UnknownModelError';
    this.model = model;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePriceTable(json: string): PriceTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('PRICE_TABLE_JSON is not valid JSON');
  }
  if (!isRecord(parsed)) {
    throw new Error('PRICE_TABLE_JSON must be an object keyed by model id');
  }
  const table: Record<string, ModelPrice> = {};
  for (const [model, rates] of Object.entries(parsed)) {
    if (!isRecord(rates)) {
      throw new Error(`PRICE_TABLE_JSON: ${model} must be an object of rates`);
    }
    const price: Record<string, number> = {};
    for (const key of RATE_KEYS) {
      const value = rates[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`PRICE_TABLE_JSON: ${model}.${key} must be a non-negative number`);
      }
      price[key] = value;
    }
    table[model] = price as unknown as ModelPrice;
  }
  if (Object.keys(table).length === 0) {
    throw new Error('PRICE_TABLE_JSON lists no models');
  }
  return table;
}

export function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// Ledger mapping: cache-creation tokens are priced at the five-minute cache-write rate and
// folded into input_tokens; cache-read tokens become cached_tokens at the cache-read rate.
export function priceUsage(table: PriceTable, model: string, usage: TurnUsage): LedgerUsage {
  const price = table[model];
  if (!price) {
    throw new UnknownModelError(model);
  }
  const usd =
    (usage.input_tokens * price.input +
      usage.cache_creation_input_tokens * price.cache_write_5m +
      usage.cache_read_input_tokens * price.cache_read +
      usage.output_tokens * price.output) /
    1_000_000;
  return {
    model,
    input_tokens: usage.input_tokens + usage.cache_creation_input_tokens,
    cached_tokens: usage.cache_read_input_tokens,
    output_tokens: usage.output_tokens,
    usd: round6(usd),
  };
}
