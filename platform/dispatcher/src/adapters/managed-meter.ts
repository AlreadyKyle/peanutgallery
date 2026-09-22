// Ledger rows for one Managed Agents session (docs/specs/launch-managed.md). The platform reports
// each model request's tokens as a span.model_request_end event and the session's total as
// usage.list_cost: every model token at list price plus $0.08 an hour of session running time. The
// meter writes:
// - one row per model request, under the event's id, priced with PRICE_TABLE_JSON (cache writes at
//   the five-minute rate, since the event does not say which cache it wrote);
// - once the session is idle, one runtime row, <session>/runtime: usage.active_seconds at $0.08 an
//   hour, under the label managed-runtime;
// - then one settle row, <session>/settle, for list_cost less everything recorded, under the
//   session's model, so the session's rows add up to what the platform charges.
// Every row id is fixed by the session, so a restarted dispatcher that meters the same session again
// writes nothing twice (record_usage returns the row an id already has). A rows total above list_cost
// by more than the half cent list_cost rounds to cannot be written back, since record_usage refuses a
// negative amount: it is reported, as the command-line meter does. The settle row is written only
// once every request row is on the ledger; otherwise the session is left for recovery to settle.
import type { Billing, RecordUsageResult, UsageInput } from '../db.js';
import { errorMessage, type Logger } from '../log.js';
import { fallbackPrice, modelPrice, priceWith, round4, type PriceTable, type TurnUsage } from '../pricing.js';
import { retry } from '../time.js';

// Session running time at list price (managed-agents-core.md, Session budgets).
export const MANAGED_RUNTIME_USD_PER_HOUR = 0.08;
export const RUNTIME_MODEL = 'managed-runtime';
// list_cost is rounded to the nearest cent.
export const LIST_COST_ROUNDING_USD = 0.005;
// A settle row this large, and this share of the session's list cost, is alerted: the request rows
// fell well short of what the platform charged.
export const SETTLE_ALERT_USD = 0.05;
export const SETTLE_ALERT_SHARE = 0.25;
export const LEDGER_TRIES = 3;
export const LEDGER_RETRY_MS = 500;

export type Recorder = (input: UsageInput) => Promise<RecordUsageResult>;

export interface ManagedBilling {
  billed_to: Billing;
  card_id: string | null;
  role_id: string | null;
}

// The token counts of one model request, as span.model_request_end carries them.
export interface RequestUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export function turnUsage(usage: RequestUsage): TurnUsage {
  return {
    input_tokens: usage.input_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_creation_1h_input_tokens: 0,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    output_tokens: usage.output_tokens,
  };
}

function zero(usage: RequestUsage): boolean {
  return usage.input_tokens === 0 && usage.cache_creation_input_tokens === 0 && usage.cache_read_input_tokens === 0 && usage.output_tokens === 0;
}

// The usd amount of a list_cost ({amount: cents as an integer string, currency: 'USD'}), or null.
export function listCostUsd(listCost: { amount: string; currency: string } | null | undefined): number | null {
  if (!listCost || listCost.currency !== 'USD' || !/^\d+$/.test(listCost.amount)) return null;
  return round4(Number(listCost.amount) / 100);
}

export interface SettleReport {
  listCostUsd: number | null;
  recordedUsd: number;
  runtimeUsd: number;
  settleUsd: number;
  overcountUsd: number;
  // Rows the ledger refused after every try, named for the board to post by hand.
  unwritten: Array<UsageInput & { error: string }>;
  // True when every row the session needs is on the ledger, so it may be archived.
  settled: boolean;
  // One line each, for the alert.
  problems: string[];
}

export interface ManagedMeterOptions {
  table: PriceTable;
  model: string;
  sessionId: string;
  billing: ManagedBilling;
  record: Recorder;
  log: Logger;
  retryMs?: number;
}

export class ManagedMeter {
  private readonly opts: ManagedMeterOptions;
  // Request id to the usd written under it.
  private readonly written = new Map<string, number>();
  private readonly pending = new Map<string, UsageInput>();
  private readonly totals: TurnUsage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
  private fallback = false;
  requests = 0;

  constructor(opts: ManagedMeterOptions) {
    this.opts = opts;
  }

  // The session's token totals over the requests seen.
  usage(): TurnUsage {
    return { ...this.totals };
  }

  // True when the model had no row in PRICE_TABLE_JSON and requests were priced at the table's
  // highest rates.
  get pricedAtFallback(): boolean {
    return this.fallback;
  }

  recordedUsd(): number {
    let total = 0;
    for (const usd of this.written.values()) total = round4(total + usd);
    return total;
  }

  private row(requestId: string, usage: RequestUsage): UsageInput {
    const price = modelPrice(this.opts.table, this.opts.model);
    if (!price) this.fallback = true;
    const priced = priceWith(price ?? fallbackPrice(this.opts.table), this.opts.model, turnUsage(usage));
    return { ...this.opts.billing, ...priced, usd: round4(priced.usd), request_id: requestId };
  }

  private async write(row: UsageInput): Promise<boolean> {
    const id = row.request_id ?? '';
    if (this.written.has(id)) return true;
    try {
      await retry(() => this.opts.record(row), LEDGER_TRIES, this.opts.retryMs ?? LEDGER_RETRY_MS, (error, attempt) =>
        this.opts.log.warn('managed', 'ledger write failed', { session: this.opts.sessionId, request_id: id, usd: row.usd, attempt, error: errorMessage(error) }),
      );
      this.written.set(id, row.usd);
      this.pending.delete(id);
      return true;
    } catch (error) {
      this.pending.set(id, row);
      this.opts.log.error('managed', 'ledger row not written', { session: this.opts.sessionId, request_id: id, usd: row.usd, error: errorMessage(error) });
      return false;
    }
  }

  // Meters one span.model_request_end. Returns false when the ledger refused the row after every
  // try; the row stays pending and finish() tries it again.
  async request(eventId: string, usage: RequestUsage): Promise<{ row: UsageInput; written: boolean }> {
    const row = this.row(eventId, usage);
    if (this.written.has(eventId) || this.pending.has(eventId)) return { row, written: this.written.has(eventId) };
    this.requests += 1;
    this.totals.input_tokens += usage.input_tokens;
    this.totals.cache_creation_input_tokens += usage.cache_creation_input_tokens;
    this.totals.cache_read_input_tokens += usage.cache_read_input_tokens;
    this.totals.output_tokens += usage.output_tokens;
    if (zero(usage)) {
      this.written.set(eventId, 0);
      return { row, written: true };
    }
    return { row, written: await this.write(row) };
  }

  // Writes the runtime row and the settle row from the session's final usage.
  async finish(usage: { listCost: { amount: string; currency: string } | null | undefined; activeSeconds: number | null | undefined }): Promise<SettleReport> {
    for (const row of [...this.pending.values()]) await this.write(row);
    const unwritten = [...this.pending.values()].map((row) => ({ ...row, error: 'the ledger refused every try' }));
    const list = listCostUsd(usage.listCost);
    const report: SettleReport = { listCostUsd: list, recordedUsd: this.recordedUsd(), runtimeUsd: 0, settleUsd: 0, overcountUsd: 0, unwritten, settled: false, problems: [] };
    if (this.fallback) report.problems.push(`the model ${this.opts.model} has no row in PRICE_TABLE_JSON, so its requests were priced at the table's highest rates`);
    if (unwritten.length > 0) {
      report.problems.push(`request rows not written: ${unwritten.map((row) => `${row.request_id} ${row.usd} USD`).join(', ')}; the session is left unarchived for recovery to settle`);
      return report;
    }
    const seconds = usage.activeSeconds ?? null;
    if (seconds !== null && seconds > 0) {
      const runtime: UsageInput = {
        ...this.opts.billing,
        model: RUNTIME_MODEL,
        input_tokens: 0,
        cached_tokens: 0,
        output_tokens: 0,
        usd: round4((seconds * MANAGED_RUNTIME_USD_PER_HOUR) / 3600),
        request_id: `${this.opts.sessionId}/runtime`,
      };
      if (runtime.usd > 0) {
        if (!(await this.write(runtime))) {
          report.unwritten.push({ ...runtime, error: 'the ledger refused every try' });
          report.problems.push(`the runtime row ${runtime.request_id} (${runtime.usd} USD) was not written; the session is left for recovery`);
          return report;
        }
        report.runtimeUsd = runtime.usd;
      }
    }
    report.recordedUsd = this.recordedUsd();
    if (list === null) {
      report.problems.push('the session reported no list cost in USD, so it was not settled; it is left for recovery');
      return report;
    }
    const gap = round4(list - report.recordedUsd);
    if (gap < -LIST_COST_ROUNDING_USD) {
      report.overcountUsd = round4(-gap);
      report.problems.push(`the rows recorded ${report.overcountUsd} USD above the session's list cost of ${list} USD`);
    } else if (gap > 0) {
      const settle: UsageInput = {
        ...this.opts.billing,
        model: this.opts.model,
        input_tokens: 0,
        cached_tokens: 0,
        output_tokens: 0,
        usd: gap,
        request_id: `${this.opts.sessionId}/settle`,
      };
      this.opts.log.info('managed', 'settle row', { session: this.opts.sessionId, request_id: settle.request_id, usd: settle.usd, list_cost_usd: list, recorded_usd: report.recordedUsd });
      if (!(await this.write(settle))) {
        report.unwritten.push({ ...settle, error: 'the ledger refused every try' });
        report.problems.push(`the settle row ${settle.request_id} (${settle.usd} USD) was not written; the session is left for recovery`);
        return report;
      }
      report.settleUsd = gap;
      if (gap >= SETTLE_ALERT_USD && gap >= SETTLE_ALERT_SHARE * list) {
        report.problems.push(`the request rows fell ${gap} USD short of the session's list cost of ${list} USD; the settle row covers it`);
      }
    }
    report.recordedUsd = this.recordedUsd();
    report.settled = true;
    return report;
  }
}
