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
  // The monthly cap of the studio organisation's Anthropic usage tier, as the board reported it; null
  // when unset or when studio_state has no such column, which adds no bound (throttle.ts).
  anthropic_tier_cap_usd: number | null;
  // Whether the platform code lane is open (select.ts, docs/specs/board-site.md); false when unset or
  // when studio_state has no such column.
  platform_lane_open: boolean;
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
  // From dispatcher_cards (docs/specs/agent-system-core.md): whether an agent wrote any of the card,
  // whether its approval is current, the board's veto and whether its executor role is paused. A
  // card read from cards itself carries the veto and reads the other three as false.
  needs_approval: boolean;
  approved: boolean;
  board_vetoed: boolean;
  executor_paused: boolean;
}

export interface Role {
  id: string;
  name: string;
  title: string;
  model: string;
  prompt_path: string;
  tools_json: unknown;
  write_access: boolean;
  // The role's trust class (writer, planner, reviewer, read_only, web_only); null before the seed.
  agent_class: string | null;
  // Paused by the board or the moderator: it starts nothing, and its running work stops.
  paused: boolean;
}

// A job the queue runs (public.jobs): its role, whether it calls a model, and whether it runs
// while the studio is paused.
export interface Job {
  name: string;
  role_id: string | null;
  calls_model: boolean;
  runs_when_paused: boolean;
}

export type JobOrigin = 'board' | 'schedule' | 'event' | 'operator';
export type JobRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface JobRun {
  id: string;
  job_name: string;
  origin: JobOrigin;
  status: JobRunStatus;
  card_id: string | null;
  input: Record<string, unknown>;
  parent_run_id: string | null;
  created_at: string;
}

export interface EnqueueInput {
  job: string;
  origin: JobOrigin;
  key?: string | null;
  cardId?: string | null;
  input?: Record<string, unknown>;
  parentRunId?: string | null;
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

// The Console credit bought and what the studio key has spent against it, summed in the database by
// studio_spend_totals (20260923000100_spend_totals.sql), so a tick reads four numbers instead of the
// whole ledger.
export interface SpendTotals {
  // Every credit_purchases row.
  creditPurchasedUsd: number;
  // Every studio and overhead ledger row ever written.
  spentUsd: number;
  // Those rows since the month start the throttle's monthly cap counts from (New York).
  monthUsd: number;
  // Those rows since the start of the usage tier's month as the throttle counts it (tierMonthStart).
  tierUsd: number;
}

// A card on now or next as the role jobs read it (docs/specs/agent-workflows.md). The handlers pass it
// through a typed reduction before any prompt sees it: a community-sourced card keeps its id, stage,
// horizon, bucket and funded amount only.
export interface OpenCardRow {
  id: string;
  source: string;
  bucket: string;
  lane: string;
  folder: string;
  stage: string;
  horizon: string;
  rank: number | null;
  title: string;
  summary: string | null;
  funding_target_usd: number;
  funded_usd: number;
}

// The card fields a draft carries into record_card_draft: the card as approval inserts it, apart
// from what approval sets itself (20260924400000_agent_workflows.sql).
export interface DraftFields {
  title: string;
  summary: string;
  intent: string;
  acceptance_test: string;
  lane: CardLane;
  executor_role_id: string | null;
  estimate_usd: number;
}

export interface RankingMove {
  card_id: string;
  from: number | null;
  to: number;
}

// Why the studio is paused (studio_state.pause_reason): Console credit needed, the usage tier cap,
// an incident (a failed revert), or the board's own pause.
export type PauseReason = 'awaiting_credit' | 'spend_limit' | 'incident' | 'board';

export interface Db {
  getStudioState(): Promise<StudioState>;
  // Pauses the studio, as the board's pause does, with the reason the public sees
  // (studio_state.pause_reason, docs/specs/money-logic.md); a studio already paused keeps who
  // paused it and why.
  pauseStudio(by: string, now: Date, reason: PauseReason): Promise<void>;
  // The dispatcher lease (claim_dispatcher_lease): true while this holder has it, renewed for
  // ttlSeconds on every claim. Only the holder ticks.
  claimLease(holder: string, ttlSeconds: number): Promise<boolean>;
  releaseLease(holder: string): Promise<void>;
  // Every tick writes studio_state.dispatcher_seen_at so /board can show how long ago the
  // dispatcher was alive.
  dispatcherHeartbeat(now: Date): Promise<void>;
  getPool(): Promise<Pool>;
  boardSessionActive(ttlMinutes: number, now: Date): Promise<boolean>;
  // The cards at the stages asked for, from dispatcher_cards, which holds every stage: a tick asks for
  // the hold stages and building, startup recovery for building and gated.
  listCardsInStages(stages: string[]): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  claimCard(id: string): Promise<Card | null>;
  updateCard(id: string, patch: CardPatch): Promise<void>;
  // Writes the patch only while the card is in one of the expected stages; false when it was not,
  // so a stage the board set in the meantime is never overwritten.
  updateCardIf(id: string, expectedStages: readonly string[], patch: CardPatch): Promise<boolean>;
  // Each card's studio-billed spend (public_card_spend), for the cards named; a card with none is absent.
  cardSpend(cardIds: readonly string[]): Promise<Map<string, number>>;
  spendTotals(monthStart: Date, tierStart: Date): Promise<SpendTotals>;
  getRole(id: string): Promise<Role>;
  // Roles that are not retired.
  listActiveRoles(): Promise<Role[]>;
  recordUsage(input: UsageInput): Promise<RecordUsageResult>;
  // Every ledger row of the card, whoever it was billed to (card_ledger_usd).
  sumLedger(cardId: string): Promise<number>;
  insertEvent(cardId: string, roleId: string | null, type: AgentEventType, payload: Record<string, unknown>): Promise<void>;
  // The payload of the card's newest event whose payload step is the given one, or null.
  findEvent(cardId: string, step: string): Promise<Record<string, unknown> | null>;
  insertDeploy(input: DeployInput): Promise<void>;
  lastGreen(folder: CardFolder): Promise<Deploy | null>;
  // Deals every approved agent card whose cooling window has passed to now (deal_due_cards); the
  // ids dealt.
  dealDueCards(): Promise<string[]>;
  // Resumes each card paused at its ceiling for the first time whose bar covers a new ceiling
  // (resume_due_by_rule); how many resumed and each card's result.
  resumeDueByRule(): Promise<{ resumed: number; results: Record<string, unknown>[] }>;
  // The job queue (docs/specs/agent-system-core.md).
  enqueueJobRun(input: EnqueueInput): Promise<{ id: string; created: boolean }>;
  // The oldest queued runs, oldest first, up to limit.
  queuedRuns(limit: number): Promise<JobRun[]>;
  // Queued to running, only while holder holds the dispatcher lease.
  claimJobRun(runId: string, holder: string): Promise<boolean>;
  finishJobRun(runId: string, status: 'succeeded' | 'failed' | 'skipped', reason: string | null, output: Record<string, unknown> | null): Promise<void>;
  // At startup: every run still marked running, finished as failed; how many.
  failRunningJobRuns(holder: string, reason: string): Promise<number>;
  jobs(): Promise<Job[]>;
  // A role's pause and state, read each watch.
  roleState(roleId: string): Promise<{ paused: boolean; state: string }>;
  // The role jobs (docs/specs/agent-workflows.md): cards on now and next at the open stages and
  // funded, for the ranking and the Designer's context.
  openCards(): Promise<OpenCardRow[]>;
  // The cards a ranking may name (rankable_cards): on now, open for funding, and holding no money on
  // their bar or on hold, by the one test apply_card_ranking refuses on; in funding order.
  rankableCards(): Promise<string[]>;
  recordCardDraft(runId: string | null, roleId: string, fields: DraftFields, makerRef: string): Promise<{ id: string; content_sha256: string }>;
  // The card id; the approval's verdict carries the grader's reason codes.
  approveCardDraft(draftId: string, approverRoleId: string, graderRef: string, verdict: Record<string, unknown>): Promise<string>;
  withdrawCardDraft(draftId: string, reasonCodes: readonly string[]): Promise<void>;
  applyCardRanking(runId: string, order: readonly string[]): Promise<{ moves: RankingMove[]; unapplied: number }>;
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
    needs_approval: row.needs_approval === true,
    approved: row.approved === true,
    board_vetoed: row.board_vetoed === true,
    executor_paused: row.executor_paused === true,
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
    agent_class: optionalText(row, 'agent_class'),
    paused: row.paused === true,
  };
}

function toJobRun(row: Row): JobRun {
  const input = row.input;
  return {
    id: text(row, 'id'),
    job_name: text(row, 'job_name'),
    origin: text(row, 'origin') as JobOrigin,
    status: text(row, 'status') as JobRunStatus,
    card_id: optionalText(row, 'card_id'),
    input: typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {},
    parent_run_id: optionalText(row, 'parent_run_id'),
    created_at: text(row, 'created_at'),
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

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// A number the database returned, or an error naming the function: a null or missing total is never
// read as zero.
function total(row: Row, key: string, op: string): number {
  const value = row[key];
  if (value === null || value === undefined) throw new Error(`db ${op}: no ${key}`);
  return round4(num(row, key));
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
        anthropic_tier_cap_usd: row.anthropic_tier_cap_usd === null || row.anthropic_tier_cap_usd === undefined ? null : num(row, 'anthropic_tier_cap_usd'),
        platform_lane_open: row.platform_lane_open === true,
      };
    },

    async pauseStudio(by, now, reason) {
      const { error } = await client.from('studio_state').update({ paused: true, paused_by: by, paused_at: now.toISOString(), pause_reason: reason }).eq('id', 1).eq('paused', false);
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

    // dispatcher_cards: every card, with the approval, the vetoes and the executor's pause that
    // runnable() reads. The view keeps no stage list, so the stages asked for are the stages read.
    async listCardsInStages(stages) {
      const { data, error } = await client.from('dispatcher_cards').select('*').in('stage', stages);
      if (error) fail('dispatcher_cards by stage', error);
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

    async spendTotals(monthStart, tierStart) {
      const op = 'studio_spend_totals';
      const { data, error } = await client.rpc(op, { p_month_start: monthStart.toISOString(), p_tier_start: tierStart.toISOString() });
      if (error) fail(op, error);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) fail(op, null);
      const row = data as Row;
      return {
        creditPurchasedUsd: total(row, 'credit_purchased_usd', op),
        spentUsd: total(row, 'spent_usd', op),
        monthUsd: total(row, 'month_usd', op),
        tierUsd: total(row, 'tier_usd', op),
      };
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

    // Summed in the database: a select of the rows would stop at PostgREST's row cap and undercount a
    // card with more model requests than that.
    async sumLedger(cardId) {
      const op = 'card_ledger_usd';
      const { data, error } = await client.rpc(op, { p_card_id: cardId });
      if (error) fail(op, error);
      return total({ usd: data as unknown }, 'usd', op);
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

    async dealDueCards() {
      const { data, error } = await client.rpc('deal_due_cards');
      if (error) fail('deal_due_cards', error);
      return (Array.isArray(data) ? data : []).map((value) => String(typeof value === 'object' && value !== null ? Object.values(value)[0] : value));
    },

    async resumeDueByRule() {
      const { data, error } = await client.rpc('resume_due_by_rule');
      if (error) fail('resume_due_by_rule', error);
      const row = (data ?? {}) as Row;
      return { resumed: num(row, 'resumed'), results: Array.isArray(row.results) ? (row.results as Record<string, unknown>[]) : [] };
    },

    async enqueueJobRun(input) {
      const { data, error } = await client.rpc('enqueue_job_run', {
        p_job: input.job,
        p_origin: input.origin,
        p_key: input.key ?? null,
        p_card: input.cardId ?? null,
        p_input: input.input ?? {},
        p_parent: input.parentRunId ?? null,
      });
      if (error || !data) fail('enqueue_job_run', error);
      const row = data as Row;
      return { id: text(row, 'id'), created: row.created === true };
    },

    async queuedRuns(limit) {
      const { data, error } = await client.from('job_runs').select('*').eq('status', 'queued').order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit);
      if (error) fail('job_runs queued', error);
      return rows(data).map(toJobRun);
    },

    async claimJobRun(runId, holder) {
      const { data, error } = await client.rpc('claim_job_run', { p_run: runId, p_holder: holder });
      if (error) fail('claim_job_run', error);
      return data === true;
    },

    async finishJobRun(runId, status, reason, output) {
      const { error } = await client.rpc('finish_job_run', { p_run: runId, p_status: status, p_reason: reason, p_output: output });
      if (error) fail('finish_job_run', error);
    },

    async failRunningJobRuns(holder, reason) {
      const { data, error } = await client.rpc('fail_running_job_runs', { p_holder: holder, p_reason: reason });
      if (error) fail('fail_running_job_runs', error);
      return Number(data ?? 0);
    },

    async jobs() {
      const { data, error } = await client.from('jobs').select('name, role_id, calls_model, runs_when_paused');
      if (error) fail('jobs', error);
      return rows(data).map((row) => ({
        name: text(row, 'name'),
        role_id: optionalText(row, 'role_id'),
        calls_model: row.calls_model === true,
        runs_when_paused: row.runs_when_paused === true,
      }));
    },

    async roleState(roleId) {
      const { data, error } = await client.from('roles').select('paused, state').eq('id', roleId).single();
      if (error || !data) fail('role state', error);
      const row = data as Row;
      return { paused: row.paused === true, state: text(row, 'state') };
    },

    async openCards() {
      const { data, error } = await client
        .from('cards')
        .select('id, source, bucket, lane, folder, stage, horizon, rank, title, summary, funding_target_usd, funded_usd')
        .in('horizon', ['now', 'next'])
        .in('stage', ['proposed', 'designing', 'voted', 'funded'])
        .order('horizon', { ascending: true })
        .order('rank', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) fail('cards open', error);
      return rows(data).map((row) => ({
        id: text(row, 'id'),
        source: text(row, 'source'),
        bucket: text(row, 'bucket'),
        lane: text(row, 'lane'),
        folder: text(row, 'folder'),
        stage: text(row, 'stage'),
        horizon: text(row, 'horizon'),
        rank: row.rank === null || row.rank === undefined ? null : num(row, 'rank'),
        title: text(row, 'title'),
        summary: optionalText(row, 'summary'),
        funding_target_usd: num(row, 'funding_target_usd'),
        funded_usd: num(row, 'funded_usd'),
      }));
    },

    async rankableCards() {
      const { data, error } = await client.rpc('rankable_cards');
      if (error || !Array.isArray(data)) fail('rankable_cards', error);
      return (data as unknown[]).map((id) => String(id));
    },

    async recordCardDraft(runId, roleId, fields, makerRef) {
      const { data, error } = await client.rpc('record_card_draft', { p_run: runId, p_role: roleId, p_fields: fields, p_maker_ref: makerRef });
      if (error || !data) fail('record_card_draft', error);
      const row = data as Row;
      return { id: text(row, 'id'), content_sha256: text(row, 'content_sha256') };
    },

    async approveCardDraft(draftId, approverRoleId, graderRef, verdict) {
      const { data, error } = await client.rpc('approve_card_draft', { p_draft: draftId, p_approver_role: approverRoleId, p_grader_ref: graderRef, p_verdict: verdict });
      if (error || !data) fail('approve_card_draft', error);
      return String(data);
    },

    async withdrawCardDraft(draftId, reasonCodes) {
      const { error } = await client.rpc('withdraw_card_draft', { p_draft: draftId, p_reason_codes: [...reasonCodes] });
      if (error) fail('withdraw_card_draft', error);
    },

    async applyCardRanking(runId, order) {
      const { data, error } = await client.rpc('apply_card_ranking', { p_run: runId, p_order: [...order] });
      if (error || !data) fail('apply_card_ranking', error);
      const row = data as Row;
      const moves = Array.isArray(row.moves) ? (row.moves as Row[]) : [];
      return {
        moves: moves.map((move) => ({ card_id: text(move, 'card_id'), from: move.from === null || move.from === undefined ? null : num(move, 'from'), to: num(move, 'to') })),
        unapplied: num(row, 'unapplied'),
      };
    },

  };
}
