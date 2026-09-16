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
export type Billing = 'studio' | 'founder';

// card_id and role_id are null for spend that belongs to no card: the startup probe.
export interface UsageInput {
  billed_to: Billing;
  card_id: string | null;
  role_id: string | null;
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  usd: number;
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

export interface Db {
  getStudioState(): Promise<StudioState>;
  // Every tick writes studio_state.dispatcher_seen_at so /board can show how long ago the
  // dispatcher was alive.
  dispatcherHeartbeat(now: Date): Promise<void>;
  getPool(): Promise<Pool>;
  boardSessionActive(ttlMinutes: number, now: Date): Promise<boolean>;
  listFundedCards(): Promise<Card[]>;
  listCardsInStages(stages: string[]): Promise<Card[]>;
  claimCard(id: string): Promise<Card | null>;
  updateCard(id: string, patch: CardPatch): Promise<void>;
  getRole(id: string): Promise<Role>;
  // Roles that are not retired.
  listActiveRoles(): Promise<Role[]>;
  recordUsage(input: UsageInput): Promise<RecordUsageResult>;
  sumLedger(cardId: string): Promise<number>;
  insertEvent(cardId: string, roleId: string | null, type: AgentEventType, payload: Record<string, unknown>): Promise<void>;
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

export function createSupabaseDb(url: string, serviceRoleKey: string): Db {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
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
      };
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

    async boardSessionActive(ttlMinutes, now) {
      const since = new Date(now.getTime() - ttlMinutes * 60_000).toISOString();
      const { data, error } = await client.from('board_members').select('email').gte('last_seen_at', since).limit(1);
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

    // The claim is one conditional UPDATE: only a card still in stage funded moves to building,
    // so two dispatchers racing for the same card cannot both win.
    async claimCard(id) {
      const { data, error } = await client.from('cards').update({ stage: 'building' }).eq('id', id).eq('stage', 'funded').select('*');
      if (error) fail('claim card', error);
      const claimed = rows(data);
      return claimed.length === 1 ? toCard(claimed[0] as Row) : null;
    },

    async updateCard(id, patch) {
      const { error } = await client.from('cards').update(patch).eq('id', id);
      if (error) fail('update card', error);
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
      return Math.round(rows(data).reduce((total, row) => total + num(row, 'usd'), 0) * 10_000) / 10_000;
    },

    async insertEvent(cardId, roleId, type, payload) {
      const { error } = await client.from('agent_events').insert({ card_id: cardId, role_id: roleId, type, payload_json: payload });
      if (error) fail('agent_events insert', error);
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
