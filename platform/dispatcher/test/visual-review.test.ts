// The Directors' visual review (src/visual-review.ts, docs/specs/design-review.md): the end rule's
// full table; the revision feedback holds only criteria, frame names and reason codes; the review
// starts with no board member signed in; the Game Director reviews seed-1 and the Platform Director
// platform/site; the session holds Read, Glob and Grep only, with the prompt read from the
// dispatcher's own checkout; attended, it works in the frames folder and its model calls write
// founder rows with the Director's role and no card, a replayed request id writing nothing; managed,
// the frames are mounted at FRAMES_MOUNT, the prompt names those paths and the session bills the card;
// more than twelve changed frames are reviewed in batches whose verdicts combine worst-of; a final
// message that is not one valid verdict naming frames it was shown fails the review; a credit refusal
// is named.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claudeArgs } from '../src/adapters/claude-cli.js';
import type { Card, Role } from '../src/db.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { TypedOutput } from '../src/typed-output.js';
import { SessionPaused } from '../src/adapters/types.js';
import {
  combineVerdicts,
  decideReview,
  FRAMES_MOUNT,
  MAX_REVIEW_ROUNDS,
  REVIEW_BATCH_FRAMES,
  reviewBatches,
  openCriteria,
  revisionAddendum,
  REVIEWERS,
  reviewPrompt,
  runVisualReview,
  type Criterion,
  type ReviewDecision,
  type VisualReviewDeps,
  type VisualVerdict,
} from '../src/visual-review.js';
import type { SessionSpec } from '../src/adapters/types.js';
import { FakeAdapter, usageEvent, type FakeOptions } from './helpers/fake-adapter.js';
import { FakeDb, card, role } from './helpers/fake-db.js';
import { CODE_ROOT } from './helpers/fake-managed.js';

const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'director-class': { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 } }));
const READ_SET = ['Read', 'Glob', 'Grep'];
const typed = new TypedOutput();
const silent = createLogger(new Writable({ write: (_c, _e, cb) => cb() }));
const CHANGED = ['site/home-375.png', 'site/team-1440.png'];
const SHA = 'b'.repeat(40);

const gameDirector: Role = role({ id: 'role-game-director', name: 'Game Director', title: 'Game Director', model: 'director-class', prompt_path: 'platform/agents/prompts/game-director.md', tools_json: READ_SET, write_access: false, agent_class: 'reviewer' });
const platformDirector: Role = role({ id: 'role-platform-director', name: 'Platform Director', title: 'Platform Director', model: 'director-class', prompt_path: 'platform/agents/prompts/platform-director.md', tools_json: READ_SET, write_access: false, agent_class: 'reviewer' });

function verdict(over: Partial<Record<Criterion, Partial<VisualVerdict['criteria'][Criterion]>>> = {}, frame = CHANGED[0]!): VisualVerdict {
  const pass = { verdict: 'pass' as const, frame, reason_code: 'meets' };
  return {
    criteria: {
      intent: { ...pass, ...over.intent },
      fit: { ...pass, ...over.fit },
      legibility: { ...pass, ...over.legibility },
      all_ages: { ...pass, ...over.all_ages },
    },
  };
}

const LEGIBILITY_REVISE = { legibility: { verdict: 'revise' as const, frame: 'site/team-1440.png', reason_code: 'dead_space' } };
const ALL_AGES_REVISE = { all_ages: { verdict: 'revise' as const, frame: 'site/home-375.png', reason_code: 'gambling_cue_near_money' } };

describe('decideReview', () => {
  it.each<[string, VisualVerdict, number, ReviewDecision]>([
    ['all pass, first review', verdict(), 0, 'merge'],
    ['all pass after two rounds', verdict(), 2, 'merge'],
    ['a legibility revise, no round used', verdict(LEGIBILITY_REVISE), 0, 'revise'],
    ['a legibility revise, one round used', verdict(LEGIBILITY_REVISE), 1, 'revise'],
    ['a legibility revise, two rounds used', verdict(LEGIBILITY_REVISE), 2, 'merge_open'],
    ['an all-ages revise, one round used', verdict(ALL_AGES_REVISE), 1, 'revise'],
    ['an all-ages revise, two rounds used', verdict(ALL_AGES_REVISE), 2, 'reject'],
    ['all-ages and legibility revises, two rounds used', verdict({ ...LEGIBILITY_REVISE, ...ALL_AGES_REVISE }), 2, 'reject'],
    ['an intent revise, three rounds used (a restart past the cap)', verdict({ intent: { verdict: 'revise', reason_code: 'misses_intent' } }), 3, 'merge_open'],
  ])('%s: %s', (_name, given, rounds, expected) => {
    expect(decideReview(given, rounds)).toBe(expected);
  });

  it('caps revise rounds at two', () => {
    expect(MAX_REVIEW_ROUNDS).toBe(2);
  });
});

describe('the revision feedback', () => {
  it('holds only the failing criteria, their frame names and reason codes', () => {
    const given = verdict({ ...LEGIBILITY_REVISE, fit: { verdict: 'revise', frame: 'site/home-375.png', reason_code: 'off_tokens' } });
    expect(openCriteria(given)).toEqual([
      { criterion: 'fit', frame: 'site/home-375.png', reason_code: 'off_tokens' },
      { criterion: 'legibility', frame: 'site/team-1440.png', reason_code: 'dead_space' },
    ]);
    const addendum = revisionAddendum(given, 1);
    expect(addendum.split('\n').slice(1)).toEqual(['- fit: off_tokens (frame site/home-375.png)', '- legibility: dead_space (frame site/team-1440.png)']);
    expect(addendum.split('\n')[0]).toContain('revision 1 of 2');
    expect(addendum).not.toContain('intent:');
  });
});

describe('the review prompt', () => {
  it("names the card's intent and acceptance test, the gate, every changed frame, the rubric and the schema", () => {
    const frames = [
      { frame: CHANGED[0]!, before: `${FRAMES_MOUNT}/site/home-375.before.png`, after: `${FRAMES_MOUNT}/site/home-375.after.png` },
      { frame: CHANGED[1]!, before: null, after: `${FRAMES_MOUNT}/site/team-1440.after.png` },
    ];
    const prompt = reviewPrompt({ card: card({ intent: 'Show the team.', acceptance_test: 'gate and smoke' }), sha: SHA, gateUrl: null, review: 1, frames, rubric: 'THE RUBRIC' }, typed);
    for (const line of [
      'Show the team.',
      'gate and smoke',
      SHA,
      `- site/home-375.png: before ${FRAMES_MOUNT}/site/home-375.before.png; after ${FRAMES_MOUNT}/site/home-375.after.png`,
      `- site/team-1440.png: before (none: the base did not draw it); after ${FRAMES_MOUNT}/site/team-1440.after.png`,
      'THE RUBRIC',
      'platform/agents/schemas/visual-verdict.schema.json',
    ]) {
      expect(prompt).toContain(line);
    }
    expect(prompt).not.toContain('batch');
    expect(reviewPrompt({ card: card(), sha: SHA, gateUrl: null, review: 1, frames, batch: { index: 2, count: 3 }, rubric: '' }, typed)).toContain('batch 2 of 3 of the changed frames');
  });
});

describe('batches', () => {
  it('splits the changed frames into batches of at most twelve, in order', () => {
    expect(REVIEW_BATCH_FRAMES).toBe(12);
    const names = Array.from({ length: 25 }, (_, i) => `site/f${i}.png`);
    expect(reviewBatches(names).map((batch) => batch.length)).toEqual([12, 12, 1]);
    expect(reviewBatches(names).flat()).toEqual(names);
    expect(reviewBatches(CHANGED)).toEqual([CHANGED]);
  });

  it('combines worst-of per criterion, naming the first batch that sends a criterion back', () => {
    const first = verdict({ intent: { verdict: 'revise', frame: 'site/a.png', reason_code: 'misses_intent' } }, 'site/a.png');
    const second = verdict({ intent: { verdict: 'revise', frame: 'site/b.png', reason_code: 'worse_than_before' }, legibility: { verdict: 'revise', frame: 'site/b.png', reason_code: 'dead_space' } }, 'site/b.png');
    const combined = combineVerdicts([first, second]);
    expect(combined.criteria.intent).toEqual({ verdict: 'revise', frame: 'site/a.png', reason_code: 'misses_intent' });
    expect(combined.criteria.legibility).toEqual({ verdict: 'revise', frame: 'site/b.png', reason_code: 'dead_space' });
    expect(combined.criteria.fit).toEqual({ verdict: 'pass', frame: 'site/a.png', reason_code: 'meets' });
    expect(combineVerdicts([verdict()])).toEqual(verdict());
  });
});

describe('runVisualReview', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-review-'));
    // home-375 has a before frame; team-1440 is new.
    await mkdir(path.join(dir, 'site'), { recursive: true });
    for (const file of ['site/home-375.before.png', 'site/home-375.after.png', 'site/team-1440.after.png']) await writeFile(path.join(dir, file), 'png');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function setup(answer: string, options: FakeOptions = {}, sessionId = 'review-session') {
    const db = new FakeDb();
    db.roles = [role(), gameDirector, platformDirector];
    const adapter = new FakeAdapter(
      async (_spec, emit) => {
        await emit({ type: 'start', sessionId, model: 'director-class', tools: READ_SET, apiKeySource: 'none' });
        await emit(usageEvent(1, 400, 'director-class'));
      },
      { result: answer, ...options },
    );
    const stop = new AbortController();
    const deps: VisualReviewDeps = {
      db,
      session: { adapter, allowAttended: true, typed, priceTable: PRICE_TABLE, maxTurns: 20, maxMs: 60_000, watchIntervalMs: 5, log: silent, stopSignal: stop.signal, ledgerRetryMs: 1 },
      rubric: async () => 'THE RUBRIC',
      promptRoot: '/code-root',
    };
    return { db, adapter, deps, stop };
  }

  const input = (c: Card, changed: string[] = CHANGED) => ({ card: c, frames: { dir, changed }, sha: SHA, gateUrl: null, review: 1, budgetUsd: 5 });

  it('runs the Platform Director for a platform/site card and the Game Director for a seed-1 card, each with Read, Glob and Grep only, in the frames folder', async () => {
    for (const [folder, director] of [['platform', platformDirector], ['seed-1', gameDirector]] as const) {
      const { adapter, deps } = setup(JSON.stringify(verdict()));
      const outcome = await runVisualReview(input(card({ folder })), deps);
      expect(outcome).toMatchObject({ kind: 'verdict', ref: 'claude:review-session', refs: ['claude:review-session'], director: { id: director.id } });
      expect(REVIEWERS[folder]).toBe(director.name);
      const spec = adapter.specs[0]!;
      expect(spec.roleId).toBe(director.id);
      expect(spec.worktree).toBe(dir);
      expect(spec.systemPromptFile).toBe(path.join('/code-root', director.prompt_path));
      expect(spec.roleTools).toEqual(READ_SET);
      const args = claudeArgs(spec, 'role prompt');
      expect(args).not.toContain('--fallback-model');
      expect(args[args.indexOf('--tools') + 1]!.split(',')).toEqual(READ_SET);
      const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
      for (const name of [...args[args.indexOf('--tools') + 1]!.split(','), ...allowed]) {
        expect(name).not.toMatch(/^(Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch)\b|^mcp__/);
      }
      expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}');
      // Attended, the prompt names the frames in the folder the session works in.
      expect(spec.prompt).toContain(`- site/home-375.png: before ${path.join(dir, 'site/home-375.before.png')}; after ${path.join(dir, 'site/home-375.after.png')}`);
      expect(spec.prompt).toContain(`- site/team-1440.png: before (none: the base did not draw it); after ${path.join(dir, 'site/team-1440.after.png')}`);
    }
  });

  it("writes founder rows with the Director's role and no card, and a replayed request id writes nothing", async () => {
    const { db, deps } = setup(JSON.stringify(verdict()));
    const c = card({ folder: 'platform' });
    await runVisualReview(input(c), deps);
    expect(db.ledger).toHaveLength(1);
    expect(db.ledger[0]).toMatchObject({ billed_to: 'founder', card_id: null, role_id: platformDirector.id });
    // The same review replayed (a retried write, or the same request ids again) records nothing new.
    await runVisualReview(input(c), deps);
    expect(db.ledger).toHaveLength(1);
    expect(db.ledger.filter((row) => row.card_id === c.id)).toEqual([]);
  });

  it.each([
    ['prose around the object', `Here it is: ${JSON.stringify(verdict())}`],
    ['a criterion missing', JSON.stringify({ criteria: { intent: verdict().criteria.intent } })],
    ['a pass with a failure code', JSON.stringify(verdict({ fit: { reason_code: 'off_tokens' } }))],
    ['a revise with meets', JSON.stringify(verdict({ fit: { verdict: 'revise' } }))],
    ['a reason code from another criterion', JSON.stringify(verdict({ all_ages: { verdict: 'revise', reason_code: 'dead_space' } }))],
    ['a free-text note', JSON.stringify({ ...verdict(), note: 'make it nicer' })],
    ['a frame path that climbs out', JSON.stringify(verdict({}, '../secret.png'))],
  ])('fails on %s and gives no verdict', async (_name, answer) => {
    const { deps } = setup(answer);
    const outcome = await runVisualReview(input(card({ folder: 'platform' })), deps);
    expect(outcome.kind).toBe('failed');
  });

  it('fails when the verdict rests on a frame the gate did not change', async () => {
    const { deps } = setup(JSON.stringify(verdict({}, 'site/contact-768.png')));
    expect(await runVisualReview(input(card({ folder: 'platform' })), deps)).toEqual({ kind: 'failed', reason: 'the verdict names frames it was not shown: site/contact-768.png, site/contact-768.png, site/contact-768.png, site/contact-768.png' });
  });

  it('fails when the Director is paused or missing, and starts no session', async () => {
    const paused = setup(JSON.stringify(verdict()));
    paused.db.roles = [role(), gameDirector, { ...platformDirector, paused: true }];
    expect(await runVisualReview(input(card({ folder: 'platform' })), paused.deps)).toEqual({ kind: 'failed', reason: 'the Platform Director is paused' });
    const missing = setup(JSON.stringify(verdict()));
    missing.db.roles = [role(), platformDirector];
    expect(await runVisualReview(input(card({ folder: 'seed-1' })), missing.deps)).toEqual({ kind: 'failed', reason: 'the Game Director is not an active role' });
    expect([...paused.adapter.specs, ...missing.adapter.specs]).toEqual([]);
  });

  it('starts at once with no board member signed in', async () => {
    const { db, adapter, deps } = setup(JSON.stringify(verdict()));
    db.boardActive = false;
    expect((await runVisualReview(input(card({ folder: 'platform' })), deps)).kind).toBe('verdict');
    expect(adapter.specs).toHaveLength(1);
  });

  it('stops without a session when the dispatcher has stopped', async () => {
    const { adapter, deps, stop } = setup(JSON.stringify(verdict()));
    stop.abort('dispatcher stopping');
    expect(await runVisualReview(input(card({ folder: 'platform' })), deps)).toEqual({ kind: 'stopped' });
    expect(adapter.specs).toEqual([]);
  });

  describe('on the managed adapter', () => {
    function managed(answer: string | ((spec: SessionSpec) => string), usageTokens = 400) {
      const db = new FakeDb();
      db.roles = [role(), gameDirector, platformDirector];
      let n = 0;
      const adapter = new FakeAdapter(
        async (_spec, emit) => {
          n += 1;
          await emit({ type: 'start', sessionId: `sesn_${n}`, model: 'director-class', tools: ['read', 'glob', 'grep'], apiKeySource: 'ANTHROPIC_API_KEY', ledger: 'adapter' });
          await emit(usageEvent(1, usageTokens, 'director-class'));
        },
        { mode: 'unattended', result: answer },
      );
      const deps: VisualReviewDeps = {
        db,
        session: { adapter, typed, priceTable: PRICE_TABLE, maxTurns: 20, maxMs: 60_000, watchIntervalMs: 5, log: silent, stopSignal: new AbortController().signal, ledgerRetryMs: 1 },
        rubric: async () => 'THE RUBRIC',
        promptRoot: CODE_ROOT,
      };
      return { db, adapter, deps };
    }

    it('mounts each changed frame at FRAMES_MOUNT, names those paths in the prompt, bills the card and writes no row itself', async () => {
      const { db, adapter, deps } = managed(JSON.stringify(verdict()));
      const c = card({ folder: 'platform' });
      const spends: number[] = [];
      const outcome = await runVisualReview({ ...input(c), onSpend: (usd) => spends.push(usd) }, deps);
      expect(outcome).toMatchObject({ kind: 'verdict', ref: 'claude:sesn_1', director: { id: platformDirector.id } });
      const spec = adapter.specs[0]!;
      expect(spec.purpose).toBe('role');
      expect(spec.roleTools).toEqual(READ_SET);
      expect(spec.maxBudgetUsd).toBe(5);
      expect(spec.role).toMatchObject({ cardId: c.id, repoSha: null });
      expect(spec.role!.files).toEqual([
        { path: path.join(dir, 'site/home-375.before.png'), mountPath: `${FRAMES_MOUNT}/site/home-375.before.png` },
        { path: path.join(dir, 'site/home-375.after.png'), mountPath: `${FRAMES_MOUNT}/site/home-375.after.png` },
        { path: path.join(dir, 'site/team-1440.after.png'), mountPath: `${FRAMES_MOUNT}/site/team-1440.after.png` },
      ]);
      expect(spec.prompt).toContain(`- site/home-375.png: before ${FRAMES_MOUNT}/site/home-375.before.png; after ${FRAMES_MOUNT}/site/home-375.after.png`);
      expect(spec.prompt).toContain(`- site/team-1440.png: before (none: the base did not draw it); after ${FRAMES_MOUNT}/site/team-1440.after.png`);
      expect(spec.prompt).not.toContain(dir);
      expect(spends.length).toBeGreaterThan(0);
      expect(db.ledger).toEqual([]);
    });

    it('reviews more than twelve changed frames in batches, each session shown only its own, the verdicts combined worst-of and the budget shared', async () => {
      const changed = Array.from({ length: 13 }, (_, i) => `site/frame-${i}.png`);
      const { adapter, deps } = managed((spec) =>
        spec.prompt.includes('site/frame-12.png')
          ? JSON.stringify(verdict({ legibility: { verdict: 'revise', frame: 'site/frame-12.png', reason_code: 'dead_space' } }, 'site/frame-12.png'))
          : JSON.stringify(verdict({}, 'site/frame-0.png')),
      );
      const outcome = await runVisualReview(input(card({ folder: 'platform' }), changed), deps);
      expect(adapter.specs).toHaveLength(2);
      expect(adapter.specs[0]!.role!.files.map((file) => file.mountPath)).toEqual(changed.slice(0, 12).map((frame) => `${FRAMES_MOUNT}/${frame.replace('.png', '.after.png')}`));
      expect(adapter.specs[1]!.role!.files.map((file) => file.mountPath)).toEqual([`${FRAMES_MOUNT}/site/frame-12.after.png`]);
      expect(adapter.specs[0]!.prompt).toContain('batch 1 of 2');
      expect(adapter.specs[0]!.prompt).not.toContain('site/frame-12.png');
      expect(adapter.specs[1]!.maxBudgetUsd).toBeLessThan(adapter.specs[0]!.maxBudgetUsd);
      expect(outcome).toMatchObject({ kind: 'verdict', ref: 'claude:sesn_1+claude:sesn_2', refs: ['claude:sesn_1', 'claude:sesn_2'] });
      if (outcome.kind === 'verdict') {
        expect(outcome.verdict.criteria.legibility).toEqual({ verdict: 'revise', frame: 'site/frame-12.png', reason_code: 'dead_space' });
        expect(outcome.verdict.criteria.intent).toEqual({ verdict: 'pass', frame: 'site/frame-0.png', reason_code: 'meets' });
      }
    });

    it('fails a batch whose verdict names a frame from another batch', async () => {
      const changed = Array.from({ length: 13 }, (_, i) => `site/frame-${i}.png`);
      const { deps } = managed(JSON.stringify(verdict({}, 'site/frame-0.png')));
      expect(await runVisualReview(input(card({ folder: 'platform' }), changed), deps)).toMatchObject({ kind: 'failed', reason: expect.stringContaining('names frames it was not shown: site/frame-0.png') });
    });

    it('names a credit refusal so the pipeline can pause the studio', async () => {
      const db = new FakeDb();
      db.roles = [role(), gameDirector, platformDirector];
      const adapter = new FakeAdapter(
        async () => {
          throw new SessionPaused('console_credit', 'the Managed Agents session could not be created: credit balance is too low');
        },
        { mode: 'unattended' },
      );
      const { deps } = managed('');
      const outcome = await runVisualReview(input(card({ folder: 'platform' })), { ...deps, db, session: { ...deps.session, adapter } });
      expect(outcome).toMatchObject({ kind: 'failed', refusal: 'credit' });
    });
  });
});
