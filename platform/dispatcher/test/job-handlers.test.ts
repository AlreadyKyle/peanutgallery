// The two role jobs against the fake adapter (src/job-handlers/, docs/specs/agent-workflows.md):
// the Studio Head's ranking, and the Game Designer's rounds graded by the Game Director in a
// separate session, with every refusal, verdict and failure, and no community text in any prompt.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AgentAdapter, SessionSpec } from '../src/adapters/types.js';
import type { Job, JobOrigin, OpenCardRow, Role } from '../src/db.js';
import { draftCard, parseDraftInput } from '../src/job-handlers/draft-card.js';
import { HANDLERS } from '../src/job-handlers/index.js';
import { studioRanking } from '../src/job-handlers/studio-ranking.js';
import type { Workspace, WorkflowDeps } from '../src/job-handlers/workflow.js';
import { jobTick, type JobContext, type JobState } from '../src/jobs.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { AGENTS_DIR, TypedOutput } from '../src/typed-output.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeAdapter, startEvent, usageEvent } from './helpers/fake-adapter.js';
import { FakeDb, NOW, role } from './helpers/fake-db.js';

const MODEL = 'director-class';
const PRICE_TABLE = parsePriceTable(JSON.stringify({ [MODEL]: { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 } }));
const typed = new TypedOutput();
const RUBRIC = readFileSync(path.join(AGENTS_DIR, 'rubrics', 'draft-game.md'), 'utf8');
// Free text a community-sourced card carries; no prompt may hold any of it.
const COMMUNITY_TEXT = ['Community title the planners never read', 'Community summary the planners never read'];
const BASE_SHA = 'a'.repeat(40);

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
  funded: '44444444-4444-4444-8444-444444444444',
  next: '55555555-5555-4555-8555-555555555555',
  // On now with an empty bar, named by a payment on hold (the daily credit cap was used up).
  held: '66666666-6666-4666-8666-666666666666',
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

type Kind = 'head' | 'designer' | 'director';
function kindOf(spec: SessionSpec): Kind {
  if (spec.prompt.startsWith('Rank now')) return 'head';
  if (spec.prompt.startsWith('Draft a game card')) return 'designer';
  return 'director';
}

interface Answers {
  head?: string[];
  designer?: string[];
  director?: string[];
  // Sessions of these kinds end as a failed model call.
  fail?: Kind[];
}

function setup(answers: Answers, job: 'studio_ranking' | 'draft_card', input: Record<string, unknown> = {}) {
  const db = new FakeDb();
  db.roles = ROLES.map((r) => ({ ...r }));
  db.studio.card_max_usd = 5;
  db.openCardRows = [
    cardRow(IDS.a, { rank: 2 }),
    cardRow(IDS.b, { rank: 1 }),
    cardRow(IDS.community, { source: 'community', title: COMMUNITY_TEXT[0]!, summary: COMMUNITY_TEXT[1]! }),
    cardRow(IDS.funded, { stage: 'proposed', funded_usd: 0.25 }),
    cardRow(IDS.next, { horizon: 'next' }),
    cardRow(IDS.held, { rank: 3 }),
  ];
  db.heldCardIds.add(IDS.held);
  const queues: Record<Kind, string[]> = { head: [...(answers.head ?? [])], designer: [...(answers.designer ?? [])], director: [...(answers.director ?? [])] };
  const sessions: Array<{ kind: Kind; prompt: string; tools: string[] }> = [];
  let count = 0;
  const failKinds = new Set(answers.fail ?? []);
  const adapter = new FakeAdapter(
    async (spec, emit) => {
      count += 1;
      sessions.push({ kind: kindOf(spec), prompt: spec.prompt, tools: spec.roleTools });
      await emit({ type: 'start', sessionId: `session-${count}`, model: MODEL, tools: spec.roleTools, apiKeySource: 'none' });
      await emit(usageEvent(1, 200, MODEL));
    },
    { result: (spec) => queues[kindOf(spec)].shift() ?? '' },
  );
  // A failed model call for the kinds named.
  const failing: AgentAdapter = {
    mode: 'attended',
    preflight: (spec) => adapter.preflight(spec),
    run: async (spec, onEvent, signal) => {
      const result = await adapter.run(spec, onEvent, signal);
      return failKinds.has(kindOf(spec)) ? { ...result, isError: true, exitCode: 1, endSubtype: 'error_during_execution' } : result;
    },
  };
  const workspace = { closed: 0 };
  const files: Record<string, string> = { 'seed-1/config/spawn-table.json': JSON.stringify({ rows: [{ id: 'gatherer', baseCost: 10 }] }) };
  const scanned: string[][] = [];
  const workflow: WorkflowDeps = {
    roleAdapter: failing,
    typed,
    priceTable: PRICE_TABLE,
    sessionMaxTurns: 20,
    sessionMaxMs: 60_000,
    boardSessionTtlMin: 3,
    watchIntervalMs: 5,
    scanText: async (strings) => {
      scanned.push([...strings]);
      return { ok: true };
    },
    openWorkspace: async (): Promise<Workspace> => ({
      path: '/tmp/job-run',
      baseSha: BASE_SHA,
      readMain: async (file) => files[file] ?? null,
      close: async () => {
        workspace.closed += 1;
      },
    }),
    rubric: async () => RUBRIC,
    ledgerRetryMs: 1,
  };
  const jobRole = byName(job === 'studio_ranking' ? 'Studio Head' : 'Game Designer');
  const context: JobContext = {
    run: { id: 'run-1', job_name: job, origin: 'board', status: 'running', card_id: null, input, parent_run_id: null, created_at: NOW.toISOString() },
    job: { name: job, role_id: jobRole.id, calls_model: true, runs_when_paused: true },
    role: jobRole,
    mode: 'attended',
    db,
    adapter: { mode: 'attended' } as unknown as AgentAdapter,
    log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
    alert: new RecordingAlerter(),
    stopSignal: new AbortController().signal,
    now: () => NOW,
    workflow,
  };
  return { db, sessions, context, workspace, scanned, files };
}

function expectNoCommunityText(prompts: readonly string[]) {
  for (const prompt of prompts) for (const text of COMMUNITY_TEXT) expect(prompt).not.toContain(text);
}

describe('studio_ranking', () => {
  it('shows typed fields only, a community card as id, stage, horizon, bucket and funded, and applies the order', async () => {
    const t = setup({ head: [JSON.stringify({ order: [{ card_id: IDS.a, reason_code: 'player_visible' }, { card_id: IDS.b, reason_code: 'small_and_ready' }] })] }, 'studio_ranking');
    const output = await studioRanking(t.context);
    expect(t.sessions.map((s) => s.kind)).toEqual(['head']);
    const prompt = t.sessions[0]!.prompt;
    expectNoCommunityText([prompt]);
    expect(prompt).toContain(`{\n    "id": "${IDS.community}",\n    "source": "community",\n    "stage": "proposed",\n    "horizon": "now",\n    "bucket": "game",\n    "funded_usd": 0\n  }`);
    expect(prompt).toContain(`Rankable: the cards on now at proposed, designing or voted with no money on their bar or on hold: ${IDS.a}, ${IDS.b}, ${IDS.community}.`);
    expect(prompt).not.toContain(IDS.next);
    expect(t.db.rankings).toEqual([{ runId: 'run-1', order: [IDS.a, IDS.b], moves: [{ card_id: IDS.a, from: 2, to: 1 }, { card_id: IDS.b, from: 1, to: 2 }] }]);
    expect(output).toMatchObject({ session: 'claude:session-1', moves: [{ card_id: IDS.a, from: 2, to: 1 }, { card_id: IDS.b, from: 1, to: 2 }], unapplied: 0 });
    expect(t.workspace.closed).toBe(1);
    for (const row of t.db.ledger) expect([row.billed_to, row.card_id, row.role_id]).toEqual(['founder', null, 'role-head']);
  });

  it('never offers a card whose only money is a payment on hold, and the ranking of the others applies', async () => {
    const t = setup({ head: [JSON.stringify({ order: [{ card_id: IDS.a, reason_code: 'player_visible' }, { card_id: IDS.b, reason_code: 'keeps_its_place' }] })] }, 'studio_ranking');
    expect(t.db.openCardRows.find((row) => row.id === IDS.held)).toMatchObject({ horizon: 'now', stage: 'proposed', funded_usd: 0 });
    const output = await studioRanking(t.context);
    const rankableLine = t.sessions[0]!.prompt.split('\n').find((line) => line.startsWith('Rankable:'))!;
    expect(rankableLine).not.toContain(IDS.held);
    expect(t.sessions[0]!.prompt).toContain(`"id": "${IDS.held}"`);
    expect(output).toMatchObject({ moves: [{ card_id: IDS.a, from: 2, to: 1 }, { card_id: IDS.b, from: 1, to: 2 }], unapplied: 0 });
    expect(t.db.openCardRows.find((row) => row.id === IDS.held)!.rank).toBe(3);
  });

  it('fails, writing no rank, when the answer names a card that holds money or is off now, or the session fails', async () => {
    for (const card of [IDS.funded, IDS.held, IDS.next]) {
      const t = setup({ head: [JSON.stringify({ order: [{ card_id: card, reason_code: 'keeps_its_place' }] })] }, 'studio_ranking');
      await expect(studioRanking(t.context)).rejects.toThrow('not rankable');
      expect(t.db.rankings).toEqual([]);
    }
    const invalid = setup({ head: ['First, the Cart.'] }, 'studio_ranking');
    await expect(studioRanking(invalid.context)).rejects.toThrow("the Studio Head's session failed: the final message is not exactly one JSON object");
    const failed = setup({ head: [JSON.stringify({ order: [] })], fail: ['head'] }, 'studio_ranking');
    await expect(studioRanking(failed.context)).rejects.toThrow('the model call failed');
    expect([invalid.db.rankings, failed.db.rankings]).toEqual([[], []]);
    expect(failed.workspace.closed).toBe(1);
  });
});

describe('draft_card', () => {
  it('approves a draft that passes the checks and the Director, from a separate session, with the draft fields and the target equal to the estimate', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, 'draft_card');
    const output = await draftCard(t.context);
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer', 'director']);
    expect(t.sessions[0]!.tools).toEqual(['Read', 'Glob', 'Grep', 'Bash']);
    expect(t.sessions[1]!.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(t.db.drafts).toHaveLength(1);
    const draft = t.db.drafts[0]!;
    expect(draft.fields).toEqual({ title: DRAFT.title, summary: DRAFT.summary, intent: DRAFT.intent, acceptance_test: DRAFT.acceptance_test, lane: 'config', executor_role_id: 'role-builder-a', estimate_usd: 0.5 });
    expect([draft.status, draft.role_id, draft.maker_ref, draft.grader_ref]).toEqual(['approved', 'role-designer', 'claude:session-1', 'claude:session-2']);
    expect(t.db.draftCards).toEqual([
      { id: 'card-from-draft-1', draft_id: 'draft-1', approver_role_id: 'role-director', grader_ref: 'claude:session-2', verdict: { result: 'approved', reason_codes: ['fits_pillars'], round: 1 }, content_sha256: draft.content_sha256 },
    ]);
    expect(output).toMatchObject({ result: 'approved', card_id: 'card-from-draft-1', draft_id: 'draft-1', base_sha: BASE_SHA });
    expect(t.sessions[1]!.prompt).toContain(RUBRIC.trim());
    expect(t.scanned).toEqual([[DRAFT.title, DRAFT.summary, DRAFT.intent, DRAFT.acceptance_test]]);
    expect(t.workspace.closed).toBe(1);
    const roles = new Set(t.db.ledger.map((row) => row.role_id));
    expect(roles).toEqual(new Set(['role-designer', 'role-director']));
    for (const row of t.db.ledger) expect([row.billed_to, row.card_id]).toEqual(['founder', null]);
  });

  it('gives the Game Designer no Bash in an unattended process, so no seed-1 code runs on the host, and still approves', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, 'draft_card');
    const output = await draftCard({ ...t.context, mode: 'unattended' });
    expect(t.sessions.map((s) => [s.kind, s.tools])).toEqual([
      ['designer', ['Read', 'Glob', 'Grep']],
      ['director', ['Read', 'Glob', 'Grep']],
    ]);
    expect(output).toMatchObject({ result: 'approved', card_id: 'card-from-draft-1' });
  });

  it('starts a new round on revise, giving the Designer the codes, the note and its last draft, then approves', async () => {
    const second = { ...DRAFT, summary: 'Building a gatherer costs 11 dust.' };
    const t = setup({ designer: [JSON.stringify(DRAFT), JSON.stringify(second)], director: [verdict('revise', ['unclear_text'], 'Say it costs dust.'), verdict('approved', ['fits_pillars'])] }, 'draft_card');
    const output = await draftCard(t.context);
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer', 'director', 'designer', 'director']);
    expect(t.sessions[2]!.prompt).toContain('The Game Director sent your last draft back to revise: unclear_text.');
    expect(t.sessions[2]!.prompt).toContain('Note: Say it costs dust.');
    expect(t.sessions[2]!.prompt).toContain('round 2 of 3');
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([
      ['withdrawn', ['unclear_text']],
      ['approved', []],
    ]);
    expect(output).toMatchObject({ result: 'approved', card_id: 'card-from-draft-2' });
  });

  it('withdraws a flagged draft with its reason codes and writes no card', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('flagged', ['duplicate_card'])] }, 'draft_card');
    expect(await draftCard(t.context)).toMatchObject({ result: 'withdrawn', reason: 'flagged', reason_codes: ['duplicate_card'] });
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([['withdrawn', ['duplicate_card']]]);
    expect(t.db.draftCards).toEqual([]);
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer', 'director']);
  });

  it('withdraws after a third round without approval', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT), JSON.stringify(DRAFT), JSON.stringify(DRAFT)], director: [verdict('revise', ['off_pillar']), verdict('revise', ['off_pillar']), verdict('revise', ['estimate_implausible'])] }, 'draft_card');
    expect(await draftCard(t.context)).toMatchObject({ result: 'withdrawn', reason: 'no_approval_in_three_rounds' });
    expect(t.sessions).toHaveLength(6);
    expect(t.db.drafts.map((d) => d.status)).toEqual(['withdrawn', 'withdrawn', 'withdrawn']);
    expect(t.db.draftCards).toEqual([]);
  });

  it('refuses a draft by its check before any grading and sends it back as a new round', async () => {
    const holds = { ...DRAFT, acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 10' };
    const t = setup({ designer: [JSON.stringify(holds), JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, 'draft_card');
    const output = await draftCard(t.context);
    expect(t.sessions.map((s) => s.kind)).toEqual(['designer', 'designer', 'director']);
    expect(t.sessions[1]!.prompt).toContain('Your last draft was refused by the already_holds check: already true on main');
    expect(t.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([
      ['withdrawn', ['check_already_holds']],
      ['approved', []],
    ]);
    expect(output).toMatchObject({ result: 'approved', rounds: [{ round: 1, check: { name: 'already_holds' } }, { round: 2, verdict: { result: 'approved' } }] });
  });

  it('refuses an answer that is not one valid draft as the schema check, and fails the run with nothing written after three', async () => {
    const t = setup({ designer: ['A card about gatherers.', JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, 'draft_card');
    expect(await draftCard(t.context)).toMatchObject({ result: 'approved', rounds: [{ round: 1, check: { name: 'schema' } }, { round: 2 }] });
    const never = setup({ designer: ['No.', '{"title": "x"}', `${JSON.stringify(DRAFT)} and more`] }, 'draft_card');
    await expect(draftCard(never.context)).rejects.toThrow('no valid draft in 3 rounds');
    expect([never.db.drafts, never.db.draftCards]).toEqual([[], []]);
  });

  it('sends back a draft whose text is blank or whose estimate rounds to nothing as the schema check, before record_card_draft could refuse it', async () => {
    // record_card_draft refuses these (card_from_draft trims text and rounds the estimate to 4
    // places), so the schema refuses them first and the round goes back to the Designer.
    for (const blank of [{ ...DRAFT, title: '   ' }, { ...DRAFT, intent: '\n\t' }, { ...DRAFT, estimate_usd: 0.00004 }]) {
      const t = setup({ designer: [JSON.stringify(blank), JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, 'draft_card');
      expect(await draftCard(t.context), JSON.stringify(blank)).toMatchObject({ result: 'approved', rounds: [{ round: 1, draft_id: null, check: { name: 'schema' } }, { round: 2 }] });
      expect(t.db.drafts.map((d) => d.status)).toEqual(['approved']);
    }
  });

  it('fails the run, writing no card, when a model call fails or the Director does not answer with one verdict', async () => {
    const designerDown = setup({ designer: [JSON.stringify(DRAFT)], fail: ['designer'] }, 'draft_card');
    await expect(draftCard(designerDown.context)).rejects.toThrow("the Game Designer's session failed: the model call failed");
    expect(designerDown.db.drafts).toEqual([]);
    const directorDown = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])], fail: ['director'] }, 'draft_card');
    await expect(draftCard(directorDown.context)).rejects.toThrow("the Game Director's session failed");
    expect(directorDown.db.drafts.map((d) => [d.status, d.reason_codes])).toEqual([['withdrawn', ['grade_failed']]]);
    const directorProse = setup({ designer: [JSON.stringify(DRAFT)], director: ['Looks good to me.'] }, 'draft_card');
    await expect(draftCard(directorProse.context)).rejects.toThrow("the Game Director's session failed");
    for (const t of [designerDown, directorDown, directorProse]) {
      expect(t.db.draftCards).toEqual([]);
      expect(t.workspace.closed).toBe(1);
    }
  });

  it('keeps community free text out of the Designer and Director prompts, and passes the floor and the named open cards', async () => {
    const t = setup({ designer: [JSON.stringify(DRAFT)], director: [verdict('approved', ['fits_pillars'])] }, 'draft_card', { floor: { open: 5, short: 2 }, open_cards: [IDS.a, { id: IDS.community }] });
    await draftCard(t.context);
    expectNoCommunityText(t.sessions.map((s) => s.prompt));
    expect(t.sessions[0]!.prompt).toContain('The floor: {"open":5,"short":2}.');
    expect(t.sessions[0]!.prompt).toContain(IDS.community);
    expect(t.sessions[0]!.prompt).not.toContain(IDS.b);
    expect(t.sessions[0]!.prompt).toContain('Executors: Builder A, Builder B, QA.');
  });

  it('refuses to start without an unpaused Game Director, or with input other than {} or {floor, open_cards}', async () => {
    const paused = setup({}, 'draft_card');
    paused.db.roles = paused.db.roles.map((r) => (r.name === 'Game Director' ? { ...r, paused: true } : r));
    await expect(draftCard(paused.context)).rejects.toThrow('the Game Director is paused');
    expect(paused.sessions).toEqual([]);
    expect(parseDraftInput({})).toEqual({ floor: null, openCardIds: null });
    expect(parseDraftInput({ floor: 3, open_cards: [IDS.a] })).toEqual({ floor: 3, openCardIds: [IDS.a] });
    expect(() => parseDraftInput({ card_id: IDS.a })).toThrow('draft_card takes {} or {floor, open_cards}');
    expect(() => parseDraftInput({ floor: 'many' })).toThrow('floor must be a number');
    expect(() => parseDraftInput({ open_cards: [3] })).toThrow('open_cards holds card ids');
  });
});

describe('the two jobs on the queue', () => {
  const JOBS: Job[] = [
    { name: 'studio_ranking', role_id: 'role-head', calls_model: true, runs_when_paused: true },
    { name: 'draft_card', role_id: 'role-designer', calls_model: true, runs_when_paused: true },
  ];

  function tick(t: ReturnType<typeof setup>, mode: 'attended' | 'unattended') {
    const state: JobState = { running: null };
    t.db.jobList = JOBS;
    t.db.lease = { holder: 'mac', expiresAt: NOW.getTime() + 300_000 };
    const run = () =>
      jobTick({
        db: t.db,
        mode,
        adapter: { mode } as unknown as AgentAdapter,
        log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
        alert: new RecordingAlerter(),
        now: () => NOW,
        leaseHolder: 'mac',
        boardSessionTtlMin: 3,
        watchIntervalMs: 5,
        state,
        stopSignal: new AbortController().signal,
        handlers: HANDLERS,
        workflow: t.context.workflow!,
      });
    return { state, run };
  }

  it('registers the two role jobs and the Janitor\'s two code jobs (docs/specs/agent-upkeep.md)', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(['draft_card', 'janitor', 'studio_ranking', 'upkeep_merge']);
  });

  for (const mode of ['attended', 'unattended'] as const) {
    it(`runs a board-origin Rank now in ${mode} mode while the studio is paused and a board member is signed in, and waits otherwise`, async () => {
      const t = setup({ head: [JSON.stringify({ order: [{ card_id: IDS.a, reason_code: 'player_visible' }, { card_id: IDS.b, reason_code: 'keeps_its_place' }] })] }, 'studio_ranking');
      t.db.studio.paused = true;
      const q = tick(t, mode);
      const enqueue = (origin: JobOrigin) => t.db.enqueueJobRun({ job: 'studio_ranking', origin });
      t.db.boardActive = false;
      const board = await enqueue('board');
      expect(await q.run()).toEqual({ action: 'idle', skipped: 0, waiting: 1 });
      const scheduled = await enqueue('schedule');
      t.db.boardActive = true;
      expect(await q.run()).toEqual({ action: 'started', runId: board.id, job: 'studio_ranking' });
      await q.state.running?.done;
      const done = t.db.jobRuns.find((r) => r.id === board.id)!;
      expect([done.status, done.reason]).toEqual(['succeeded', null]);
      expect(done.output).toMatchObject({ moves: [{ card_id: IDS.a, from: 2, to: 1 }, { card_id: IDS.b, from: 1, to: 2 }] });
      await q.run();
      const skipped = t.db.jobRuns.find((r) => r.id === scheduled.id)!;
      expect([skipped.status, skipped.reason]).toEqual(['skipped', 'not_board_origin']);
    });
  }
});
