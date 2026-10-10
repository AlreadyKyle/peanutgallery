// The replay eval runner (docs/specs/agent-upkeep.md), on fixtures: no model is called here. The live
// run is a person at the Mac, on the founder's plan (platform/agents/evals/README.md).
// - it deletes both API keys, and refuses in CI, in Actions and in unattended mode;
// - it writes no database row: its store refuses every call the draft handler and a role session do
//   not make, and a designer and a director case run through the draft handler's own steps on it;
// - it writes a result with pass^k per set, the model ids and the CLI version, and exits 1 below the
//   baseline and 0 at or above it.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DraftVerdict } from '../src/job-handlers/draft-card.js';
import type { WorkflowDeps } from '../src/job-handlers/workflow.js';
import {
  belowBaseline,
  designerPass,
  directorPass,
  draftRunners,
  inMemoryStore,
  loadCases,
  parseArgs,
  refusal,
  removeApiKeys,
  replay,
  resultStamp,
  runSet,
  specRoles,
  type DirectorCase,
  type EvalCase,
  type Runners,
} from '../src/evals/replay.js';
import { parsePriceTable } from '../src/pricing.js';
import { TypedOutput } from '../src/typed-output.js';
import { FakeAdapter, usageEvent } from './helpers/fake-adapter.js';
import { NOW } from './helpers/fake-db.js';

const DISPATCHER = path.resolve(import.meta.dirname, '..');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function scratch(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'eval-replay-'));
  dirs.push(dir);
  return dir;
}

const STUDIO = { paused: false, agent_mode: 'attended', daily_cap_usd: 0, card_max_usd: 5, agent_hourly_rate_usd: 0, studio_reserve_usd: 0, monthly_cap_usd: null, anthropic_tier_cap_usd: null, platform_lane_open: false };
const approved: DraftVerdict = { result: 'approved', reason_codes: ['fits_pillars'] };
const offPillar: DraftVerdict = { result: 'revise', reason_codes: ['off_pillar'], note: 'One screen.' };

describe('the environment', () => {
  it('deletes the studio and Anthropic API keys', () => {
    const env: NodeJS.ProcessEnv = { STUDIO_ANTHROPIC_API_KEY: 'studio', ANTHROPIC_API_KEY: 'founder', MODEL_DIRECTOR: 'claude-x' };
    removeApiKeys(env);
    expect(env).toEqual({ MODEL_DIRECTOR: 'claude-x' });
  });

  it('refuses in CI, in Actions and in unattended mode, and runs attended otherwise', () => {
    expect(refusal({ CI: 'true' })).toMatch(/CI is set/);
    expect(refusal({ GITHUB_ACTIONS: 'true' })).toMatch(/GITHUB_ACTIONS is set/);
    expect(refusal({ AGENT_MODE: 'unattended' })).toMatch(/AGENT_MODE is unattended/);
    expect(refusal({ AGENT_MODE: 'attended' })).toBeNull();
    expect(refusal({})).toBeNull();
  });

  for (const [name, value] of [
    ['CI', 'true'],
    ['GITHUB_ACTIONS', 'true'],
    ['AGENT_MODE', 'unattended'],
  ] as const) {
    it(`the command refuses with ${name} set, before any session`, () => {
      const run = spawnSync(process.execPath, [path.join(DISPATCHER, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/evals/replay.ts', '--', '--set', 'draft', '--k', '1'], {
        cwd: DISPATCHER,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, [name]: value },
        encoding: 'utf8',
      });
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/^eval:replay refused: /);
    });
  }

  it('reads --set and --k past pnpm\'s --', () => {
    expect(parseArgs(['--', '--set', 'draft', '--k', '3'])).toEqual({ set: 'draft', k: 3 });
    expect(parseArgs(['--set', 'draft'])).toEqual({ set: 'draft', k: 3 });
    expect(() => parseArgs(['--set', 'visual'])).toThrow(/--set must be one of draft/);
    expect(() => parseArgs(['--set', 'draft', '--k', '0'])).toThrow(/--k/);
  });
});

describe('the draft set', () => {
  it('holds eight frozen drafts, half expected approved and half not, and a Designer case from empty input', async () => {
    const cases = await loadCases('draft');
    const director = cases.filter((c): c is DirectorCase => c.kind === 'director');
    expect(director.length).toBeGreaterThanOrEqual(8);
    const good = director.filter((c) => c.expect.result.join() === 'approved');
    expect(good.length * 2).toBe(director.length);
    for (const c of director.filter((x) => !good.includes(x))) {
      expect(c.expect.result).not.toContain('approved');
      expect(['off_pillar', 'not_all_ages']).toContain(c.expect.reason_code);
    }
    expect(director.filter((c) => c.expect.reason_code === 'not_all_ages').every((c) => c.expect.result.join() === 'flagged')).toBe(true);
    expect(cases.filter((c) => c.kind === 'designer')).toEqual([expect.objectContaining({ id: 'designer-from-empty', input: {}, expect: { approved_within_rounds: 3 } })]);
  });

  it('judges a verdict and a draft run against their expectations', () => {
    expect(directorPass({ result: ['approved'] }, approved)).toBe(true);
    expect(directorPass({ result: ['approved'] }, offPillar)).toBe(false);
    expect(directorPass({ result: ['revise', 'flagged'], reason_code: 'off_pillar' }, offPillar)).toBe(true);
    expect(directorPass({ result: ['flagged'], reason_code: 'not_all_ages' }, offPillar)).toBe(false);
    expect(designerPass({ approved_within_rounds: 3 }, { result: 'approved', rounds: [{}, {}] })).toBe(true);
    expect(designerPass({ approved_within_rounds: 1 }, { result: 'approved', rounds: [{}, {}] })).toBe(false);
    expect(designerPass({ approved_within_rounds: 3 }, { result: 'withdrawn', rounds: [{}] })).toBe(false);
  });
});

const CASES: EvalCase[] = [
  { id: 'good', kind: 'director', draft: {} as DirectorCase['draft'], expect: { result: ['approved'] } },
  { id: 'bad', kind: 'director', draft: {} as DirectorCase['draft'], expect: { result: ['revise', 'flagged'], reason_code: 'off_pillar' } },
  { id: 'designer', kind: 'designer', input: {}, expect: { approved_within_rounds: 3 } },
];

// Answers by case: the good draft approved every run, the bad one approved on its second run only,
// and the Designer approved in two rounds.
function fixtureRunners(): Runners & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async director(c, run) {
      calls.push(run);
      if (c.id === 'good') return approved;
      return run.endsWith('-2') ? approved : offPillar;
    },
    async designer(_c, run) {
      calls.push(run);
      return { result: 'approved', rounds: [{}, {}] };
    },
  };
}

describe('the result', () => {
  it('runs every case k times and gives pass^k for the set', async () => {
    const runners = fixtureRunners();
    const set = await runSet(CASES, 3, runners);
    expect(runners.calls).toHaveLength(9);
    expect(set).toEqual({ cases: 3, k: 3, pass_k: 0.6667, passes: { good: 3, bad: 2, designer: 3 } });
  });

  it('counts a run that throws as a failed run', async () => {
    const set = await runSet([CASES[0]!], 2, {
      director: async () => {
        throw new Error('the session failed');
      },
      designer: async () => undefined,
    });
    expect(set).toMatchObject({ pass_k: 0, passes: { good: 0 } });
  });

  it('writes results/<UTC stamp>.json with the commit, the CLI version, the model ids and pass^k, and exits 1 below the baseline', async () => {
    const dir = scratch();
    writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ sets: { draft: 0.75 }, reason: 'first attended run' }));
    const meta = { commit: 'a'.repeat(40), cli_version: '2.1.280', model_ids: { MODEL_DIRECTOR: 'claude-director' } };
    const below = await replay({ set: 'draft', k: 3, cases: CASES, runners: fixtureRunners(), meta, dir, now: NOW });
    expect(below.exitCode).toBe(1);
    expect(below.below).toEqual(['draft 0.6667 < 0.75']);
    expect(path.relative(dir, below.file)).toBe(`results/${resultStamp(NOW)}.json`);
    expect(resultStamp(NOW)).toBe('20260914T150000Z');
    expect(JSON.parse(readFileSync(below.file, 'utf8'))).toEqual({ ...meta, sets: { draft: { cases: 3, k: 3, pass_k: 0.6667, passes: { good: 3, bad: 2, designer: 3 } } } });

    writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ sets: { draft: 0.6667 }, reason: 'moved by the board' }));
    const at = await replay({ set: 'draft', k: 3, cases: CASES, runners: fixtureRunners(), meta, dir, now: new Date(NOW.getTime() + 1000) });
    expect(at.exitCode).toBe(0);
    expect(readdirSync(path.join(dir, 'results'))).toHaveLength(2);
  });

  it('exits 0 with no baseline yet, and names a set the result lacks as below it', () => {
    expect(belowBaseline({ sets: {} }, null)).toEqual([]);
    expect(belowBaseline({ sets: {} }, { sets: { draft: 0.5 } })).toEqual(['draft missing < 0.5']);
  });
});

describe('no database row', () => {
  it("the store answers only the draft handler's and a role session's calls", async () => {
    const db = inMemoryStore([], STUDIO);
    await expect(db.getStudioState()).resolves.toMatchObject({ card_max_usd: 5 });
    expect(() => db.insertEvent('card', null, 'message', {})).toThrow(/writes no database row; insertEvent/);
    expect(() => db.claimCard('card')).toThrow(/writes no database row; claimCard/);
    expect(() => db.enqueueJobRun({ job: 'draft_card', origin: 'board' })).toThrow(/writes no database row/);
  });

  it('runs a Director case and a Designer case through the draft handler on the store, and nothing else', async () => {
    const roles = (await specRoles()).map((role) => ({ ...role, model: 'director-class' }));
    const draft = {
      title: 'Carts haul a little faster',
      summary: 'Each cart hauls 1.6 dust a second instead of 1.5.',
      intent: 'Raise the cart rate.',
      acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=cart].rate == 1.6',
      lane: 'config',
      executor: 'Builder A',
      estimate_usd: 0.5,
    };
    const prompts: string[] = [];
    const adapter = new FakeAdapter(
      async (spec, emit) => {
        prompts.push(spec.prompt);
        await emit({ type: 'start', sessionId: `s-${prompts.length}`, model: 'director-class', tools: spec.roleTools, apiKeySource: 'none' });
        await emit(usageEvent(1, 100, 'director-class'));
      },
      { result: (spec) => (spec.prompt.startsWith('Draft a game card') ? JSON.stringify(draft) : JSON.stringify(approved)) },
    );
    let opened = 0;
    const workflow: WorkflowDeps = {
      roleAdapter: adapter,
      typed: new TypedOutput(),
      priceTable: parsePriceTable(JSON.stringify({ 'director-class': { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 } })),
      sessionMaxTurns: 20,
      sessionMaxMs: 60_000,
      watchIntervalMs: 5,
      scanText: async () => ({ ok: true }),
      openWorkspace: async () => {
        opened += 1;
        return { path: os.tmpdir(), baseSha: 'b'.repeat(40), readMain: async () => JSON.stringify({ rows: [{ id: 'cart', rate: 1.5 }] }), close: async () => undefined };
      },
      rubric: async () => 'rubric',
      ledgerRetryMs: 1,
    };
    const runners = draftRunners(workflow, roles, STUDIO, new AbortController().signal);
    const cases = await loadCases('draft');
    const verdict = await runners.director(cases.find((c): c is DirectorCase => c.id === 'director-good-cart-rate')!, 'eval-good-1');
    expect(verdict).toEqual(approved);
    const output = await runners.designer({ id: 'designer-from-empty', kind: 'designer', input: {}, expect: { approved_within_rounds: 3 } }, 'eval-designer-1');
    expect(output).toMatchObject({ result: 'approved', card_id: 'eval-card-for-eval-draft-1' });
    expect(opened).toBe(2);
    expect(prompts.map((p) => p.split(' (')[0])).toEqual(['Grade a game card draft', 'Draft a game card', 'Grade a game card draft']);
  });
});
