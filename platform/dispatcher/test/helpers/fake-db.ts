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
  DraftFields,
  EnqueueInput,
  Job,
  JobRun,
  OpenCardRow,
  PostKind,
  ReportPost,
  ShipPost,
  Pool,
  RankingMove,
  RecordUsageResult,
  Role,
  StudioState,
  UsageInput,
  VisualApprovalInput,
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
    review_rounds: 0,
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

// A draft as card_drafts keeps it (20260924400000_agent_workflows.sql).
export interface FakeDraft {
  id: string;
  job_run_id: string | null;
  role_id: string;
  fields: DraftFields;
  content_sha256: string;
  status: 'drafted' | 'approved' | 'withdrawn';
  reason_codes: string[];
  maker_ref: string;
  grader_ref: string | null;
  card_id: string | null;
}

// A card approval_card_draft inserted, as the handler tests read it.
export interface FakeDraftCard {
  id: string;
  draft_id: string;
  approver_role_id: string;
  grader_ref: string;
  verdict: Record<string, unknown>;
  content_sha256: string;
}

// A job run as job_runs keeps it.
export interface FakeJobRun extends JobRun {
  idem_key: string;
  reason: string | null;
  output: Record<string, unknown> | null;
  holder: string | null;
}

// An outbound_posts row (20260925100000_reports_supply.sql).
export interface FakePost {
  kind: PostKind;
  ref: string;
  state: 'sending' | 'posted' | 'failed' | 'skipped';
  status: number | null;
  message_id: string | null;
  skip_reason: string | null;
}

// A card gone live as the outbound lane reads it, with its live time.
export function shipPost(overrides: Partial<ShipPost> = {}): ShipPost {
  return {
    id: '7d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6',
    title: 'Gatherers cost one more',
    live_at: '2026-09-14T14:30:00.000Z',
    role_name: 'Builder A',
    cost_usd: 0.29,
    supporters: [
      { number: 1, founding: true },
      { number: 3, founding: false },
    ],
    supporter_count: 4,
    ...overrides,
  };
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
  // The stages each listCardsInStages call asked for.
  stagesRead: string[][] = [];
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
  // The role jobs (docs/specs/agent-workflows.md): the open cards the handlers read, the drafts, the
  // cards approval inserted, the rankings applied, and the failure an RPC is set to raise.
  openCardRows: OpenCardRow[] = [];
  // Cards a payment on hold names: card_money_held is true for them though their bar may be empty.
  heldCardIds = new Set<string>();
  drafts: FakeDraft[] = [];
  draftCards: FakeDraftCard[] = [];
  rankings: Array<{ runId: string; order: string[]; moves: RankingMove[] }> = [];
  rpcError: Partial<Record<'recordCardDraft' | 'approveCardDraft' | 'withdrawCardDraft' | 'applyCardRanking', Error>> = {};
  // The outbound lane (docs/specs/studio-reports.md): the kill switch, the cards gone live, the
  // published reports newest first, the outbox rows and every outbox call, in order.
  killSwitchFired = false;
  liveCards: ShipPost[] = [];
  reports: ReportPost[] = [];
  posts: FakePost[] = [];
  outboxCalls: string[] = [];

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
  // dispatcher_cards holds every stage (agent_system_test.ts reads a card at each one), so the fake
  // filters by the stages asked for alone; the executor's pause is read from its role, as the view
  // joins it.
  async listCardsInStages(stages: string[]) {
    this.stagesRead.push([...stages]);
    return this.cards
      .filter((c) => stages.includes(c.stage))
      .map((c) => ({ ...c, executor_paused: c.executor_paused || this.roles.some((r) => r.id === c.executor_role_id && r.paused) }));
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
    if (status !== 'succeeded' && (reason === null || reason.trim() === '')) throw new Error('db finish_job_run: A failed or skipped run needs a reason');
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
  async openCards() {
    return this.openCardRows.map((row) => ({ ...row }));
  }
  // rankable_cards: on now, open for funding, and no money on the bar or on hold, in funding order.
  async rankableCards() {
    return this.openCardRows
      .filter((row) => row.horizon === 'now' && ['proposed', 'designing', 'voted'].includes(row.stage) && row.funded_usd === 0 && !this.heldCardIds.has(row.id))
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
      .map((row) => row.id);
  }
  async recordCardDraft(runId: string | null, roleId: string, fields: DraftFields, makerRef: string) {
    if (this.rpcError.recordCardDraft) throw this.rpcError.recordCardDraft;
    // As card_from_draft refuses: blank text after trimming, or an estimate that rounds to 0 at 4 places.
    for (const key of ['title', 'summary', 'intent', 'acceptance_test'] as const) {
      if (fields[key].trim() === '') throw new Error(`db record_card_draft: A draft needs its ${key}`);
    }
    if (!(Math.round(fields.estimate_usd * 10_000) / 10_000 > 0)) throw new Error('db record_card_draft: The estimate must be above zero');
    const id = `draft-${this.drafts.length + 1}`;
    const content_sha256 = `sha-${JSON.stringify(fields)}`;
    this.drafts.push({ id, job_run_id: runId, role_id: roleId, fields: { ...fields }, content_sha256, status: 'drafted', reason_codes: [], maker_ref: makerRef, grader_ref: null, card_id: null });
    return { id, content_sha256 };
  }
  async approveCardDraft(draftId: string, approverRoleId: string, graderRef: string, verdict: Record<string, unknown>) {
    if (this.rpcError.approveCardDraft) throw this.rpcError.approveCardDraft;
    const draft = this.drafts.find((d) => d.id === draftId);
    if (!draft || draft.status !== 'drafted') throw new Error(`db approve_card_draft: Draft ${draftId} is not drafted`);
    if (verdict.result !== 'approved') throw new Error('db approve_card_draft: Only an approved verdict approves a draft');
    if (graderRef === draft.maker_ref) throw new Error('db approve_card_draft: The grader ref must differ from the maker ref');
    if (approverRoleId === draft.role_id || approverRoleId === draft.fields.executor_role_id) throw new Error("db approve_card_draft: The approver cannot be the card's proposer, drafter or executor");
    const cardId = `card-from-${draftId}`;
    this.draftCards.push({ id: cardId, draft_id: draftId, approver_role_id: approverRoleId, grader_ref: graderRef, verdict: { ...verdict }, content_sha256: draft.content_sha256 });
    draft.status = 'approved';
    draft.grader_ref = graderRef;
    draft.card_id = cardId;
    return cardId;
  }
  // The visual review (docs/specs/design-review.md): record_review_round on the card's own count, and
  // the visual approvals record_card_approval wrote, refused as Postgres refuses them for a grader
  // ref equal to the maker ref, one already used, or an approver who executes the card.
  approvals: Array<VisualApprovalInput & { kind: 'visual' }> = [];
  async recordReviewRound(cardId: string) {
    const found = this.cards.find((c) => c.id === cardId);
    if (!found) throw new Error(`db record_review_round: Card ${cardId} does not exist`);
    found.review_rounds += 1;
    return found.review_rounds;
  }
  async recordVisualApproval(input: VisualApprovalInput) {
    const found = this.cards.find((c) => c.id === input.cardId);
    if (!found) throw new Error(`db record_card_approval: Card ${input.cardId} does not exist`);
    if (input.graderRef.trim() === '') throw new Error('db record_card_approval: A grader ref is required');
    if (input.makerRef !== null && input.graderRef.trim() === input.makerRef.trim()) throw new Error('db record_card_approval: The grader ref must differ from the maker ref');
    if (this.approvals.some((a) => a.graderRef === input.graderRef)) throw new Error(`db record_card_approval: The grader ref ${input.graderRef} is already used`);
    if (input.approverRoleId === found.executor_role_id) throw new Error("db record_card_approval: The approver cannot be the card's proposer, drafter or executor");
    this.approvals.push({ ...input, kind: 'visual' });
    return `approval-${this.approvals.length}`;
  }
  async withdrawCardDraft(draftId: string, reasonCodes: readonly string[]) {
    if (this.rpcError.withdrawCardDraft) throw this.rpcError.withdrawCardDraft;
    const draft = this.drafts.find((d) => d.id === draftId);
    if (!draft || draft.status !== 'drafted') throw new Error(`db withdraw_card_draft: Draft ${draftId} is not drafted`);
    if (reasonCodes.length === 0) throw new Error('db withdraw_card_draft: A withdrawal names at least one reason code');
    draft.status = 'withdrawn';
    draft.reason_codes = [...reasonCodes];
  }
  // apply_card_ranking, for ranked cards: the named cards trade the ranks they hold, in the order
  // given, and a card holding money is refused. The PGlite test covers unranked cards, ties and the
  // ten-change cut (agent_workflows_test.ts).
  async applyCardRanking(runId: string, order: readonly string[]) {
    if (this.rpcError.applyCardRanking) throw this.rpcError.applyCardRanking;
    const cards = order.map((id) => {
      const card = this.openCardRows.find((row) => row.id === id);
      if (!card) throw new Error(`db apply_card_ranking: Card ${id} does not exist`);
      if (card.funded_usd !== 0 || this.heldCardIds.has(id)) throw new Error(`db apply_card_ranking: Card ${id} holds money`);
      if (card.rank === null) throw new Error('FakeDb: rank unranked cards on PGlite, not here');
      return card;
    });
    const places = cards.map((card) => card.rank!).sort((a, b) => a - b);
    const moves: RankingMove[] = [];
    cards.forEach((card, index) => {
      if (card.rank === places[index]) return;
      moves.push({ card_id: card.id, from: card.rank, to: places[index]! });
      card.rank = places[index]!;
    });
    this.rankings.push({ runId, order: [...order], moves });
    return { moves, unapplied: 0 };
  }
  async postingStop() {
    this.outboxCalls.push('postingStop');
    if (this.killSwitchFired) return 'kill_switch' as const;
    return this.studio.paused ? ('paused' as const) : null;
  }
  async unpostedShips(since: Date, limit: number) {
    this.outboxCalls.push('unpostedShips');
    const done = new Set(this.posts.filter((post) => post.kind === 'ship').map((post) => post.ref));
    return this.liveCards
      .filter((c) => Date.parse(c.live_at) >= since.getTime() && !done.has(c.id))
      .sort((a, b) => Date.parse(a.live_at) - Date.parse(b.live_at))
      .slice(0, limit)
      .map((c) => ({ ...c, supporters: c.supporters.slice(0, 3) }));
  }
  async unpostedReport() {
    this.outboxCalls.push('unpostedReport');
    const newest = [...this.reports].sort((a, b) => b.week_start.localeCompare(a.week_start))[0];
    if (!newest || this.posts.some((post) => post.kind === 'weekly' && post.ref === newest.week_start)) return null;
    return { ...newest };
  }
  async claimPost(kind: PostKind, ref: string, state: 'sending' | 'skipped', skipReason: string | null) {
    this.outboxCalls.push(`claim:${kind}:${ref}:${state}`);
    if (this.posts.some((post) => post.kind === kind && post.ref === ref)) return false;
    this.posts.push({ kind, ref, state, status: null, message_id: null, skip_reason: skipReason });
    return true;
  }
  async finishPost(kind: PostKind, ref: string, result: { state: 'posted' | 'failed'; status: number | null; messageId: string | null }) {
    this.outboxCalls.push(`finish:${kind}:${ref}:${result.state}`);
    const post = this.posts.find((p) => p.kind === kind && p.ref === ref && p.state === 'sending');
    if (!post) return;
    post.state = result.state;
    post.status = result.status;
    post.message_id = result.messageId;
  }
  async lastGreen(folder: Deploy['folder']): Promise<Deploy | null> {
    const green = this.deploys.filter((d) => d.folder === folder && d.is_green);
    return green.length > 0 ? { ...green[green.length - 1]! } : null;
  }
}
