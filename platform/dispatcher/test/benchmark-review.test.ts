// benchmark_review (src/job-handlers/benchmark-review.ts, src/benchmarks.ts, docs/specs/operations.md):
// the scoreboard is computed by code from the daily counts; a model is called only for rows below
// their floor (on a watch, only newly below); the session holds the Studio Head's role, is billed as
// overhead and reads counts only; its findings are kept only for the rows below their floor and land
// as benchmark findings the board lists; recovered rows close; nothing spends or opens a card.
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { AgentAdapter, SessionSpec } from '../src/adapters/types.js';
import { ROWS, scoreboard, type MetricsDay } from '../src/benchmarks.js';
import type { BenchmarkReviewRecord, JobOrigin } from '../src/db.js';
import { benchmarkReview, WITHHELD } from '../src/job-handlers/benchmark-review.js';
import { HANDLERS } from '../src/job-handlers/index.js';
import type { WorkflowDeps } from '../src/job-handlers/workflow.js';
import type { JobContext } from '../src/jobs.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { TypedOutput } from '../src/typed-output.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeAdapter, usageEvent } from './helpers/fake-adapter.js';
import { FakeDb, NOW, role } from './helpers/fake-db.js';

const MODEL = 'director-class';
const PRICE_TABLE = parsePriceTable(JSON.stringify({ [MODEL]: { input: 1, output: 5, cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 } }));
const typed = new TypedOutput();
const HEAD = role({ id: 'role-head', name: 'Studio Head', title: 'Studio Head', model: MODEL, prompt_path: 'platform/agents/prompts/studio-head.md', tools_json: ['Read', 'Glob', 'Grep'], write_access: true, agent_class: 'planner' });

// 60 days, oldest first, each with the same counts.
function days(metrics: Record<string, number>, n = 60): MetricsDay[] {
  return Array.from({ length: n }, (_, i) => ({ day: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, metrics: { ...metrics } }));
}

// A healthy studio: every measurable row at or above target.
const HEALTHY = {
  'money.payments': 5, 'money.gross_usd': 50, 'money.supporters_30d': 120, 'money.median_30d': 10, 'money.repeat_supporters': 1, 'money.new_supporters': 3,
  'money.studio_pct_sum': 100, 'money.machine_usd': 10, 'money.refunded_usd': 0,
  'play.dust_load': 100, 'play.home_load': 300, 'play.dust_next_card': 4, 'play.dust_share': 4, 'play.card_share': 3,
  'community.seeds_saved': 6, 'community.profiles_new': 7, 'community.suggestions': 3,
};

function setup(input: { metrics: MetricsDay[]; trigger?: string; answer?: (spec: SessionSpec) => string; scan?: (text: string) => boolean; open?: string[] }) {
  const db = new FakeDb();
  db.roles = [HEAD];
  for (const metric of input.open ?? []) db.findings.push({ fingerprint: `benchmark:${metric}`, kind: 'benchmark', subject: 'x', detail: {}, opened_at: NOW.toISOString(), closed_at: null });
  const records: BenchmarkReviewRecord[] = [];
  Object.assign(db, {
    benchmarkReviewInputs: async () => ({ days: input.metrics, lastReviewAt: null, studio: { cards_by_stage: { live: 3 }, goals_reached: 1 } }),
    recordBenchmarkReview: async (review: BenchmarkReviewRecord) => {
      records.push(structuredClone(review));
      return 'review-1';
    },
  });
  const specs: SessionSpec[] = [];
  const fake = new FakeAdapter(
    async (spec, emit) => {
      specs.push(spec);
      await emit({ type: 'start', sessionId: 'sesn_1', model: MODEL, tools: [], apiKeySource: 'ANTHROPIC_API_KEY', ledger: 'adapter' });
      await emit(usageEvent(1, 200, MODEL));
    },
    { mode: 'unattended', result: input.answer ?? (() => '{}') },
  );
  const adapter: AgentAdapter = { mode: 'unattended', preflight: (spec) => fake.preflight(spec), run: (spec, onEvent, signal) => fake.run(spec, onEvent, signal) };
  const workflow: WorkflowDeps = {
    adapter,
    draftSessionMaxUsd: 0.75,
    typed,
    priceTable: PRICE_TABLE,
    sessionMaxTurns: 5,
    sessionMaxMs: 60_000,
    watchIntervalMs: 5,
    scanText: async (strings) => (strings.every(input.scan ?? (() => true)) ? { ok: true } : { ok: false, detail: 'banned phrase' }),
    openWorkspace: async () => {
      throw new Error('the review opens no workspace');
    },
    rubric: async () => '',
    ledgerRetryMs: 1,
  };
  const run = { id: 'run-r1', job_name: 'benchmark_review', origin: 'schedule' as JobOrigin, status: 'running' as const, card_id: null, input: input.trigger ? { trigger: input.trigger } : {}, parent_run_id: null, created_at: NOW.toISOString() };
  const context: JobContext = {
    run,
    job: { name: 'benchmark_review', role_id: HEAD.id, calls_model: true, runs_when_paused: false, enabled: true },
    role: HEAD,
    mode: 'unattended',
    db,
    adapter,
    log: createLogger(new Writable({ write: (_c, _e, cb) => cb() })),
    alert: new RecordingAlerter(),
    stopSignal: new AbortController().signal,
    now: () => NOW,
    workflow,
  };
  return { context, db, specs, records };
}

describe('the benchmark scoreboard', () => {
  it('measures each row from the counts, reads a missing counter or a zero denominator as not measured, and compares with floors', () => {
    const rows = scoreboard(days(HEALTHY));
    const by = new Map(rows.map((row) => [row.metric, row]));
    expect(rows).toHaveLength(ROWS.length);
    expect(by.get('money.gross_30d')!.value).toBe(1500);
    expect(by.get('money.median_30d')!.status).toBe('meets_target');
    expect(by.get('money.studio_share')!.value).toBe(0.2);
    expect(by.get('funnel.visitor_to_player')!.value).toBeCloseTo(1 / 3, 4);
    // No returning flag sent yet: D1 is not measured, never estimated.
    expect(by.get('play.d1')!.status).toBe('not_measured');
    expect(by.get('play.d1')!.value).toBeNull();
    expect(rows.filter((row) => row.status === 'below_floor')).toEqual([]);

    // The game's and the site's counters, once sent (docs/specs/counter-senders.md).
    const sent = new Map(
      scoreboard(days({ ...HEALTHY, 'play.dust_return_1d': 25, 'play.dust_return_7d': 5, 'play.dust_session_2m': 60, 'play.dust_session_4m': 40, 'play.home_dwell_mid': 180, 'play.home_dwell_long': 120 })).map((row) => [row.metric, row]),
    );
    expect([sent.get('play.d1')!.value, sent.get('play.d1')!.status]).toEqual([0.25, 'meets_target']);
    expect([sent.get('play.d7')!.value, sent.get('play.d7')!.status]).toEqual([0.05, 'between']);
    expect([sent.get('play.session_4m')!.value, sent.get('play.session_4m')!.status]).toEqual([0.4, 'between']);
    expect([sent.get('site.dwell_mid')!.value, sent.get('site.dwell_mid')!.status]).toEqual([0.6, 'meets_target']);
    expect([sent.get('site.dwell_long')!.value, sent.get('site.dwell_long')!.status]).toEqual([0.4, 'between']);
    expect(by.get('site.dwell_mid')!.status).toBe('not_measured');
    const short = scoreboard(days({ ...HEALTHY, 'play.home_dwell_mid': 90, 'play.home_dwell_long': 10 })).find((row) => row.metric === 'site.dwell_mid')!;
    expect(short.status).toBe('below_floor');

    const poor = new Map(scoreboard(days({ ...HEALTHY, 'money.median_30d': 4, 'money.refunded_usd': 2 })).map((row) => [row.metric, row]));
    expect(poor.get('money.median_30d')!.status).toBe('below_floor');
    expect(poor.get('money.refund_rate')!.status).toBe('below_floor');
  });

  it('reads cost per shipped card against the previous window: a rise of more than half is below the floor', () => {
    const before = days({ 'cards.live': 2, 'cards.live_spend_usd': 1 }, 30);
    const after = days({ 'cards.live': 2, 'cards.live_spend_usd': 2 }, 30);
    const row = scoreboard([...before, ...after]).find((r) => r.metric === 'cards.cost_per_live')!;
    expect([row.value, row.previous, row.status]).toEqual([1, 0.5, 'below_floor']);
  });
});

describe('benchmark_review', () => {
  it('is the handler for benchmark_review', () => {
    expect(HANDLERS.benchmark_review).toBe(benchmarkReview);
  });

  it('with every row above its floor writes the scoreboard, calls no model and closes recovered findings', async () => {
    const { context, db, specs, records } = setup({ metrics: days(HEALTHY), trigger: 'milestone', open: ['money.median_30d'] });
    const out = await benchmarkReview(context);
    expect(specs).toEqual([]);
    expect(out).toMatchObject({ trigger: 'milestone', below_floor: [], closed: ['benchmark:money.median_30d'], reviewed: false, usd: 0 });
    expect(records[0]!.scoreboard).toHaveLength(ROWS.length);
    expect(db.findings.every((f) => f.closed_at !== null)).toBe(true);
  });

  it("asks the Studio Head about rows below their floor, as overhead with counts only, and records its cause and adjustment as findings", async () => {
    const answer = JSON.stringify({
      summary: 'Payments are small.',
      findings: [
        { metric: 'money.median_30d', cause: 'Most payments use the smallest preset.', adjustment: { kind: 'spec_proposal', proposal: 'Propose a spec for preset amounts on the Machine card.' } },
        { metric: 'play.d1', cause: 'Not one of the rows.', adjustment: { kind: 'escalation', proposal: 'Dropped.' } },
      ],
    });
    const { context, db, specs, records } = setup({ metrics: days({ ...HEALTHY, 'money.median_30d': 4 }), trigger: 'first', answer: () => answer });
    const out = await benchmarkReview(context);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.prompt).toContain('money.median_30d');
    expect(specs[0]!.prompt).toContain('platform/agents/schemas/benchmark-review.schema.json');
    expect(specs[0]!.roleId).toBe(HEAD.id);
    expect(out).toMatchObject({ below_floor: ['money.median_30d'], opened: ['benchmark:money.median_30d'], reviewed: true });
    const finding = db.findings.find((f) => f.fingerprint === 'benchmark:money.median_30d')!;
    expect(finding.kind).toBe('benchmark');
    expect(finding.subject).toBe('Median contribution (30d) is $4.00, below its floor (at least $5.00)');
    expect(finding.detail).toMatchObject({ cause: 'Most payments use the smallest preset.', adjustment: { kind: 'spec_proposal' }, trigger: 'first' });
    // The finding for a row that is not below its floor is dropped.
    expect(records[0]!.findings).toHaveLength(1);
    expect(records[0]!.summary).toBe('Payments are small.');
  });

  it('on a watch, calls no model for rows already open, and writes them again', async () => {
    const { context, specs } = setup({ metrics: days({ ...HEALTHY, 'money.median_30d': 4 }), trigger: 'watch', open: ['money.median_30d'] });
    const out = await benchmarkReview(context);
    expect(specs).toEqual([]);
    expect(out).toMatchObject({ below_floor: ['money.median_30d'], opened: [], reviewed: false });
  });

  it('withholds texts the content filter refuses', async () => {
    const answer = JSON.stringify({ summary: 'bad words', findings: [{ metric: 'money.median_30d', cause: 'bad words', adjustment: { kind: 'core_work', proposal: 'bad words' } }] });
    const { context, records } = setup({ metrics: days({ ...HEALTHY, 'money.median_30d': 4 }), trigger: 'first', answer: () => answer, scan: (t) => !t.includes('bad') });
    await benchmarkReview(context);
    expect(records[0]!.summary).toBe(WITHHELD);
    expect(records[0]!.findings[0]).toMatchObject({ cause: WITHHELD, adjustment: { proposal: WITHHELD } });
  });

  it('an answer outside the schema writes the findings unreviewed, never the answer', async () => {
    const { context, records, db } = setup({ metrics: days({ ...HEALTHY, 'money.median_30d': 4 }), trigger: 'first', answer: () => JSON.stringify({ summary: 'x', findings: [], open_card: true }) });
    const out = (await benchmarkReview(context)) as Record<string, unknown>;
    expect(out.reviewed).toBe(false);
    expect(String(out.not_reviewed)).toMatch(/^session_failed/);
    expect(records[0]!.reviewed).toBe(false);
    expect(db.findings.find((f) => f.fingerprint === 'benchmark:money.median_30d')!.detail).toMatchObject({ cause: null, adjustment: null });
  });
});
