// Pure pricing: turns a stream-json usage block into a ledger row at list price.
// Rates come from PRICE_TABLE_JSON (USD per million tokens). An unknown model throws from
// priceUsage; the session meter prices it at fallbackPrice instead and the caller pauses the card.

export interface ModelPrice {
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
}

export type PriceTable = Readonly<Record<string, ModelPrice>>;

// cache_creation_1h_input_tokens is the part of cache_creation_input_tokens written to the one-hour
// cache; the rest was written to the five-minute cache. speed and service_tier are the usage block's
// own fields, when it carries them; anything but standard is a premium the table does not price.
export interface TurnUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation_1h_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  speed?: string | null;
  service_tier?: string | null;
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

// The highest of each rate across every model in the table. A model the table does not list is
// priced at these rates, so its spend is recorded high rather than at zero.
export function fallbackPrice(table: PriceTable): ModelPrice {
  const price: ModelPrice = { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
  for (const rates of Object.values(table)) {
    for (const key of RATE_KEYS) price[key] = Math.max(price[key], rates[key]);
  }
  return price;
}

// Ledger mapping: cache-creation tokens are priced at the one-hour cache-write rate for their
// one-hour part and the five-minute rate for the rest, and folded into input_tokens; cache-read
// tokens become cached_tokens at the cache-read rate.
export function priceWith(price: ModelPrice, model: string, usage: TurnUsage): LedgerUsage {
  const oneHour = Math.min(usage.cache_creation_1h_input_tokens, usage.cache_creation_input_tokens);
  const fiveMinute = usage.cache_creation_input_tokens - oneHour;
  const usd =
    (usage.input_tokens * price.input +
      fiveMinute * price.cache_write_5m +
      oneHour * price.cache_write_1h +
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

// The table's own row for a model, or null; never a property inherited from Object.
export function modelPrice(table: PriceTable, model: string): ModelPrice | null {
  return Object.hasOwn(table, model) ? (table[model] ?? null) : null;
}

export function priceUsage(table: PriceTable, model: string, usage: TurnUsage): LedgerUsage {
  const price = modelPrice(table, model);
  if (!price) {
    throw new UnknownModelError(model);
  }
  return priceWith(price, model, usage);
}
