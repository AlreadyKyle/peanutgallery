// The credit probe (docs/specs/unattended-roles.md, PR3): one Messages call of one output token on the
// studio key, with the cheapest model the price table lists, to tell whether the key can spend again
// after the dispatcher paused the studio for awaiting_credit (the Console credit or spend limit) or
// spend_limit (the usage tier's monthly cap). The tick runs it with a backoff while such a pause holds
// (tick.ts) and unpauses the studio when it answers ok.
//
// Its usage is recorded as an overhead ledger row, as the startup probe's is (managed.ts
// overheadSession): public, paid from the studio share, never taken from the pool. The usage block is
// read by the stream reader every session's turns go through (adapters/stream.ts readUsage) and priced
// at list price (pricing.ts); the row's request id is the message id, so a retried write is recorded
// once. A refusal is classified by the same reader the sessions use (credit.ts spendRefusal).
import Anthropic from '@anthropic-ai/sdk';
import { readUsage } from './adapters/stream.js';
import { spendRefusal } from './credit.js';
import type { Db } from './db.js';
import { errorMessage } from './log.js';
import { priceUsage, round4, type PriceTable } from './pricing.js';

export type CreditProbeOutcome =
  | { outcome: 'ok'; model: string; usd: number }
  | { outcome: 'credit' | 'tier_cap' | 'error'; model: string | null; detail: string };

// The slice of a Messages answer the probe reads.
export interface ProbeMessage {
  id: string;
  usage: unknown;
}

export interface ProbeMessagesClient {
  create(params: { model: string; max_tokens: number; messages: { role: 'user'; content: string }[] }): Promise<ProbeMessage>;
}

// The real client on the studio key. No retries: a refusal is the answer the probe wants, and the
// tick's backoff is the retry.
export function sdkProbeClient(apiKey: string): ProbeMessagesClient {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 });
  return { create: (params) => client.messages.create(params) };
}

// The model with the lowest input plus output rate, then the first by name, so the probe costs the
// least the table allows.
export function cheapestModel(table: PriceTable): string {
  const models = Object.entries(table).sort(([a, pa], [b, pb]) => pa.input + pa.output - (pb.input + pb.output) || (a < b ? -1 : a > b ? 1 : 0));
  const first = models[0];
  if (!first) throw new Error('the price table lists no models');
  return first[0];
}

export interface CreditProbeDeps {
  client: ProbeMessagesClient;
  db: Pick<Db, 'recordUsage'>;
  priceTable: PriceTable;
}

export async function probeCredit(deps: CreditProbeDeps): Promise<CreditProbeOutcome> {
  let model: string;
  try {
    model = cheapestModel(deps.priceTable);
  } catch (error) {
    return { outcome: 'error', model: null, detail: errorMessage(error) };
  }
  let message: ProbeMessage;
  try {
    message = await deps.client.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'Reply with one word.' }] });
  } catch (error) {
    const detail = errorMessage(error);
    return { outcome: spendRefusal(detail) ?? 'error', model, detail };
  }
  const usage = readUsage(message.usage);
  if (!usage) return { outcome: 'error', model, detail: `the probe answer ${message.id} carried no usage` };
  try {
    const priced = priceUsage(deps.priceTable, model, usage);
    const usd = round4(priced.usd);
    await deps.db.recordUsage({ billed_to: 'overhead', card_id: null, role_id: null, ...priced, usd, request_id: `credit-probe/${message.id}` });
    return { outcome: 'ok', model, usd };
  } catch (error) {
    // The key spent, but the spend is not in the ledger: the studio stays paused until a probe whose
    // spend is recorded.
    return { outcome: 'error', model, detail: `the probe's usage could not be recorded: ${errorMessage(error)}` };
  }
}
