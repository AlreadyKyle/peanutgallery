// Pure session metering. Every turn is priced with PRICE_TABLE_JSON as it arrives and written by the
// caller; the session is settled when it ends. Claude Code writes each assistant line before the
// turn's output is counted, so the turn rows fall short. The result line's modelUsage holds the
// session's real token totals, and the settle rows make the ledger equal those totals priced with
// our table. The command line's own cost figure uses a table that is not ours and is never recorded.
//
// Every row carries a request id made when it is priced (prefix/turn/n, prefix/settle/n), and a
// write retried with that id is recorded once (record_usage, 20260921000200_ledger_request_id.sql).
//
// Where the stream cannot be trusted the meter records more, never less:
// - a turn row counts as recorded only once the caller commits it; a row whose write failed is
//   written again at settle, under the same id;
// - every token class settles at the larger of the result line and the turns;
// - a result line that reports less output than the turns did, or no result line at all, takes the
//   estimate for output: each turn's output is the largest of its reported tokens, one token per
//   three characters it wrote, and 1,024 tokens for a turn with a thinking block; the estimate
//   charges each compaction as a request, and with no result line one more for the request in
//   flight;
// - modelUsage keys that do not match the turns' models are reconciled on their total, under the
//   turns' model, rather than written a second time under a new name;
// - a model missing from the table is priced at the table's highest rates.
import type { AgentEvent, EndEvent, ModelUsage } from './adapters/types.js';
import { fallbackPrice, modelPrice, priceWith, round4, round6, type LedgerUsage, type ModelPrice, type PriceTable, type TurnUsage } from './pricing.js';

// Characters per output token for the estimate. Low on purpose: English prose and code run nearer
// four, so dividing by three errs toward recording more.
export const CHARS_PER_TOKEN = 3;
// Claude Code writes thinking blocks with their text left out, so a thinking turn's output cannot be
// counted from its characters. The estimate charges at least this many output tokens for it: the
// smallest thinking budget the Messages API accepts.
export const THINKING_FLOOR_TOKENS = 1024;
// The output charged for the request in flight when a session ends without a result line.
export const IN_FLIGHT_OUTPUT_TOKENS = 1024;

export type MeterBasis = 'result' | 'estimate';

// A ledger row with the id it is written under.
export type MeterRow = LedgerUsage & { request_id: string };

// Every row's usd is rounded to four decimals here, as record_usage would round it, so the ledger
// stores exactly what the meter counts as recorded; the settle rows correct the rounding.
export interface TurnMetering {
  row: MeterRow;
  // True when the model has no row in the price table and the turn was priced at the fallback rates.
  fallback: boolean;
}

export interface Settlement {
  // The turn rows never committed, then one difference row per group of models.
  rows: MeterRow[];
  basis: MeterBasis;
  fallbackModels: string[];
  // The models the turns reported, as opposed to models seen only in modelUsage.
  turnModels: string[];
  // What the rows recorded above the settled total, in USD. record_usage refuses a negative
  // amount, so it is reported rather than written back.
  overcountUsd: number;
  // True when modelUsage names a model the turns did not, and the turns name one it does not, or a
  // turn model is missing from modelUsage.
  mismatch: boolean;
  // True when modelUsage reports less output than the turns did.
  anomaly: boolean;
  // "<model> <class>" for each token class modelUsage reports as zero where the turns reported some:
  // a field that may have been renamed. Alerted; the larger count already covers the amount.
  zeroedFields: string[];
}

type TurnInput = Pick<Extract<AgentEvent, { type: 'turn_usage' }>, 'model' | 'usage' | 'contentChars' | 'thinking'>;
type ContentInput = Pick<Extract<AgentEvent, { type: 'turn_content' }>, 'model' | 'contentChars' | 'thinking' | 'outputTokens'>;
type CompactionInput = Pick<Extract<AgentEvent, { type: 'compaction' }>, 'model' | 'preTokens'>;

// Tokens the turns reported for one model, and the estimate of its output.
interface Seen {
  input: number;
  creation: number;
  creation1h: number;
  read: number;
  output: number;
  estimatedOutput: number;
  // Requests the turns do not show, charged only in the estimate.
  compactionInput: number;
  compactionOutput: number;
}

interface Group {
  tallied: string[];
  reported: ModelUsage[];
}

function emptySeen(): Seen {
  return { input: 0, creation: 0, creation1h: 0, read: 0, output: 0, estimatedOutput: 0, compactionInput: 0, compactionOutput: 0 };
}

function nonZero(row: LedgerUsage): boolean {
  return row.usd > 0 || row.input_tokens > 0 || row.cached_tokens > 0 || row.output_tokens > 0;
}

function estimatedOutput(chars: number, reported: number, thinking: boolean): number {
  return Math.max(Math.ceil(chars / CHARS_PER_TOKEN), reported, thinking ? THINKING_FLOOR_TOKENS : 0);
}

export class SessionMeter {
  private readonly table: PriceTable;
  private readonly idPrefix: string;
  private readonly defaultModel: string;
  private readonly fallbackRates: ModelPrice;
  private readonly seen = new Map<string, Seen>();
  private readonly committed = new Map<string, LedgerUsage>();
  private readonly pending: MeterRow[] = [];
  private readonly fallbacks = new Set<string>();
  private lastTurn: { model: string; usage: TurnUsage } | null = null;
  private turnRows = 0;
  // Compactions before any turn, charged to the first turn's model when one arrives.
  private readonly earlyCompactions: CompactionInput[] = [];

  // idPrefix must be unique to this session or probe run: the ids it makes are unique only under it.
  // defaultModel is the model the session was started on, for a compaction no turn names.
  constructor(table: PriceTable, idPrefix: string, defaultModel = '') {
    this.table = table;
    this.idPrefix = idPrefix;
    this.defaultModel = defaultModel;
    this.fallbackRates = fallbackPrice(table);
  }

  get turnsRecorded(): boolean {
    return this.seen.size > 0;
  }

  // Prices a turn. The row is pending until commit() says its write succeeded.
  addTurn(turn: TurnInput): TurnMetering {
    const { price, fallback } = this.price([turn.model]);
    const priced = priceWith(price, turn.model, turn.usage);
    this.turnRows += 1;
    const row: MeterRow = { ...priced, usd: round4(priced.usd), request_id: `${this.idPrefix}/turn/${this.turnRows}` };
    const seen = this.tally(turn.model);
    seen.input += turn.usage.input_tokens;
    seen.creation += turn.usage.cache_creation_input_tokens;
    seen.creation1h += Math.min(turn.usage.cache_creation_1h_input_tokens, turn.usage.cache_creation_input_tokens);
    seen.read += turn.usage.cache_read_input_tokens;
    seen.output += turn.usage.output_tokens;
    seen.estimatedOutput += estimatedOutput(turn.contentChars, turn.usage.output_tokens, turn.thinking);
    this.lastTurn = { model: turn.model, usage: turn.usage };
    for (const compaction of this.earlyCompactions.splice(0)) this.chargeCompaction(turn.model, compaction.preTokens);
    if (nonZero(row)) this.pending.push(row);
    return { row, fallback };
  }

  // Characters and output reported on a line for a turn already priced.
  addContent(content: ContentInput): void {
    this.tally(content.model).estimatedOutput += estimatedOutput(content.contentChars, content.outputTokens, content.thinking);
  }

  // A compaction is a request of its own: the context it summarised as input, and
  // IN_FLIGHT_OUTPUT_TOKENS of output. Only the estimate charges it; modelUsage already counts it.
  // A compaction before any turn waits for the first turn's model, since the init line's model may
  // not be the name the turns report.
  addCompaction(compaction: CompactionInput): void {
    if (this.lastTurn === null) {
      this.earlyCompactions.push(compaction);
      return;
    }
    this.chargeCompaction(compaction.model || this.lastTurn.model, compaction.preTokens);
  }

  private chargeCompaction(model: string, preTokens: number): void {
    const seen = this.tally(model);
    seen.compactionInput += preTokens;
    seen.compactionOutput += IN_FLIGHT_OUTPUT_TOKENS;
  }

  // The model for a compaction no turn claimed: the name it came with when the table prices it,
  // otherwise the session's model.
  private earlyModel(compaction: CompactionInput): string {
    return compaction.model && modelPrice(this.table, compaction.model) ? compaction.model : this.defaultModel || compaction.model;
  }

  // What this session's rows total: the committed ones and the pending ones.
  recordedUsd(): number {
    return this.recorded([...this.seen.keys(), ...this.committed.keys()].filter((model, index, all) => all.indexOf(model) === index)).usd;
  }

  // The row's write succeeded: it counts as recorded and is not written again.
  commit(row: MeterRow): void {
    const at = this.pending.indexOf(row);
    if (at >= 0) this.pending.splice(at, 1);
    const total = this.committed.get(row.model) ?? { model: row.model, input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 0 };
    total.input_tokens += row.input_tokens;
    total.cached_tokens += row.cached_tokens;
    total.output_tokens += row.output_tokens;
    total.usd = round4(total.usd + row.usd);
    this.committed.set(row.model, total);
  }

  // What the ledger would hold for this session if it ended now with no result line: the estimate,
  // including the request in flight. The ceiling is checked against it while the session runs.
  liveEstimateUsd(): number {
    let usd = 0;
    for (const compaction of this.earlyCompactions) {
      const model = this.earlyModel(compaction);
      const request: TurnUsage = { input_tokens: compaction.preTokens, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: IN_FLIGHT_OUTPUT_TOKENS };
      usd += priceWith(this.price([model]).price, model, request).usd;
    }
    for (const model of this.seen.keys()) {
      usd += priceWith(this.price([model]).price, model, this.estimateUsage([model], true)).usd;
    }
    return round6(usd);
  }

  settle(end: EndEvent | null): Settlement {
    // No turn arrived to claim these, so they are charged now.
    for (const compaction of this.earlyCompactions.splice(0)) this.chargeCompaction(this.earlyModel(compaction), compaction.preTokens);
    const reported = end?.modelUsage ?? [];
    const turnModels = [...this.seen.keys()];
    const rows: MeterRow[] = [...this.pending];
    let settleRows = 0;
    let overcount = 0;
    let anomaly = false;
    const zeroedFields: string[] = [];
    let estimated = reported.length === 0;
    const { groups, mismatch } = reported.length === 0 ? { groups: turnModels.map((model) => ({ tallied: [model], reported: [] })), mismatch: false } : this.groups(reported);

    for (const group of groups) {
      let usage: TurnUsage;
      if (group.reported.length === 0) {
        estimated = true;
        usage = this.estimateUsage(group.tallied, end === null);
      } else {
        const result = this.resultUsage(group, reported.length === 1 ? (end?.usage ?? null) : null);
        zeroedFields.push(...result.zeroed.map((field) => `${this.rowModel(group)} ${field}`));
        anomaly ||= result.anomaly;
        estimated ||= result.anomaly;
        usage = result.usage;
      }
      const price = this.price([...group.tallied, ...group.reported.map((entry) => entry.model)]).price;
      const recorded = this.recorded(group.tallied);
      const model = this.rowModel(group);
      const settled = round4(priceWith(price, model, usage).usd);
      const difference = round4(settled - recorded.usd);
      if (difference < 0) {
        overcount = round4(overcount - difference);
        continue;
      }
      const row: LedgerUsage = {
        model,
        input_tokens: Math.max(0, usage.input_tokens + usage.cache_creation_input_tokens - recorded.input_tokens),
        cached_tokens: Math.max(0, usage.cache_read_input_tokens - recorded.cached_tokens),
        output_tokens: Math.max(0, usage.output_tokens - recorded.output_tokens),
        usd: difference,
      };
      if (nonZero(row)) {
        settleRows += 1;
        rows.push({ ...row, request_id: `${this.idPrefix}/settle/${settleRows}` });
      }
    }
    return { rows, basis: estimated ? 'estimate' : 'result', fallbackModels: [...this.fallbacks], turnModels, overcountUsd: overcount, mismatch, anomaly, zeroedFields };
  }

  // Each model both the turns and modelUsage name is its own group. The rest are grouped so no
  // spend is written twice: modelUsage keys the turns never named, beside turn models modelUsage
  // lacks, are one group settled on their total (a renamed key); keys alone are side models, each
  // its own group; turn models alone are settled on the estimate.
  private groups(reported: readonly ModelUsage[]): { groups: Group[]; mismatch: boolean } {
    const keys = new Set(reported.map((entry) => entry.model));
    const groups: Group[] = reported.filter((entry) => this.seen.has(entry.model)).map((entry) => ({ tallied: [entry.model], reported: [entry] }));
    const extraReported = reported.filter((entry) => !this.seen.has(entry.model));
    const extraTallied = [...this.seen.keys()].filter((model) => !keys.has(model));
    if (extraReported.length > 0 && extraTallied.length > 0) {
      groups.push({ tallied: extraTallied, reported: extraReported });
    } else {
      for (const entry of extraReported) groups.push({ tallied: [], reported: [entry] });
      for (const model of extraTallied) groups.push({ tallied: [model], reported: [] });
    }
    return { groups, mismatch: extraTallied.length > 0 };
  }

  private seenTotal(models: readonly string[]): Seen {
    const total = emptySeen();
    for (const model of models) {
      const seen = this.seen.get(model);
      if (!seen) continue;
      total.input += seen.input;
      total.creation += seen.creation;
      total.creation1h += seen.creation1h;
      total.read += seen.read;
      total.output += seen.output;
      total.estimatedOutput += seen.estimatedOutput;
      total.compactionInput += seen.compactionInput;
      total.compactionOutput += seen.compactionOutput;
    }
    return total;
  }

  // The turns' tokens with the estimated output, and each compaction, which no modelUsage entry counts
  // for these models. When the session ended with no result line, one more request is added for the
  // one in flight: the last turn's input again, the context it read or wrote to cache read once
  // more, and IN_FLIGHT_OUTPUT_TOKENS of output.
  private estimateUsage(models: readonly string[], inFlight: boolean): TurnUsage {
    const seen = this.seenTotal(models);
    const usage: TurnUsage = {
      input_tokens: seen.input + seen.compactionInput,
      cache_creation_input_tokens: seen.creation,
      cache_creation_1h_input_tokens: seen.creation1h,
      cache_read_input_tokens: seen.read,
      output_tokens: Math.max(seen.output, seen.estimatedOutput) + seen.compactionOutput,
    };
    const last = this.lastTurn;
    if (inFlight && last && models.includes(last.model)) {
      usage.input_tokens += last.usage.input_tokens;
      usage.cache_read_input_tokens += last.usage.cache_read_input_tokens + last.usage.cache_creation_input_tokens;
      usage.output_tokens += IN_FLIGHT_OUTPUT_TOKENS;
    }
    return usage;
  }

  // Each token class at the larger of modelUsage and the turns. Output modelUsage reports below the
  // turns is an anomaly (a renamed or missing field), and the output then takes the estimate. A short
  // count of any other class is covered by the larger count alone.
  private resultUsage(group: Group, sessionUsage: TurnUsage | null): { usage: TurnUsage; anomaly: boolean; zeroed: string[] } {
    const seen = this.seenTotal(group.tallied);
    const rep = { input: 0, creation: 0, read: 0, output: 0 };
    for (const entry of group.reported) {
      rep.input += entry.input_tokens;
      rep.creation += entry.cache_creation_input_tokens;
      rep.read += entry.cache_read_input_tokens;
      rep.output += entry.output_tokens;
    }
    const anomaly = rep.output < seen.output;
    const zeroed = (
      [
        ['input_tokens', rep.input, seen.input],
        ['cache_creation_input_tokens', rep.creation, seen.creation],
        ['cache_read_input_tokens', rep.read, seen.read],
        ['output_tokens', rep.output, seen.output],
      ] as const
    )
      .filter(([, reportedCount, seenCount]) => reportedCount === 0 && seenCount > 0)
      .map(([field]) => field);
    const creation = Math.max(rep.creation, seen.creation);
    // Cache writes the turns did not record count as one-hour. With one model in modelUsage the result
    // line's own split covers the whole session and is used instead.
    let oneHour = Math.min(creation, seen.creation1h + Math.max(0, creation - seen.creation));
    if (rep.creation >= seen.creation && sessionUsage && sessionUsage.cache_creation_input_tokens === creation) oneHour = sessionUsage.cache_creation_1h_input_tokens;
    const usage: TurnUsage = {
      input_tokens: Math.max(rep.input, seen.input),
      cache_creation_input_tokens: creation,
      cache_creation_1h_input_tokens: oneHour,
      cache_read_input_tokens: Math.max(rep.read, seen.read),
      output_tokens: anomaly ? Math.max(rep.output, seen.output, seen.estimatedOutput) : Math.max(rep.output, seen.output),
    };
    return { usage, anomaly, zeroed };
  }

  // The committed rows plus the pending ones, which settle writes first.
  private recorded(models: readonly string[]): LedgerUsage {
    const total = { model: '', input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 0 };
    const rows = [...models.map((model) => this.committed.get(model)), ...this.pending.filter((row) => models.includes(row.model))];
    for (const row of rows) {
      if (!row) continue;
      total.input_tokens += row.input_tokens;
      total.cached_tokens += row.cached_tokens;
      total.output_tokens += row.output_tokens;
      total.usd = round4(total.usd + row.usd);
    }
    return total;
  }

  // A group's difference row goes under the turn model that recorded the most, or the modelUsage key
  // when no turn named the model.
  private rowModel(group: Group): string {
    if (group.tallied.length === 0) return group.reported[0]!.model;
    return group.tallied.reduce((best, model) => (this.recorded([model]).usd > this.recorded([best]).usd ? model : best));
  }

  private tally(model: string): Seen {
    let seen = this.seen.get(model);
    if (!seen) {
      seen = emptySeen();
      this.seen.set(model, seen);
    }
    return seen;
  }

  // The highest of each rate across the priced models named; the fallback rates, with every model
  // named reported as a fallback, when none is priced. A renamed modelUsage key is thereby priced
  // at its turn model's rates.
  private price(models: readonly string[]): { price: ModelPrice; fallback: boolean } {
    const known = models.map((model) => modelPrice(this.table, model)).filter((price): price is ModelPrice => price !== null);
    if (known.length === 0) {
      for (const model of models) this.fallbacks.add(model);
      return { price: this.fallbackRates, fallback: true };
    }
    if (known.length === 1) return { price: known[0]!, fallback: false };
    return { price: fallbackPrice(Object.fromEntries(known.map((price, index) => [String(index), price]))), fallback: false };
  }
}
