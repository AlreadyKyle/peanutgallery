// In-memory database for tick, session and pipeline tests. Its claim rule matches the SQL
// (only a funded card moves to building) and record_usage applies the same arithmetic as the
// RPC: one ledger row per request id, balance and daily spend moved for studio rows only, actual_usd
// added up for both.
import type {
  AgentEventType,
  Card,
  CardPatch,
  Db,
  Deploy,
  DeployInput,
  Pool,
  RecordUsageResult,
  Role,
  StudioState,
  UsageInput,
} from '../../src/db.js';
import { round4 } from '../../src/pricing.js';

export const NOW = new Date('2026-09-14T15:00:00.000Z');

export function card(overrides: Partial<Card> = {}): Card {
  return {
    id: '4c2f5a1e-7b3d-4e8a-9f01-2a3b4c5d6e7f',
    bucket: 'game',
    source: 'board',
    shape: 'oneoff',
    lane: 'config',
    priority: 100,
    folder: 'seed-1',
    executor_role_id: 'role-builder-a',
    title: 'spawn table row gatherer: baseCost changes from 10 to 11',
    intent: 'Raise the gatherer base cost by one.',
    acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11',
    design_spec_url: null,
    estimate_usd: 2,
    actual_usd: 0,
    severity: null,
    director_stance: 'neutral',
    stage: 'funded',
    branch: null,
    commit_sha: null,
    failing_check: null,
    created_at: '2026-09-14T14:00:00.000Z',
    ...overrides,
  };
}

export function role(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-builder-a',
    name: 'Builder A',
    title: 'Builder A',
    model: 'builder-class',
    prompt_path: 'platform/agents/prompts/builder-a.md',
    tools_json: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
    write_access: true,
    ...overrides,
  };
}

export interface LedgerRow extends UsageInput {
  id: string;
}

export interface EventRow {
  card_id: string;
  role_id: string | null;
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export class FakeDb implements Db {
  studio: StudioState = { paused: false, agent_mode: 'attended', daily_cap_usd: 100, card_max_usd: 25, agent_hourly_rate_usd: 5, studio_reserve_usd: 0 };
  pool: Pool = { balance_usd: 50, reserve_usd: 0, incident_reserve_usd: 0, daily_spent_usd: 0, day: '2026-09-14' };
  boardActive = true;
  cards: Card[] = [];
  roles: Role[] = [role()];
  ledger: LedgerRow[] = [];
  events: EventRow[] = [];
  deploys: Deploy[] = [];
  claims = 0;
  heartbeats: Date[] = [];
  heartbeatError: Error | null = null;

  async getStudioState() {
    return { ...this.studio };
  }
  async dispatcherHeartbeat(now: Date) {
    if (this.heartbeatError) throw this.heartbeatError;
    this.heartbeats.push(now);
  }
  async getPool() {
    return { ...this.pool };
  }
  async boardSessionActive() {
    return this.boardActive;
  }
  async listFundedCards() {
    return this.cards.filter((c) => c.stage === 'funded').map((c) => ({ ...c }));
  }
  async listCardsInStages(stages: string[]) {
    return this.cards.filter((c) => stages.includes(c.stage)).map((c) => ({ ...c }));
  }
  async claimCard(id: string) {
    this.claims += 1;
    const found = this.cards.find((c) => c.id === id && c.stage === 'funded');
    if (!found) return null;
    found.stage = 'building';
    return { ...found };
  }
  async updateCard(id: string, patch: CardPatch) {
    const found = this.cards.find((c) => c.id === id);
    if (found) Object.assign(found, patch);
  }
  async getRole(id: string): Promise<Role> {
    const found = this.roles.find((r) => r.id === id);
    if (!found) throw new Error(`db role: no row for ${id}`);
    return { ...found };
  }
  async listActiveRoles() {
    return this.roles.map((r) => ({ ...r }));
  }
  async recordUsage(input: UsageInput): Promise<RecordUsageResult> {
    // A request id already written returns that row and changes nothing, as record_usage does.
    const existing = input.request_id === null ? undefined : this.ledger.find((row) => row.request_id === input.request_id);
    if (existing) {
      const card = existing.card_id === null ? undefined : this.cards.find((c) => c.id === existing.card_id);
      return { ledger_id: existing.id, balance_usd: this.pool.balance_usd, daily_spent_usd: this.pool.daily_spent_usd, actual_usd: card?.actual_usd ?? 0 };
    }
    const id = `ledger-${this.ledger.length + 1}`;
    this.ledger.push({ id, ...input });
    if (input.billed_to === 'studio') {
      this.pool.balance_usd = round4(this.pool.balance_usd - input.usd);
      this.pool.daily_spent_usd = round4(this.pool.daily_spent_usd + input.usd);
    }
    const found = input.card_id === null ? undefined : this.cards.find((c) => c.id === input.card_id);
    if (found) found.actual_usd = round4(found.actual_usd + input.usd);
    return { ledger_id: id, balance_usd: this.pool.balance_usd, daily_spent_usd: this.pool.daily_spent_usd, actual_usd: found?.actual_usd ?? 0 };
  }
  async sumLedger(cardId: string) {
    return round4(this.ledger.filter((row) => row.card_id === cardId).reduce((total, row) => total + row.usd, 0));
  }
  async insertEvent(cardId: string, roleId: string | null, type: AgentEventType, payload: Record<string, unknown>) {
    this.events.push({ card_id: cardId, role_id: roleId, type, payload });
  }
  async insertDeploy(input: DeployInput) {
    this.deploys.push({ id: `deploy-${this.deploys.length + 1}`, created_at: new Date(NOW.getTime() + this.deploys.length * 1000).toISOString(), ...input });
  }
  async lastGreen(folder: Deploy['folder']): Promise<Deploy | null> {
    const green = this.deploys.filter((d) => d.folder === folder && d.is_green);
    return green.length > 0 ? { ...green[green.length - 1]! } : null;
  }
}
