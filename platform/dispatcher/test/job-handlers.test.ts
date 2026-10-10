// draft_card against a fake managed adapter (src/job-handlers/draft-card.ts, docs/specs/unattended-roles.md
// PR4, docs/specs/agent-workflows.md): the card is opened first; the Game Designer's rounds and the Game
// Director's grade run unattended as managed readers on main, billed to that card, with no board member
// signed in; the session budget is DRAFT_SESSION_MAX_USD within the per-card maximum and the throttle's
// money; an approved draft fills that card, a withdrawn one rejects a new card and leaves a backlog card
// as it was; every refusal, verdict and failure; and no community text in any prompt. One run goes
// through the real managed adapter against the fake Managed Agents client, to show its ledger rows.
import { Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManagedAdapter, REPO_MOUNT } from '../src/adapters/managed.js';
import type { AgentAdapter, SessionSpec } from '../src/adapters/types.js';
import { SessionBudgets } from '../src/budgets.js';
import type { DraftTarget, Job, JobOrigin, OpenCardRow, Role } from '../src/db.js';
import { draftCard, DraftStop, floorLines, parseDraftInput } from '../src/job-handlers/draft-card.js';
import { HANDLERS } from '../src/job-handlers/index.js';
import type { Workspace, WorkflowDeps } from '../src/job-handlers/workflow.js';
import { jobTick, type JobContext, type JobState } from '../src/jobs.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import type { MoneyState } from '../src/throttle.js';
import { AGENTS_DIR, TypedOutput } from '../src/typed-output.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeAdapter, usageEvent } from './helpers/fake-adapter.js';
import { FakeDb, NOW, recordCalls, role } from './helpers/fake-db.js';
import { AGENT_ID, CODE_ROOT, ENVIRONMENT_ID, FakeManagedClient, FILES, type FakeSession } from './helpers/fake-managed.js';
import { mockFetch } from './helpers/mock-fetch.js';

const MODEL = 'director-class';
const PRICE_TABLE = parsePriceTable(JSON.stringify({ [MODEL]: { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 } }));
const typed = new TypedOutput();
const RUBRIC = readFileSync(path.join(AGENTS_DIR, 'rubrics', 'draft-game.md'), 'utf8');
// Free text a community-sourced card carries; no prompt may hold any of it.
const COMMUNITY_TEXT = ['Community title the planners never read', 'Community summary the planners never read'];
const BASE_SHA = 'a'.repeat(40);
const NEW_CARD = '77777777-7777-4777-8777-777777777777';
const BACKLOG_CARD = '88888888-8888-4888-8888-888888888888';

const ROLES: Role[] = [
  role(),
  role({ id: 'role-builder-b', name: 'Builder B', title: 'Builder B' }),
  role({ id: 'role-qa', name: 'QA', title: 'QA' }),
  role({ id: 'role-head', name: 'Studio Head', title: 'Studio Head', model: MODEL, prompt_path: 'platform/agents/prompts/studio-head.md', tools_json: ['Read', 'Glob', 'Grep'], agent_class: 'planner' }),
  role({ id: 'role-designer', name: 'Game Designer', title: 'Game Designer', model: MODEL, prompt_path: 'platform/agents/prompts/game-designer.md', tools_json: ['Read', 'Glob', 'Grep', 'Bash'], agent_class: 'planner' }),
  role({ id: 'role-director', name: 'Game Director', title: 'Game Director', model: MODEL, prompt_path: 'platform/agents/prompts/game-director.md', tools_json: ['Read', 'Glob', 'Grep'], write_access: false, agent_class: 'reviewer' }),
];
const byName = (name: string) => ROLES.find((r) => r.name === name)!;

function cardRow(id: string, overrides: Partial<OpenCardRow> = {}): OpenCardRow {
  return { id, source: 'board', bucket: 'game', lane: 'config', folder: 'seed-1', stage: 'proposed', horizon: 'now', rank: null, title: `Card ${id}`, summary: `Summary ${id}`, funding_target_usd: 0.5, funded_usd: 0, ...overrides };
}
const IDS = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  community: '33333333-3333-4333-8333-333333333333',
  next: '55555555-5555-4555-8555-555555555555',
};

const NEW_TARGET: DraftTarget = {
  cardId: NEW_CARD,
  kind: 'new',
  opened: 'new',
  card: { title: 'A game card the Game Designer is drafting', summary: null, intent: null, horizon: 'next', rank: null, funded_usd: 0, severity: null },
  gaveUp: [],
};
const BACKLOG_TARGET: DraftTarget = {
  cardId: BACKLOG_CARD,
  kind: 'backlog',
  opened: 'backlog',
  card: { title: 'Show how long until the next unlock', summary: 'A timer shows how long the next unlock takes.', intent: 'It is not built yet.', horizon: 'later', rank: 4, funded_usd: 0, severity: null },
  gaveUp: [],
};

const DRAFT = {
  title: 'Gatherers cost 11',
  summary: 'The gatherer costs one more to build.',
  intent: 'Raise the gatherer base cost by one.',
  acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11',
  lane: 'config',
  executor: 'Builder A',
  estimate_usd: 0.5,
};
const verdict = (result: string, reason_codes: string[], note?: string) => JSON.stringify({ result, reason_codes, ...(note ? { note } : {}) });

type Kind = 'designer' | 'director';
function kindOf(spec: SessionSpec): Kind {
  return spec.prompt.startsWith('Draft a game card') ? 'designer' : 'director';
}

interface Answers {
  designer?: string[];
  director?: string[];
  // Sessions of these kinds end as a failed model call.
  fail?: Kind[];
  // Sessions of these kinds meet the API refusing the studio key for credit.
  refuse?: Kind[];
  // What a Director session spends, $0.01 unless set.
  directorUsd?: number;
}

interface Seen {
  kind: Kind;
  prompt: string;
  tools: string[];
  purpose: string | undefined;
  cardId: string | null | undefined;
  repoSha: string | null | undefined;
  budget: number;
  held: number | undefined;
}

// The handler on a fake of the managed adapter: each session starts as a reader billed to the studio's
// key and writes its own ledger row, as adapters/managed.ts does, billed to the card the request names.
function setup(answers: Answers, input: Record<string, unknown> = { floor: { short_open: 1, short_big: 0, short_small: 0, big_min_usd: 5, small_max_usd: 2 } }, target: DraftTarget = NEW_TARGET) {
  const db = new FakeDb();
  db.roles = ROLES.map((r) => ({ ...r }));
  db.studio.card_max_usd = 5;
  db.draftTarget = structuredClone(target);
  db.openCardRows = [
    cardRow(IDS.a, { rank: 2 }),
    cardRow(IDS.b, { rank: 1 }),
    cardRow(IDS.community, { source: 'community', title: COMMUNITY_TEXT[0]!, summary: COMMUNITY_TEXT[1]! }),
    cardRow(IDS.next, { horizon: 'next' }),
  ];
  const queues: Record<Kind, string[]> = { designer: [...(answers.designer ?? [])], director: [...(answers.director ?? [])] };
  const sessions: Seen[] = [];
  const jobBudgets = new SessionBudgets();
  const failKinds = new Set(answers.fail ?? []);
  const refuseKinds = new Set(answers.refuse ?? []);
  let count = 0;
  const fake = new FakeAdapter(
    async (spec, emit) => {
      count += 1;
      const cardId = spec.role?.cardId;
      sessions.push({ kind: kindOf(spec), prompt: spec.prompt, tools: spec.roleTools, purpose: spec.purpose, cardId, repoSha: spec.role?.repoSha, budget: spec.maxBudgetUsd, held: cardId ? jobBudgets.remaining().get(cardId) : undefined });
      await emit({ type: 'start', sessionId: `sesn_${count}`, model: MODEL, tools: ['read', 'glob', 'grep'], apiKeySource: 'ANTHROPIC_API_KEY', ledger: 'adapter' });
      if (refuseKinds.has(kindOf(spec))) {
        await emit({ type: 'error', message: 'the Managed Agents session could not be created: 400 Your credit balance is too low to access the Anthropic API.' });
        return;
      }
      await db.recordUsage({ billed_to: cardId ? 'studio' : 'overhead', card_id: cardId ?? null, role_id: spec.roleId ?? null, model: MODEL, input_tokens: 1000, cached_tokens: 0, output_tokens: 200, usd: kindOf(spec) === 'director' ? (answers.directorUsd ?? 0.01) : 0.01, request_id: `managed:sesn_${count}:1` });
      await emit(usageEvent(1, 200, MODEL));
    },
    { mode: 'unattended', result: (spec) => queues[kindOf(spec)].shift() ?? '' },
  );
  const adapter: AgentAdapter = {
    mode: 'unattended',
    preflight: (spec) => fake.preflight(spec),
    run: async (spec, onEvent, signal) => {
      const result = await fake.run(spec, onEvent, signal);
      return failKinds.has(kindOf(spec)) ? { ...result, isError: true, exitCode: 1, endSubtype: 'error_during_execution' } : result;
    },
  };
  const workspace = { closed: 0 };
  const files: Record<string, string> = { 'seed-1/config/spawn-table.json': JSON.stringify({ rows: [{ id: 'gatherer', baseCost: 10 }] }) };
  const scanned: string[][] = [];
  const workflow: WorkflowDeps = {
    adapter,
    draftSessionMaxUsd: 0.75,
    jobBudgets,
    typed,
    priceTable: PRICE_TABLE,
    sessionMaxTurns: 20,
    sessionMaxMs: 60_000,
    watchIntervalMs: 5,
    scanText: async (strings) => {
      scanned.push([...strings]);
      return { ok: true };
    },
    // The repository checkout, so each managed session reads its role prompt from it.
    openWorkspace: async (): Promise<Workspace> => ({
      path: CODE_ROOT,
      baseSha: BASE_SHA,
      readMain: async (file) => files[file] ?? null,
      close: async () => {
        workspace.closed += 1;
      },
    }),
    rubric: async () => RUBRIC,
    ledgerRetryMs: 1,
  };
  const designer = byName('Game Designer');
  const run = { id: 'run-1', job_name: 'draft_card', origin: 'schedule' as JobOrigin, status: 'running' as const, card_id: null, input, parent_run_id: null, created_at: NOW.toISOString() };
  db.jobRuns.push({ ...run, idem_key: 'draft_card:supply:1', reason: null, output: null, holder: 'dispatcher' });
  const alert = new RecordingAlerter();
  const context: JobContext = {
    run,
    job: { name: 'draft_card', role_id: designer.id, calls_model: true, runs_when_paused: false, enabled: true },
    role: designer,
    mode: 'unattended',
    db,
    adapter,
    log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
    alert,
    stopSignal: new AbortController().signal,
    now: () => NOW,
    workflow,
  };
  return { db, sessions, context, workspace, scanned, files, workflow, jobBudgets, alert };
}

function expectNoCommunityText(prompts: readonly string[]) {
  for (const prompt of prompts) for (const text of COMMUNITY_TEXT) expect(prompt).not.toContain(text);
}

// A money state with plenty of room, for the throttle check; a test lowers what it needs.
function money(overrides: Partial<MoneyState> = {}): MoneyState {
  return {
    balanceUsd: 50,
    studioReserveUsd: 0,
    incidentReserveUsd: 0,
    cardMaxUsd: 5,
    dailyCapUsd: 100,
    spentTodayUsd: 0,
    monthlyCapUsd: 500,
    spentThisMonthUsd: 0,
    tierCapUsd: null,
    spentThisTierMonthUsd: 0,
    creditPurchasedUsd: 1000,
    creditSpentUsd: 0,
    cards: [],
    spent: new Map(),
    running: new Map(),
    ...overrides,
  };
}

describe('draft_card, unattended and billed to the card it drafts', () => {
  it('opens the card first, then runs the Designer and the Director as managed readers on main with no board member signed in, every ledger row studio-billed to that card', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
    const recorded = recordCalls(t.db);
    const output = await draftCard({ ...t.context, db: recorded.db });
    expect([...recorded.calls].filter((name) => /board/i.test(name))).toEqual([]);
    expect(t.db.draftTargetsOpened).toEqual(['run-1']);
    expect(t.db.jobRuns[0]!.card_id).toBe(NEW_CARD);
    expect(t.sessions.map((s) => [s.kind, s.purpose, s.cardId, s.repoSha])).toEqual([
      ['designer', 'role', NEW_CARD, BASE_SHA],
      ['director', 'role', NEW_CARD, BASE_SHA],
    ]);
    // No Bash, though the Designer's role spec holds it: a managed reader runs no agent-written code.
    for (const session of t.sessions) expect(session.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(t.sessions[0]!.prompt).toContain(`The repository is checked out read-only at ${REPO_MOUNT}, at main's commit ${BASE_SHA}.`);
    expect(t.sessions[0]!.prompt).toContain(`It fills card ${NEW_CARD}, which the dispatcher opened for this draft; it stays private until it is approved.`);
    expect(t.sessions[0]!.prompt).toContain('Every turn of this session is billed to that card at list price, within a budget of $0.75');
    expect(t.sessions[1]!.prompt).toContain(`It fills card ${NEW_CARD}, a new seed-1 card opened for this draft`);
    expect(t.db.ledger.length).toBe(2);
    for (const row of t.db.ledger) expect([row.billed_to, row.card_id]).toEqual(['studio', NEW_CARD]);
    expect(t.db.ledger.map((row) => row.role_id)).toEqual(['role-designer', 'role-director']);
    expect(t.db.ledger.some((row) => row.billed_to === 'founder')).toBe(false);
    const draft = t.db.drafts[0]!;
    expect([draft.target_card_id, draft.job_run_id, draft.status, draft.maker_ref, draft.grader_ref]).toEqual([NEW_CARD, 'run-1', 'approved', 'claude:sesn_1', 'claude:sesn_2']);
    expect(draft.fields).toEqual({ title: DRAFT.title, summary: DRAFT.summary, intent: DRAFT.intent, acceptance_test: DRAFT.acceptance_test, lane: 'config', executor_role_id: 'role-builder-a', estimate_usd: 0.5 });
    // Approval raises the target by the drafting spend: the $0.50 estimate and the two sessions' $0.02.
    expect(t.db.draftCards).toEqual([
      { id: NEW_CARD, funding_target_usd: 0.52, draft_id: 'draft-1', approver_role_id: 'role-director', grader_ref: 'claude:sesn_2', verdict: { result: 'approved', reason_codes: ['fits_pillars'], round: 1 }, content_sha256: draft.content_sha256 },
    ]);
    expect(output).toMatchObject({ result: 'approved', card_id: NEW_CARD, kind: 'new', opened: 'new', draft_id: 'draft-1', estimate_usd: 0.5, draft_spend_usd: 0.02, funding_target_usd: 0.52, base_sha: BASE_SHA });
    expect(t.sessions[0]!.prompt).toContain("The card's drafting has spent $0.00 so far. On approval its funding target is your estimate plus everything its drafting spends, this session and the grading included, rounded up to the cent, and that total must stay within the per-card maximum of $5.00.");
    expect(t.sessions[1]!.prompt).toContain(RUBRIC.trim());
    expect(t.scanned).toEqual([[DRAFT.title, DRAFT.summary, DRAFT.intent, DRAFT.acceptance_test]]);
    expect(t.workspace.closed).toBe(1);
    expect(t.db.rejectedCards).toEqual([]);
  });

  it("fills a backlog card: the board's title and summary stay whatever the Designer answers, and its intent reaches the Designer", async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, {}, BACKLOG_TARGET);
    const output = await draftCard(t.context);
    const prompt = t.sessions[0]!.prompt;
    expect(prompt).toContain(`Fill card ${BACKLOG_CARD}, a seed-1 card on the board's backlog (horizon later, rank 4)`);
    expect(prompt).toContain("Its title and summary are the board's: answer with both exactly as they are.");
    expect(prompt).toContain('"intent": "It is not built yet."');
    expect(t.sessions[1]!.prompt).toContain(`It fills card ${BACKLOG_CARD}, a seed-1 card on the board's backlog, whose title and summary are the board's.`);
    expect(t.db.drafts[0]!.fields).toMatchObject({ title: BACKLOG_TARGET.card.title, summary: BACKLOG_TARGET.card.summary, intent: DRAFT.intent, acceptance_test: DRAFT.acceptance_test, estimate_usd: 0.5 });
    expect(t.scanned).toEqual([[BACKLOG_TARGET.card.title, BACKLOG_TARGET.card.summary, DRAFT.intent, DRAFT.acceptance_test]]);
    expect(output).toMatchObject({ result: 'approved', card_id: BACKLOG_CARD, kind: 'backlog' });
    for (const row of t.db.ledger) expect([row.billed_to, row.card_id]).toEqual(['studio', BACKLOG_CARD]);
  });

  it('budgets each session at DRAFT_SESSION_MAX_USD, lowered to what the per-card maximum leaves on the card (for the Director, after the estimate), and holds it from the card path while it runs', async () => {
    const t = setup({ designer: [JSON.stringify({ ...DRAFT, estimate_usd: 0.1 })], director: [verdict('approved', ['fits_pillars'])] });
    // Earlier spend on the card: the per-card maximum of $5 leaves $0.50.
    await t.db.recordUsage({ billed_to: 'studio', card_id: NEW_CARD, role_id: 'role-designer', model: MODEL, input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 4.5, request_id: 'earlier' });
    expect(await draftCard(t.context)).toMatchObject({ result: 'approved', funding_target_usd: 4.62 });
    // The Designer gets the $0.50 left; its $0.01 and the $0.10 estimate leave the Director $0.39.
    expect(t.sessions.map((s) => s.budget)).toEqual([0.5, 0.39]);
    expect(t.sessions.map((s) => s.held)).toEqual([0.5, 0.39]);
    expect(t.jobBudgets.remaining().size).toBe(0);

    const roomy = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
    await draftCard(roomy.context);
    expect(roomy.sessions.map((s) => s.budget)).toEqual([0.75, 0.75]);
  });

  it('gives the card up when the per-card maximum leaves less than a session needs: no session, a new card rejected, a backlog card passed over, the board told once', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)] });
    await t.db.recordUsage({ billed_to: 'studio', card_id: NEW_CARD, role_id: 'role-designer', model: MODEL, input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 4.8, request_id: 'earlier' });
    expect(await draftCard(t.context)).toMatchObject({ result: 'withdrawn', reason: 'card_max', card_id: NEW_CARD, kind: 'new', card_rejected: true });
    expect(t.sessions).toEqual([]);
    expect(t.db.rejectedCards).toEqual([{ cardId: NEW_CARD, runId: 'run-1' }]);
    expect(t.alert.messages).toEqual([
      "The card supply's draft of card 77777777 was withdrawn (card_max): the new card is rejected, its spend kept, and the next run drafts another card.",
    ]);

    const backlog = setup({ designer: [JSON.stringify(DRAFT)] }, {}, BACKLOG_TARGET);
    await backlog.db.recordUsage({ billed_to: 'studio', card_id: BACKLOG_CARD, role_id: 'role-designer', model: MODEL, input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 4.8, request_id: 'earlier' });
    expect(await draftCard(backlog.context)).toMatchObject({ result: 'withdrawn', reason: 'card_max', card_id: BACKLOG_CARD, card_rejected: false });
    expect([backlog.sessions, backlog.db.rejectedCards]).toEqual([[], []]);
  });

  it('gives the card up when the Director cannot start for want of room under the per-card maximum, withdrawing the recorded draft', async () => {
    const t = setup({ designer: [JSON.stringify({ ...DRAFT, estimate_usd: 0.1 })] });
    // $4.65 earlier leaves the Designer $0.35; its $0.01 leaves $0.34, less than the Director needs.
    await t.db.recordUsage({ billed_to: 'studio', card_id: NEW_CARD, role_id: 'role-designer', model: MODEL, input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 4.65, request_id: 'earlier' });
    expect(await draftCard(t.context)).toMatchObject({ result: 'withdrawn', reason: 'card_max', card_rejected: true });
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer']);
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([['withdrawn', ['stopped_card_max']]]);
  });

  it("refuses an estimate that, with the card's drafting spend and the least a grading needs, would take the target over the per-card maximum, and approves a smaller one with the target raised", async () => {
    const t = setup({ designer: [JSON.stringify({ ...DRAFT, estimate_usd: 1 }), JSON.stringify({ ...DRAFT, estimate_usd: 0.2 })], director: [verdict('approved', ['fits_pillars'])] });
    await t.db.recordUsage({ billed_to: 'studio', card_id: NEW_CARD, role_id: 'role-designer', model: MODEL, input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 4, request_id: 'earlier' });
    const output = await draftCard(t.context);
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer', 'designer', 'director']);
    expect(t.sessions[0]!.prompt).toContain("The card's drafting has spent $4.00 so far.");
    expect(t.sessions[1]!.prompt).toContain("The card's drafting has spent $4.01 so far.");
    expect(t.sessions[1]!.prompt).toContain(
      "Your last draft was refused by the estimate check: the estimate $1 plus the $4.01 this card's drafting has spent and the $0.35 its grading needs at least comes to $5.36, above the per-card maximum $5",
    );
    // $4.00 earlier and three sessions' $0.03: the target is the $0.20 estimate plus $4.03.
    expect(output).toMatchObject({ result: 'approved', estimate_usd: 0.2, draft_spend_usd: 4.03, funding_target_usd: 4.23 });
    expect(t.db.draftCards.map((c) => c.funding_target_usd)).toEqual([4.23]);
  });

  it('withdraws an approved draft whose target, raised by the drafting spend, would pass the per-card maximum, and gives the card up', async () => {
    // The Director spends more than the check reserved for it: $3.91 + $1.00 + the $0.30 estimate is $5.21.
    const t = setup({ designer: [JSON.stringify({ ...DRAFT, estimate_usd: 0.3 })], director: [verdict('approved', ['fits_pillars'])], directorUsd: 1 });
    await t.db.recordUsage({ billed_to: 'studio', card_id: NEW_CARD, role_id: 'role-designer', model: MODEL, input_tokens: 0, cached_tokens: 0, output_tokens: 0, usd: 3.9, request_id: 'earlier' });
    expect(await draftCard(t.context)).toMatchObject({ result: 'withdrawn', reason: 'over_card_max', total_usd: 5.21, card_rejected: true });
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([['withdrawn', ['over_card_max']]]);
    expect(t.db.draftCards).toEqual([]);
    expect(t.db.rejectedCards).toEqual([{ cardId: NEW_CARD, runId: 'run-1' }]);
  });

  it('tells the board once about each card the open gave up on', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT), JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars']), verdict('approved', ['fits_pillars'])] });
    t.db.draftTarget.gaveUp = [
      { cardId: '99999999-9999-4999-8999-999999999999', kind: 'new', why: 'failed_twice', rejected: true },
      { cardId: BACKLOG_CARD, kind: 'backlog', why: 'card_max', rejected: false },
    ];
    await draftCard(t.context);
    await draftCard(t.context);
    expect(t.alert.messages).toEqual([
      'The card supply gave up on card 99999999: two draft runs on it failed after spending on it. The new card is rejected, its spend kept. The supply drafts another card.',
      'The card supply gave up on card 88888888: its drafting spend leaves less than one session under the per-card maximum. The backlog card is passed over until it changes. The supply drafts another card.',
    ]);
  });

  it("starts a session only when the throttle's money covers its budget: the balance after the other cards' holds, the daily and the monthly cap", async () => {
    const cases: Array<[string, Partial<MoneyState>]> = [
      ['insufficient_balance', { balanceUsd: 0.5 }],
      ['daily_cap', { dailyCapUsd: 10, spentTodayUsd: 9.5 }],
      ['monthly_cap', { monthlyCapUsd: 500, spentThisMonthUsd: 499.6 }],
      ['monthly_cap', { monthlyCapUsd: null }],
      ['insufficient_balance', { balanceUsd: 5, cards: [{ id: 'held', stage: 'funded', estimate_usd: 5, actual_usd: 0, funded_usd: 4.5, severity: null }] }],
    ];
    for (const [reason, state] of cases) {
      const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
      t.workflow.money = async () => money(state);
      await expect(draftCard(t.context), reason).rejects.toThrow(new RegExp(`^${reason}: `));
      expect(t.sessions).toEqual([]);
    }
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
    t.workflow.money = async () => money({ balanceUsd: 0.75 });
    expect(await draftCard(t.context)).toMatchObject({ result: 'approved' });
  });

  it('withdraws a recorded draft when the money stops the Director, so nothing is left half-graded', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
    let reads = 0;
    t.workflow.money = async () => {
      reads += 1;
      return money(reads === 1 ? {} : { dailyCapUsd: 1, spentTodayUsd: 0.9 });
    };
    await expect(draftCard(t.context)).rejects.toThrow(DraftStop);
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer']);
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([['withdrawn', ['stopped_daily_cap']]]);
    expect(t.db.draftCards).toEqual([]);
  });

  it('refuses an attended adapter, which only a hand-run tool builds, before it opens a card, since a draft is never billed to the founder', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)] });
    t.workflow.adapter = { mode: 'attended', preflight: async () => undefined, run: async () => ({ exitCode: 0, killed: false, killReason: null, turns: 0, endSubtype: 'success', totalCostUsd: 0, numTurns: 0, isError: false }) };
    await expect(draftCard({ ...t.context, mode: 'attended' })).rejects.toThrow('draft_card runs only unattended');
    expect(t.db.draftTargetsOpened).toEqual([]);
    expect(t.sessions).toEqual([]);
  });

  it('pauses the studio when the API refuses the studio key for credit, and fails the run with nothing written onto the card', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], refuse: ['designer'] });
    await expect(draftCard(t.context)).rejects.toThrow("the Game Designer's session failed: the API refused the studio key for credit");
    expect([t.db.studio.paused, t.db.pauseReason]).toEqual([true, 'awaiting_credit']);
    expect(t.alert.messages.join('\n')).toContain('Console credit needed: the draft of card 77777777 stopped because the API refused the studio key.');
    expect([t.db.drafts, t.db.draftCards, t.db.rejectedCards]).toEqual([[], [], []]);
  });

  it('starts a new round on revise, giving the Designer the codes, the note and its last draft, then approves', async () => {
    const second = { ...DRAFT, summary: 'Building a gatherer costs 11 dust.' };
    const t = setup({ designer: [JSON.stringify(DRAFT), JSON.stringify(second)], director: [verdict('revise', ['unclear_text'], 'Say it costs dust.'), verdict('approved', ['fits_pillars'])] });
    const output = await draftCard(t.context);
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer', 'director', 'designer', 'director']);
    expect(t.sessions[2]!.prompt).toContain('The Game Director sent your last draft back to revise: unclear_text.');
    expect(t.sessions[2]!.prompt).toContain('Note: Say it costs dust.');
    expect(t.sessions[2]!.prompt).toContain('round 2 of 3');
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([
      ['withdrawn', ['unclear_text']],
      ['approved', []],
    ]);
    expect(output).toMatchObject({ result: 'approved', card_id: NEW_CARD });
    for (const row of t.db.ledger) expect([row.billed_to, row.card_id]).toEqual(['studio', NEW_CARD]);
  });

  it('withdraws a flagged draft: a new card is rejected with its spend kept, a backlog card is left as it was', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('flagged', ['duplicate_card'])] });
    expect(await draftCard(t.context)).toMatchObject({ result: 'withdrawn', reason: 'flagged', reason_codes: ['duplicate_card'], card_id: NEW_CARD, kind: 'new', card_rejected: true });
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([['withdrawn', ['duplicate_card']]]);
    expect(t.db.rejectedCards).toEqual([{ cardId: NEW_CARD, runId: 'run-1' }]);
    expect(t.db.ledger.map((row) => [row.billed_to, row.card_id])).toEqual([
      ['studio', NEW_CARD],
      ['studio', NEW_CARD],
    ]);
    expect(t.db.draftCards).toEqual([]);

    const backlog = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('flagged', ['off_pillar'])] }, {}, BACKLOG_TARGET);
    expect(await draftCard(backlog.context)).toMatchObject({ result: 'withdrawn', reason: 'flagged', card_id: BACKLOG_CARD, kind: 'backlog', card_rejected: false });
    expect([backlog.db.rejectedCards, backlog.db.draftCards]).toEqual([[], []]);
  });

  it('withdraws after a third round without approval, rejecting a new card', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT), JSON.stringify(DRAFT), JSON.stringify(DRAFT)], director: [verdict('revise', ['off_pillar']), verdict('revise', ['off_pillar']), verdict('revise', ['estimate_implausible'])] });
    expect(await draftCard(t.context)).toMatchObject({ result: 'withdrawn', reason: 'no_approval_in_three_rounds', card_rejected: true });
    expect(t.sessions).toHaveLength(6);
    expect(t.db.drafts.map((d) => d.status)).toEqual(['withdrawn', 'withdrawn', 'withdrawn']);
    expect(t.db.draftCards).toEqual([]);
    expect(t.db.rejectedCards).toEqual([{ cardId: NEW_CARD, runId: 'run-1' }]);
  });

  it('refuses a draft by its check before any grading and sends it back as a new round', async () => {
    const holds = { ...DRAFT, acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 10' };
    const t = setup({ designer: [JSON.stringify(holds), JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
    const output = await draftCard(t.context);
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer', 'designer', 'director']);
    expect(t.sessions[1]!.prompt).toContain('Your last draft was refused by the already_holds check: already true on main');
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([
      ['withdrawn', ['check_already_holds']],
      ['approved', []],
    ]);
    expect(output).toMatchObject({ result: 'approved', rounds: [{ round: 1, check: { name: 'already_holds' } }, { round: 2, verdict: { result: 'approved' } }] });
  });

  it('refuses an answer that is not one valid draft as the schema check, and withdraws after three, rejecting a new card', async () => {
    const t = setup({ designer: ['A card about gatherers.', JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
    expect(await draftCard(t.context)).toMatchObject({ result: 'approved', rounds: [{ round: 1, check: { name: 'schema' } }, { round: 2 }] });
    const never = setup({ designer: ['No.', '{"title": "x"}', `${JSON.stringify(DRAFT)} and more`] });
    expect(await draftCard(never.context)).toMatchObject({ result: 'withdrawn', reason: 'no_valid_draft_in_three_rounds', card_rejected: true });
    expect([never.db.drafts, never.db.draftCards]).toEqual([[], []]);
    expect(never.db.rejectedCards).toEqual([{ cardId: NEW_CARD, runId: 'run-1' }]);
  });

  it('sends back a draft whose text is blank or whose estimate rounds to nothing as the schema check, before record_card_draft_for could refuse it', async () => {
    for (const blank of [{ ...DRAFT, title: '   ' }, { ...DRAFT, intent: '\n\t' }, { ...DRAFT, estimate_usd: 0.00004 }]) {
      const t = setup({ designer: [JSON.stringify(blank), JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
      expect(await draftCard(t.context), JSON.stringify(blank)).toMatchObject({ result: 'approved', rounds: [{ round: 1, draft_id: null, check: { name: 'schema' } }, { round: 2 }] });
      expect(t.db.drafts.map((d) => d.status)).toEqual(['approved']);
    }
  });

  it('fails the run, writing nothing onto the card and leaving a new card for the next run, when a model call fails or the Director does not answer with one verdict', async () => {
    const designerDown = setup({ designer: [JSON.stringify(DRAFT)], fail: ['designer'] });
    await expect(draftCard(designerDown.context)).rejects.toThrow("the Game Designer's session failed: the model call failed");
    expect(designerDown.db.drafts).toEqual([]);
    const directorDown = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])], fail: ['director'] });
    await expect(draftCard(directorDown.context)).rejects.toThrow("the Game Director's session failed");
    expect(directorDown.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([['withdrawn', ['grade_failed']]]);
    const directorProse = setup({ designer: [JSON.stringify(DRAFT)], director: ['Looks good to me.'] });
    await expect(draftCard(directorProse.context)).rejects.toThrow("the Game Director's session failed");
    for (const t of [designerDown, directorDown, directorProse]) {
      expect([t.db.draftCards, t.db.rejectedCards]).toEqual([[], []]);
      expect(t.workspace.closed).toBe(1);
    }
  });

  it('keeps community free text out of the Designer and Director prompts, and passes the floor and the named open cards', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, { floor: { open: 5, short: 2 }, open_cards: [IDS.a, { id: IDS.community }] });
    await draftCard(t.context);
    expectNoCommunityText(t.sessions.map((s) => s.prompt));
    expect(t.sessions[0]!.prompt).toContain('The floor: {"open":5,"short":2}.');
    expect(t.sessions[0]!.prompt).toContain(IDS.community);
    expect(t.sessions[0]!.prompt).not.toContain(IDS.b);
    expect(t.sessions[0]!.prompt).toContain('Executors: Builder A, Builder B, QA.');
  });

  // The review of 26 September 2026: Draft to the floor sent only the shortfalls, so the Designer was
  // never told what "big" meant, and its prompt pinned every target at $0.50 or $1.50.
  it("tells the Designer what the floor's shortfalls ask for: a big card's target of at least $5, a small card's under $2", async () => {
    const floor = { short_open: 2, short_big: 1, short_small: 1, big_min_usd: 5, small_max_usd: 2 };
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, { floor, open_cards: [IDS.a] });
    t.db.studio.card_max_usd = 25;
    await draftCard(t.context);
    const prompt = t.sessions[0]!.prompt;
    expect(prompt).toContain("The open cards are short of the board's floor. Draft one card that fills one of these shortfalls:");
    expect(prompt).toContain('- 1 big card: a target of at least $5.00 and at most $25.00. By the five-times rule that is a bigger change, with an expected cost of at least $1.00');
    expect(prompt).toContain('Never pad a smaller change');
    expect(prompt).toContain('- 1 small card: a target under $2.00.');
    expect(prompt).toContain('- 2 more open cards, of any size.');
    expect(prompt).toContain("five times the change's expected cost, rounded up to the next 50 cents");
    expect(prompt).not.toContain('The floor: {');
    // Only the shortfalls above 0 are named; a big card above the per-card maximum is said to be out of reach.
    expect(floorLines({ ...floor, short_open: 0, short_small: 0 }, 25)).toEqual([
      "The open cards are short of the board's floor. Draft one card that fills one of these shortfalls:",
      '- 1 big card: a target of at least $5.00 and at most $25.00. By the five-times rule that is a bigger change, with an expected cost of at least $1.00, still one mechanic, number or piece of content. Never pad a smaller change\'s target to reach it.',
    ]);
    expect(floorLines({ ...floor, short_open: 0 }, 4)[1]).toBe('- 1 big card, with a target of at least $5.00: no draft can fill this, since the per-card maximum is $4.00. Fill another shortfall.');
    expect(floorLines({ ...floor, short_open: 0, short_big: 0, short_small: 0 }, 25)).toEqual(["The open cards meet the board's floor."]);
    expect(floorLines(3, 25)).toEqual(['The floor: 3.']);
  });

  it('refuses to start without an unpaused Game Director, or with input other than {} or {floor, open_cards}', async () => {
    const paused = setup({});
    paused.db.roles = paused.db.roles.map((r) => (r.name === 'Game Director' ? { ...r, paused: true } : r));
    await expect(draftCard(paused.context)).rejects.toThrow('the Game Director is paused');
    expect([paused.sessions, paused.db.draftTargetsOpened]).toEqual([[], []]);
    expect(parseDraftInput({})).toEqual({ floor: null, openCardIds: null });
    expect(parseDraftInput({ floor: 3, open_cards: [IDS.a] })).toEqual({ floor: 3, openCardIds: [IDS.a] });
    expect(() => parseDraftInput({ card_id: IDS.a })).toThrow('draft_card takes {} or {floor, open_cards}');
    expect(() => parseDraftInput({ floor: 'many' })).toThrow('floor must be a number');
    expect(() => parseDraftInput({ open_cards: [3] })).toThrow('open_cards holds card ids');
  });
});

describe('draft_card on the real managed adapter', () => {
  // GitHub for the read-token check: the repository reads, and a ref write is refused for want of
  // permission.
  const github = mockFetch((method, url) => {
    if (method === 'GET' && url === 'https://api.github.com/repos/owner/repo') return { status: 200, json: { full_name: 'owner/repo' } };
    if (method === 'POST' && url === 'https://api.github.com/repos/owner/repo/git/refs') return { status: 403, json: { message: 'Resource not accessible by personal access token' } };
    return undefined;
  });

  it("writes both sessions' ledger rows itself, studio-billed with the drafted card's id and each role, with main mounted read-only", async () => {
    const t = setup({});
    const client = new FakeManagedClient();
    client.react = (session: FakeSession, event) => {
      if (event.type !== 'user.message') return;
      const label = String(session.params.metadata?.label ?? '');
      const answer = label.startsWith('designer-') ? JSON.stringify(DRAFT) : verdict('approved', ['fits_pillars']);
      session.cost = { cents: 4, activeSeconds: 30 };
      session.emit(
        { type: 'session.status_running' },
        { type: 'span.model_request_end', is_error: false, model_usage: { input_tokens: 3000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
        { type: 'agent.message', content: [{ type: 'text', text: answer }] },
        { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
      );
    };
    t.workflow.adapter = new ManagedAdapter({
      client,
      files: FILES,
      agentId: AGENT_ID,
      agentVersion: 3,
      environmentId: ENVIRONMENT_ID,
      githubRepo: 'owner/repo',
      readToken: 'github_pat_-fixture-read',
      priceTable: PRICE_TABLE,
      probeModel: MODEL,
      db: t.db,
      patches: null,
      alert: t.alert,
      log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
      fetchFn: github.fetchFn,
      timings: { interruptGraceMs: 300, statusWaitMs: 60, statusPollMs: 5, stopWaitMs: 200, outputTries: 1, outputDelayMs: 1, reconnectTries: 2, reconnectDelayMs: 1, ledgerRetryMs: 1, archiveTries: 2, archiveDelayMs: 1 },
    });
    const output = await draftCard({ ...t.context, adapter: t.workflow.adapter });
    expect(output).toMatchObject({ result: 'approved', card_id: NEW_CARD });
    expect(client.sessions_.map((session) => [session.params.metadata?.purpose, session.params.metadata?.card_id, session.params.metadata?.role_id])).toEqual([
      ['role', NEW_CARD, 'role-designer'],
      ['role', NEW_CARD, 'role-director'],
    ]);
    for (const session of client.sessions_) {
      expect(session.params.resources).toEqual([{ type: 'github_repository', url: 'https://github.com/owner/repo', authorization_token: 'github_pat_-fixture-read', mount_path: REPO_MOUNT, checkout: { type: 'commit', sha: BASE_SHA } }]);
    }
    expect(t.db.ledger.length).toBeGreaterThan(0);
    for (const row of t.db.ledger) expect([row.billed_to, row.card_id]).toEqual(['studio', NEW_CARD]);
    expect(new Set(t.db.ledger.map((row) => row.role_id))).toEqual(new Set(['role-designer', 'role-director']));
  });
});

describe('the role jobs on the queue', () => {
  const JOBS: Job[] = [
    { name: 'studio_ranking', role_id: 'role-head', calls_model: true, runs_when_paused: true, enabled: false },
    { name: 'draft_card', role_id: 'role-designer', calls_model: true, runs_when_paused: false, enabled: true },
  ];

  function queue(t: ReturnType<typeof setup>) {
    const state: JobState = { running: null };
    t.db.jobList = JOBS;
    t.db.jobRuns = [];
    t.db.lease = { holder: 'actions', expiresAt: NOW.getTime() + 300_000 };
    const run = () =>
      jobTick({
        db: t.db,
        mode: 'unattended',
        adapter: t.workflow.adapter,
        log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
        alert: new RecordingAlerter(),
        now: () => NOW,
        leaseHolder: 'actions',
        watchIntervalMs: 5,
        state,
        stopSignal: new AbortController().signal,
        handlers: HANDLERS,
        workflow: t.workflow,
      });
    return { state, run };
  }

  it('registers draft_card and the Janitor\'s two code jobs, and no handler for the retired studio_ranking', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(['draft_card', 'janitor', 'upkeep_merge']);
  });

  it('runs a schedule-origin draft with no board member signed in, billed to the card it opened, and skips a studio_ranking run as job_disabled', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] });
    const q = queue(t);
    const ranking = await t.db.enqueueJobRun({ job: 'studio_ranking', origin: 'board' });
    const scheduled = await t.db.enqueueJobRun({ job: 'draft_card', origin: 'schedule', input: { floor: { short_open: 1, short_big: 0, short_small: 0, big_min_usd: 5, small_max_usd: 2 } } });
    expect(await q.run()).toEqual({ action: 'started', runId: scheduled.id, job: 'draft_card' });
    await q.state.running?.done;
    const skipped = t.db.jobRuns.find((r) => r.id === ranking.id)!;
    expect([skipped.status, skipped.reason]).toEqual(['skipped', 'job_disabled']);
    const done = t.db.jobRuns.find((r) => r.id === scheduled.id)!;
    expect([done.status, done.reason, done.card_id]).toEqual(['succeeded', null, NEW_CARD]);
    expect(done.output).toMatchObject({ result: 'approved', card_id: NEW_CARD });
    for (const row of t.db.ledger) expect([row.billed_to, row.card_id]).toEqual(['studio', NEW_CARD]);
  });

  it('skips a queued draft while the studio is paused, since a draft spends studio money', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)] });
    const q = queue(t);
    t.db.studio.paused = true;
    const scheduled = await t.db.enqueueJobRun({ job: 'draft_card', origin: 'schedule' });
    expect(await q.run()).toEqual({ action: 'idle', skipped: 1 });
    const skipped = t.db.jobRuns.find((r) => r.id === scheduled.id)!;
    expect([skipped.status, skipped.reason]).toEqual(['skipped', 'studio_paused']);
    expect(t.sessions).toEqual([]);
  });
});
