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
  EnqueueInput,
  Job,
  JobRun,
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
    funded_usd: 2,
    horizon: 'now',
    severity: null,
    director_stance: 'neutral',
    stage: 'funded',
    branch: null,
    commit_sha: null,
    failing_check: null,
    created_at: '2026-09-14T14:00:00.000Z',
    needs_approval: false,
    approved: false,
    board_vetoed: false,
    executor_paused: false,
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
    agent_class: 'writer',
    paused: false,
    ...overrides,
  };
}

export interface LedgerRow extends UsageInput {
  id: string;
  // When the row was written; a row without one counts as written now.
  created_at?: string;
}

export interface EventRow {
  card_id: string;
  role_id: string | null;
  type: AgentEventType;
  payload: Record<string, unknown>;
}

// A job run as job_runs keeps it.
export interface FakeJobRun extends JobRun {
  idem_key: string;
  reason: string | null;
  output: Record<string, unknown> | null;
  holder: string | null;
}

export class FakeDb implements Db {
  studio: StudioState = { paused: false, agent_mode: 'attended', daily_cap_usd: 100, card_max_usd: 25, agent_hourly_rate_usd: 5, studio_reserve_usd: 0, monthly_cap_usd: 500, anthropic_tier_cap_usd: null, platform_lane_open: false };
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
  // Console credit the board has recorded buying; ample by default so money tests set it.
  creditPurchased = 1000;
  // The dispatcher lease, as claim_dispatcher_lease keeps it, on the clock below.
  lease: { holder: string; expiresAt: number } | null = null;
  clock = () => NOW.getTime();
  pausedBy: string | null = null;
  pauseReason: string | null = null;
  // The job queue, as job_runs keeps it (20260924300000_agent_system_core.sql).
  jobList: Job[] = [];
  jobRuns: FakeJobRun[] = [];
  // What deal_due_cards and resume_due_by_rule answer, and how often they were called.
  dueCards: string[] = [];
  dealCalls = 0;
  dealError: Error | null = null;
  resumeResult: { resumed: number; results: Record<string, unknown>[] } = { resumed: 0, results: [] };
  resumeCalls = 0;
  resumeError: Error | null = null;

  async getStudioState() {
    return { ...this.studio };
  }
  async pauseStudio(by: string, _now: Date, reason: string) {
    if (this.studio.paused) return;
    this.studio.paused = true;
    this.pausedBy = by;
    this.pauseReason = reason;
  }
  async claimLease(holder: string, ttlSeconds: number) {
    const now = this.clock();
    if (this.lease && this.lease.holder !== holder && this.lease.expiresAt > now) return false;
    this.lease = { holder, expiresAt: now + ttlSeconds * 1000 };
    return true;
  }
  async releaseLease(holder: string) {
    if (this.lease?.holder === holder) this.lease = null;
  }
  async getCard(id: string) {
    const found = this.cards.find((c) => c.id === id);
    return found ? { ...found } : null;
  }
  async updateCardIf(id: string, expectedStages: readonly string[], patch: CardPatch) {
    const found = this.cards.find((c) => c.id === id);
    if (!found || !expectedStages.includes(found.stage)) return false;
    Object.assign(found, patch);
    return true;
  }
  async cardSpend(cardIds: readonly string[]) {
    const spend = new Map<string, number>();
    for (const row of this.ledger) {
      if (row.billed_to !== 'studio' || row.card_id === null || !cardIds.includes(row.card_id)) continue;
      spend.set(row.card_id, round4((spend.get(row.card_id) ?? 0) + row.usd));
    }
    return spend;
  }
  // The arguments of every spendTotals call, as ISO strings.
  spendTotalsCalls: [string, string][] = [];
  // studio_spend_totals: the credit bought, and the studio and overhead rows in all, since the month
  // start and since the tier month start.
  async spendTotals(monthStart: Date, tierStart: Date) {
    this.spendTotalsCalls.push([monthStart.toISOString(), tierStart.toISOString()]);
    const rows = this.ledger.filter((row) => row.billed_to === 'studio' || row.billed_to === 'overhead');
    const since = (start: Date) => round4(rows.filter((row) => (row.created_at ? Date.parse(row.created_at) : this.clock()) >= start.getTime()).reduce((total, row) => total + row.usd, 0));
    return {
      creditPurchasedUsd: this.creditPurchased,
      spentUsd: round4(rows.reduce((total, row) => total + row.usd, 0)),
      monthUsd: since(monthStart),
      tierUsd: since(tierStart),
    };
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
    found.commit_sha = null;
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
  async findEvent(cardId: string, step: string) {
    const found = [...this.events].reverse().find((e) => e.card_id === cardId && e.payload.step === step);
    return found ? { ...found.payload } : null;
  }
  async insertDeploy(input: DeployInput) {
    this.deploys.push({ id: `deploy-${this.deploys.length + 1}`, created_at: new Date(NOW.getTime() + this.deploys.length * 1000).toISOString(), ...input });
  }
  async dealDueCards() {
    this.dealCalls += 1;
    if (this.dealError) throw this.dealError;
    const dealt = [...this.dueCards];
    this.dueCards = [];
    for (const id of dealt) {
      const found = this.cards.find((c) => c.id === id);
      if (found) found.horizon = 'now';
    }
    return dealt;
  }
  async resumeDueByRule() {
    this.resumeCalls += 1;
    if (this.resumeError) throw this.resumeError;
    return this.resumeResult;
  }
  // enqueue_job_run: a key once, one queued scheduled run per job, and a board parent's origin.
  async enqueueJobRun(input: EnqueueInput) {
    const parent = input.parentRunId ? this.jobRuns.find((r) => r.id === input.parentRunId) : undefined;
    const origin = parent?.origin === 'board' ? 'board' : input.origin;
    const key = input.key ?? `${input.job}:${origin}:${this.jobRuns.length + 1}`;
    const same = this.jobRuns.find((r) => r.idem_key === key);
    if (same) return { id: same.id, created: false };
    const queuedSchedule = origin === 'schedule' ? this.jobRuns.find((r) => r.job_name === input.job && r.status === 'queued' && r.origin === 'schedule') : undefined;
    if (queuedSchedule) return { id: queuedSchedule.id, created: false };
    const run: FakeJobRun = {
      id: `run-${this.jobRuns.length + 1}`,
      job_name: input.job,
      origin,
      status: 'queued',
      card_id: input.cardId ?? null,
      input: input.input ?? {},
      parent_run_id: input.parentRunId ?? null,
      created_at: new Date(this.clock() + this.jobRuns.length).toISOString(),
      idem_key: key,
      reason: null,
      output: null,
      holder: null,
    };
    this.jobRuns.push(run);
    return { id: run.id, created: true };
  }
  async queuedRuns(limit: number) {
    return this.jobRuns
      .filter((r) => r.status === 'queued')
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({ ...r, input: { ...r.input } }));
  }
  private holdsLease(holder: string) {
    return this.lease !== null && this.lease.holder === holder && this.lease.expiresAt > this.clock();
  }
  async claimJobRun(runId: string, holder: string) {
    const run = this.jobRuns.find((r) => r.id === runId);
    if (!run || run.status !== 'queued' || !this.holdsLease(holder)) return false;
    run.status = 'running';
    run.holder = holder;
    return true;
  }
  async finishJobRun(runId: string, status: 'succeeded' | 'failed' | 'skipped', reason: string | null, output: Record<string, unknown> | null) {
    const run = this.jobRuns.find((r) => r.id === runId);
    if (!run || !(run.status === 'running' || (run.status === 'queued' && status === 'skipped'))) throw new Error(`db finish_job_run: job run ${runId} is not running`);
    run.status = status;
    run.reason = reason;
    run.output = output;
  }
  async failRunningJobRuns(holder: string, reason: string) {
    if (!this.holdsLease(holder)) throw new Error('db fail_running_job_runs: Only the dispatcher lease holder fails running job runs');
    const running = this.jobRuns.filter((r) => r.status === 'running');
    for (const run of running) {
      run.status = 'failed';
      run.reason = reason;
    }
    return running.length;
  }
  async jobs() {
    return this.jobList.map((j) => ({ ...j }));
  }
  async roleState(roleId: string) {
    const found = this.roles.find((r) => r.id === roleId);
    if (!found) throw new Error(`db role state: no row for ${roleId}`);
    return { paused: found.paused, state: 'active' };
  }
  async lastGreen(folder: Deploy['folder']): Promise<Deploy | null> {
    const green = this.deploys.filter((d) => d.folder === folder && d.is_green);
    return green.length > 0 ? { ...green[green.length - 1]! } : null;
  }
}
