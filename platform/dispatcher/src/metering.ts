// Pure session metering. Every turn is recorded as it arrives, priced with PRICE_TABLE_JSON, and the
// session is settled against the result line when it ends. Claude Code writes each assistant line
// before the turn's output is counted, so the turn rows fall short; the result line's modelUsage
// holds the session's real token totals, and the settle rows make the ledger equal those totals
// priced with our table. The command line's own cost figure uses a table that is not ours and is
// never recorded. Without a result line the shortfall is estimated from the characters the model
// wrote. A model missing from the table is priced at the table's highest rates.
import type { AgentEvent, EndEvent } from './adapters/types.js';
import { fallbackPrice, modelPrice, priceWith, round4, round6, type LedgerUsage, type ModelPrice, type PriceTable, type TurnUsage } from './pricing.js';

// Characters per output token for the estimate. Low on purpose: English prose and code run nearer
// four, so dividing by three errs toward recording more.
export const CHARS_PER_TOKEN = 3;

export type MeterBasis = 'result' | 'estimate';

// Every row's usd is rounded to four decimals here, as record_usage would round it, so the ledger
// stores exactly what the meter counts as recorded; the settle rows correct the rounding.
export interface TurnMetering {
  row: LedgerUsage;
  // True when the model has no row in the price table and the turn was priced at the fallback rates.
  fallback: boolean;
}

export interface Settlement {
  rows: LedgerUsage[];
  basis: MeterBasis;
  fallbackModels: string[];
  // What the turn rows recorded above the result line's total, in USD. record_usage refuses a
  // negative amount, so it is reported rather than written back.
  overcountUsd: number;
}

type TurnInput = Pick<Extract<AgentEvent, { type: 'turn_usage' }>, 'model' | 'usage' | 'contentChars'>;

interface Tally {
  usd: number;
  input: number;
  creation: number;
  creation1h: number;
  read: number;
  output: number;
  contentChars: number;
}

function emptyTally(): Tally {
  return { usd: 0, input: 0, creation: 0, creation1h: 0, read: 0, output: 0, contentChars: 0 };
}

export class SessionMeter {
  private readonly table: PriceTable;
  private readonly fallbackRates: ModelPrice;
  private readonly tallies = new Map<string, Tally>();
  private readonly fallbacks = new Set<string>();

  constructor(table: PriceTable) {
    this.table = table;
    this.fallbackRates = fallbackPrice(table);
  }

  get turnsRecorded(): boolean {
    return this.tallies.size > 0;
  }

  addTurn(turn: TurnInput): TurnMetering {
    const { price, fallback } = this.price(turn.model);
    const priced = priceWith(price, turn.model, turn.usage);
    const row = { ...priced, usd: round4(priced.usd) };
    const tally = this.tally(turn.model);
    tally.usd = round4(tally.usd + row.usd);
    tally.input += turn.usage.input_tokens;
    tally.creation += turn.usage.cache_creation_input_tokens;
    tally.creation1h += Math.min(turn.usage.cache_creation_1h_input_tokens, turn.usage.cache_creation_input_tokens);
    tally.read += turn.usage.cache_read_input_tokens;
    tally.output += turn.usage.output_tokens;
    tally.contentChars += turn.contentChars;
    return { row, fallback };
  }

  // Recorded spend plus the estimated output shortfall, for the ceiling check while the session runs.
  liveEstimateUsd(): number {
    let usd = 0;
    for (const [model, tally] of this.tallies) {
      usd += tally.usd + (this.shortfall(tally) * this.price(model).price.output) / 1_000_000;
    }
    return round6(usd);
  }

  settle(end: EndEvent | null): Settlement {
    if (end === null || end.modelUsage.length === 0) return this.estimate();
    const rows: LedgerUsage[] = [];
    let overcount = 0;
    const single = end.modelUsage.length === 1;
    for (const reported of end.modelUsage) {
      const tally = this.tallies.get(reported.model) ?? emptyTally();
      const creation = reported.cache_creation_input_tokens;
      // Cache writes the turns did not record count as one-hour. With one model the result line's
      // own split covers the whole session and is used instead.
      let oneHour = Math.min(creation, tally.creation1h + Math.max(0, creation - tally.creation));
      if (single && end.usage && end.usage.cache_creation_input_tokens === creation) oneHour = end.usage.cache_creation_1h_input_tokens;
      const usage: TurnUsage = {
        input_tokens: reported.input_tokens,
        cache_creation_input_tokens: creation,
        cache_creation_1h_input_tokens: oneHour,
        cache_read_input_tokens: reported.cache_read_input_tokens,
        output_tokens: reported.output_tokens,
      };
      const authoritative = round4(priceWith(this.price(reported.model).price, reported.model, usage).usd);
      const difference = round4(authoritative - tally.usd);
      if (difference < 0) {
        overcount = round4(overcount - difference);
        continue;
      }
      const row: LedgerUsage = {
        model: reported.model,
        input_tokens: Math.max(0, reported.input_tokens + creation - (tally.input + tally.creation)),
        cached_tokens: Math.max(0, reported.cache_read_input_tokens - tally.read),
        output_tokens: Math.max(0, reported.output_tokens - tally.output),
        usd: difference,
      };
      if (row.usd > 0 || row.input_tokens > 0 || row.cached_tokens > 0 || row.output_tokens > 0) rows.push(row);
    }
    return { rows, basis: 'result', fallbackModels: [...this.fallbacks], overcountUsd: overcount };
  }

  private estimate(): Settlement {
    const rows: LedgerUsage[] = [];
    for (const [model, tally] of this.tallies) {
      const tokens = this.shortfall(tally);
      const usd = round4((tokens * this.price(model).price.output) / 1_000_000);
      if (usd > 0) rows.push({ model, input_tokens: 0, cached_tokens: 0, output_tokens: tokens, usd });
    }
    return { rows, basis: 'estimate', fallbackModels: [...this.fallbacks], overcountUsd: 0 };
  }

  private shortfall(tally: Tally): number {
    return Math.max(0, Math.ceil(tally.contentChars / CHARS_PER_TOKEN) - tally.output);
  }

  private tally(model: string): Tally {
    let tally = this.tallies.get(model);
    if (!tally) {
      tally = emptyTally();
      this.tallies.set(model, tally);
    }
    return tally;
  }

  private price(model: string): { price: ModelPrice; fallback: boolean } {
    const price = modelPrice(this.table, model);
    if (price) return { price, fallback: false };
    this.fallbacks.add(model);
    return { price: this.fallbackRates, fallback: true };
  }
}
