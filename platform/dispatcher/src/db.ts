// Supabase service-role client behind a small typed interface, so the tick loop can run
// against an in-memory fake in tests.
import { createClient } from '@supabase/supabase-js';
import type { CardFolder } from './adapters/types.js';

export type CardLane = 'config' | 'code';

export interface StudioState {
  paused: boolean;
  agent_mode: string;
  daily_cap_usd: number;
  card_max_usd: number;
  agent_hourly_rate_usd: number;
  studio_reserve_usd: number;
  // The monthly spend cap that mirrors the Console limit; null when studio_state has no such column,
  // which unattended mode treats as a cap of zero.
  monthly_cap_usd: number | null;
}

export interface Pool {
  balance_usd: number;
  reserve_usd: number;
  incident_reserve_usd: number;
  daily_spent_usd: number;
  day: string;
}

export interface Card {
  id: string;
  bucket: string;
  source: string;
  shape: string;
  lane: CardLane;
  priority: number;
  folder: CardFolder;
  executor_role_id: string | null;
  title: string;
  intent: string | null;
  acceptance_test: string | null;
  design_spec_url: string | null;
  estimate_usd: number;
  actual_usd: number;
  // The money credited to the card's bar.
  funded_usd: number;
  // now, next or later; a database without the column reads as now, its default.
  horizon: string;
  severity: string | null;
  director_stance: string;
  stage: string;
  branch: string | null;
  commit_sha: string | null;
  failing_check: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  title: string;
  model: string;
  prompt_path: string;
  tools_json: unknown;
  write_access: boolean;
}

export interface Deploy {
  id: string;
  folder: CardFolder;
  sha: string;
  netlify_deploy_id: string | null;
  is_green: boolean;
  smoke_result: string | null;
  created_at: string;
}

// Who pays for a turn: the founder's subscription in attended mode, the pool in unattended mode.
// 'overhead' is the unattended startup probe's spend: public, paid from the studio share, never
// taken from the pool (20260922000000_ledger_overhead.sql).
export type Billing = 'studio' | 'founder' | 'overhead';

// card_id and role_id are null for spend that belongs to no card: the startup probe. request_id
// names the row on the dispatcher's side, so a retried write is recorded once; null writes a row
// every time.
export interface UsageInput {
  billed_to: Billing;
  card_id: string | null;
  role_id: string | null;
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  usd: number;
  request_id: string | null;
}

export interface RecordUsageResult {
  ledger_id: string;
  balance_usd: number;
  daily_spent_usd: number;
  actual_usd: number;
}

export type CardPatch = Partial<Pick<Card, 'stage' | 'branch' | 'commit_sha' | 'failing_check' | 'actual_usd'>>;

export type AgentEventType =
  | 'start'
  | 'tool_call'
  | 'tool_result'
  | 'message'
  | 'gate_pass'
  | 'gate_fail'
  | 'ship'
  | 'revert'
  | 'error';

export interface DeployInput {
  folder: CardFolder;
  sha: string;
  netlify_deploy_id: string | null;
  is_green: boolean;
  smoke_result: string;
}

// What the studio key has spent: every studio and overhead ledger row, and those since a moment.
export interface StudioSpend {
  totalUsd: number;
  sinceUsd: number;
}

export interface Db {
  getStudioState(): Promise<StudioState>;
  // Pauses the studio, as the board's pause does; a studio already paused keeps who paused it.
  pauseStudio(by: string, now: Date): Promise<void>;
  // The dispatcher lease (claim_dispatcher_lease): true while this holder has it, renewed for
  // ttlSeconds on every claim. Only the holder ticks.
  claimLease(holder: string, ttlSeconds: number): Promise<boolean>;
  releaseLease(holder: string): Promise<void>;
  // Every tick writes studio_state.dispatcher_seen_at so /board can show how long ago the
  // dispatcher was alive.
  dispatcherHeartbeat(now: Date): Promise<void>;
  getPool(): Promise<Pool>;
  boardSessionActive(ttlMinutes: number, now: Date): Promise<boolean>;
  listFundedCards(): Promise<Card[]>;
  listCardsInStages(stages: string[]): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  claimCard(id: string): Promise<Card | null>;
  updateCard(id: string, patch: CardPatch): Promise<void>;
  // Writes the patch only while the card is in one of the expected stages; false when it was not,
  // so a stage the board set in the meantime is never overwritten.
  updateCardIf(id: string, expectedStages: readonly string[], patch: CardPatch): Promise<boolean>;
  // Each card's studio-billed spend (public_card_spend), for the cards named; a card with none is absent.
  cardSpend(cardIds: readonly string[]): Promise<Map<string, number>>;
  // The Console credit the board has recorded buying (credit_purchases).
  creditPurchasedUsd(): Promise<number>;
  studioSpend(since: Date): Promise<StudioSpend>;
  getRole(id: string): Promise<Role>;
  // Roles that are not retired.
  listActiveRoles(): Promise<Role[]>;
  recordUsage(input: UsageInput): Promise<RecordUsageResult>;
  sumLedger(cardId: string): Promise<number>;
  insertEvent(cardId: string, roleId: string | null, type: AgentEventType, payload: Record<string, unknown>): Promise<void>;
  // The payload of the card's newest event whose payload step is the given one, or null.
  findEvent(cardId: string, step: string): Promise<Record<string, unknown> | null>;
  insertDeploy(input: DeployInput): Promise<void>;
  lastGreen(folder: CardFolder): Promise<Deploy | null>;
}

type Row = Record<string, unknown>;

function num(row: Row, key: string): number {
  const value = row[key];
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`db: column ${key} is not numeric`);
  return parsed;
}

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function optionalText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

export function toCard(row: Row): Card {
  return {
    id: text(row, 'id'),
    bucket: text(row, 'bucket'),
    source: text(row, 'source'),
    shape: text(row, 'shape'),
    lane: text(row, 'lane') as CardLane,
    priority: num(row, 'priority'),
    folder: text(row, 'folder') as CardFolder,
    executor_role_id: optionalText(row, 'executor_role_id'),
    title: text(row, 'title'),
    intent: optionalText(row, 'intent'),
    acceptance_test: optionalText(row, 'acceptance_test'),
    design_spec_url: optionalText(row, 'design_spec_url'),
    estimate_usd: num(row, 'estimate_usd'),
    actual_usd: num(row, 'actual_usd'),
    funded_usd: num(row, 'funded_usd'),
    horizon: text(row, 'horizon') || 'now',
    severity: optionalText(row, 'severity'),
    director_stance: text(row, 'director_stance'),
    stage: text(row, 'stage'),
    branch: optionalText(row, 'branch'),
    commit_sha: optionalText(row, 'commit_sha'),
    failing_check: optionalText(row, 'failing_check'),
    created_at: text(row, 'created_at'),
  };
}

function toRole(row: Row): Role {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    title: text(row, 'title'),
    model: text(row, 'model'),
    prompt_path: text(row, 'prompt_path'),
    tools_json: row.tools_json,
    write_access: row.write_access === true,
  };
}

function toDeploy(row: Row): Deploy {
  return {
    id: text(row, 'id'),
    folder: text(row, 'folder') as CardFolder,
    sha: text(row, 'sha'),
    netlify_deploy_id: optionalText(row, 'netlify_deploy_id'),
    is_green: row.is_green === true,
    smoke_result: optionalText(row, 'smoke_result'),
    created_at: text(row, 'created_at'),
  };
}

function fail(op: string, error: { message: string } | null): never {
  throw new Error(`db ${op}: ${error?.message ?? 'no row'}`);
}

// Every Supabase request gives up after this long, so a hung connection cannot hold a session's
// settle past the dispatcher's shutdown wait.
export const SUPABASE_TIMEOUT_MS = 8000;

// Wraps fetch so the request aborts after timeoutMs, or when the caller's own signal aborts,
// whichever comes first, and the promise rejects then even if the underlying fetch never settles.
export function fetchWithTimeout(fetchFn: typeof fetch, timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error(`request aborted: ${String(signal.reason)}`));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      fetchFn(input, { ...init, signal })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
    });
  };
}

// Rows per page when a read needs every row.
export const PAGE_ROWS = 1000;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export interface SupabaseDbOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export function createSupabaseDb(url: string, serviceRoleKey: string, options: SupabaseDbOptions = {}): Db {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout(options.fetchFn ?? fetch, options.timeoutMs ?? SUPABASE_TIMEOUT_MS) },
  });
  const rows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);
  // Reads every row of a query PAGE_ROWS at a time, since PostgREST caps each answer.
  const pages = async (query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, op: string): Promise<Row[]> => {
    const all: Row[] = [];
    for (let from = 0; ; from += PAGE_ROWS) {
      const { data, error } = await query(from, from + PAGE_ROWS - 1);
      if (error) fail(op, error);
      const page = rows(data);
      all.push(...page);
      if (page.length < PAGE_ROWS) return all;
    }
  };

  return {
    async getStudioState() {
      const { data, error } = await client.from('studio_state').select('*').eq('id', 1).single();
      if (error || !data) fail('studio_state', error);
      const row = data as Row;
      return {
        paused: row.paused === true,
        agent_mode: text(row, 'agent_mode'),
        daily_cap_usd: num(row, 'daily_cap_usd'),
        card_max_usd: num(row, 'card_max_usd'),
        agent_hourly_rate_usd: num(row, 'agent_hourly_rate_usd'),
        studio_reserve_usd: num(row, 'studio_reserve_usd'),
        monthly_cap_usd: row.monthly_cap_usd === null || row.monthly_cap_usd === undefined ? null : num(row, 'monthly_cap_usd'),
      };
    },

    async pauseStudio(by, now) {
      const { error } = await client.from('studio_state').update({ paused: true, paused_by: by, paused_at: now.toISOString() }).eq('id', 1).eq('paused', false);
      if (error) fail('studio_state pause', error);
    },

    async claimLease(holder, ttlSeconds) {
      const { data, error } = await client.rpc('claim_dispatcher_lease', { p_holder: holder, p_ttl_seconds: ttlSeconds });
      if (error) fail('claim_dispatcher_lease', error);
      return data === true;
    },

    async releaseLease(holder) {
      const { error } = await client.rpc('release_dispatcher_lease', { p_holder: holder });
      if (error) fail('release_dispatcher_lease', error);
    },

    async dispatcherHeartbeat(now) {
      const { error } = await client.from('studio_state').update({ dispatcher_seen_at: now.toISOString() }).eq('id', 1);
      if (error) fail('studio_state heartbeat', error);
    },

    async getPool() {
      const { data, error } = await client.from('pool').select('*').eq('id', 1).single();
      if (error || !data) fail('pool', error);
      const row = data as Row;
      return {
        balance_usd: num(row, 'balance_usd'),
        reserve_usd: num(row, 'reserve_usd'),
        incident_reserve_usd: num(row, 'incident_reserve_usd'),
        daily_spent_usd: num(row, 'daily_spent_usd'),
        day: text(row, 'day'),
      };
    },

    // Only a board member's heartbeat counts. A moderator can be signed in to /board, but an
    // attended session runs on the founder's subscription and needs the board present.
    async boardSessionActive(ttlMinutes, now) {
      const since = new Date(now.getTime() - ttlMinutes * 60_000).toISOString();
      const { data, error } = await client.from('board_members').select('email').eq('role', 'board').gte('last_seen_at', since).limit(1);
      if (error) fail('board_members', error);
      return rows(data).length > 0;
    },

    async listFundedCards() {
      const { data, error } = await client.from('cards').select('*').eq('stage', 'funded');
      if (error) fail('cards funded', error);
      return rows(data).map(toCard);
    },

    async listCardsInStages(stages) {
      const { data, error } = await client.from('cards').select('*').in('stage', stages);
      if (error) fail('cards by stage', error);
      return rows(data).map(toCard);
    },

    async getCard(id) {
      const { data, error } = await client.from('cards').select('*').eq('id', id).maybeSingle();
      if (error) fail('card', error);
      return data ? toCard(data as Row) : null;
    },

    // The claim is one conditional UPDATE: only a card still in stage funded moves to building,
    // so two dispatchers racing for the same card cannot both win. commit_sha is cleared, so a sha
    // from an earlier run never marks this run as merged.
    async claimCard(id) {
      const { data, error } = await client.from('cards').update({ stage: 'building', commit_sha: null }).eq('id', id).eq('stage', 'funded').select('*');
      if (error) fail('claim card', error);
      const claimed = rows(data);
      return claimed.length === 1 ? toCard(claimed[0] as Row) : null;
    },

    async updateCard(id, patch) {
      const { error } = await client.from('cards').update(patch).eq('id', id);
      if (error) fail('update card', error);
    },

    async updateCardIf(id, expectedStages, patch) {
      const { data, error } = await client.from('cards').update(patch).eq('id', id).in('stage', [...expectedStages]).select('id');
      if (error) fail('update card', error);
      return rows(data).length === 1;
    },

    async cardSpend(cardIds) {
      const spend = new Map<string, number>();
      if (cardIds.length === 0) return spend;
      const { data, error } = await client.from('public_card_spend').select('card_id, spent_usd').in('card_id', [...cardIds]);
      if (error) fail('public_card_spend', error);
      for (const row of rows(data)) spend.set(text(row, 'card_id'), num(row, 'spent_usd'));
      return spend;
    },

    async creditPurchasedUsd() {
      const all = await pages((from, to) => client.from('credit_purchases').select('amount_usd').order('created_at').order('id').range(from, to), 'credit_purchases');
      return round4(all.reduce((total, row) => total + num(row, 'amount_usd'), 0));
    },

    async studioSpend(since) {
      const all = await pages(
        (from, to) => client.from('ledger').select('usd, created_at').in('billed_to', ['studio', 'overhead']).order('created_at').order('id').range(from, to),
        'ledger studio spend',
      );
      const start = since.getTime();
      let totalUsd = 0;
      let sinceUsd = 0;
      for (const row of all) {
        const usd = num(row, 'usd');
        totalUsd += usd;
        if (Date.parse(text(row, 'created_at')) >= start) sinceUsd += usd;
      }
      return { totalUsd: round4(totalUsd), sinceUsd: round4(sinceUsd) };
    },

    async getRole(id) {
      const { data, error } = await client.from('roles').select('*').eq('id', id).single();
      if (error || !data) fail('role', error);
      return toRole(data as Row);
    },

    async listActiveRoles() {
      const { data, error } = await client.from('roles').select('*').eq('state', 'active');
      if (error) fail('roles active', error);
      return rows(data).map(toRole);
    },

    async recordUsage(input) {
      const { data, error } = await client.rpc('record_usage', {
        p_card_id: input.card_id,
        p_role_id: input.role_id,
        p_model: input.model,
        p_input_tokens: input.input_tokens,
        p_cached_tokens: input.cached_tokens,
        p_output_tokens: input.output_tokens,
        p_usd: input.usd,
        p_billed_to: input.billed_to,
        p_request_id: input.request_id,
      });
      if (error || !data) fail('record_usage', error);
      const row = data as Row;
      return {
        ledger_id: text(row, 'ledger_id'),
        balance_usd: num(row, 'balance_usd'),
        daily_spent_usd: num(row, 'daily_spent_usd'),
        actual_usd: num(row, 'actual_usd'),
      };
    },

    async sumLedger(cardId) {
      const { data, error } = await client.from('ledger').select('usd').eq('card_id', cardId);
      if (error) fail('ledger sum', error);
      return round4(rows(data).reduce((total, row) => total + num(row, 'usd'), 0));
    },

    async insertEvent(cardId, roleId, type, payload) {
      const { error } = await client.from('agent_events').insert({ card_id: cardId, role_id: roleId, type, payload_json: payload });
      if (error) fail('agent_events insert', error);
    },

    async findEvent(cardId, step) {
      const { data, error } = await client
        .from('agent_events')
        .select('payload_json')
        .eq('card_id', cardId)
        .eq('payload_json->>step', step)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) fail('agent_events find', error);
      const row = rows(data)[0];
      const payload = row?.payload_json;
      return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
    },

    async insertDeploy(input) {
      const { error } = await client.from('deploys').insert(input);
      if (error) fail('deploys insert', error);
    },

    async lastGreen(folder) {
      const { data, error } = await client.from('last_green').select('*').eq('folder', folder).limit(1).maybeSingle();
      if (error) fail('last_green', error);
      return data ? toDeploy(data as Row) : null;
    },

  };
}
