// The Directors' visual review (src/visual-review.ts, docs/specs/design-review.md): the end rule's
// full table; the revision feedback holds only criteria, frame names and reason codes; the review
// waits for a signed-in board member; the Game Director reviews seed-1 and the Platform Director
// platform/site; the session holds Read, Glob and Grep only, in the frames folder, with the prompt
// read from the dispatcher's own checkout; a final message that is not one valid verdict naming
// changed frames fails the review; its model calls write founder rows with the Director's role and no
// card, and a replayed request id writes nothing.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claudeArgs } from '../src/adapters/claude-cli.js';
import type { Card, Role } from '../src/db.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { TypedOutput } from '../src/typed-output.js';
import {
  decideReview,
  MAX_REVIEW_ROUNDS,
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
import { FakeAdapter, usageEvent, type FakeOptions } from './helpers/fake-adapter.js';
import { FakeDb, NOW, card, role } from './helpers/fake-db.js';

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
    const prompt = reviewPrompt({ card: card({ intent: 'Show the team.', acceptance_test: 'gate and smoke' }), sha: SHA, gateUrl: null, review: 1, changed: CHANGED, rubric: 'THE RUBRIC' }, typed);
    for (const line of ['Show the team.', 'gate and smoke', SHA, '- site/home-375.png', '- site/team-1440.png', 'THE RUBRIC', 'platform/agents/schemas/visual-verdict.schema.json']) {
      expect(prompt).toContain(line);
    }
  });
});

describe('runVisualReview', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-review-'));
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
      session: { adapter, typed, priceTable: PRICE_TABLE, maxTurns: 20, maxMs: 60_000, boardSessionTtlMin: 3, watchIntervalMs: 5, log: silent, stopSignal: stop.signal, now: () => NOW, ledgerRetryMs: 1 },
      rubric: async () => 'THE RUBRIC',
      promptRoot: '/code-root',
      budgetUsd: 5,
      waitIntervalMs: 5,
    };
    return { db, adapter, deps, stop };
  }

  const input = (c: Card) => ({ card: c, frames: { dir, changed: CHANGED }, sha: SHA, gateUrl: null, review: 1 });

  it('runs the Platform Director for a platform/site card and the Game Director for a seed-1 card, each with Read, Glob and Grep only, in the frames folder', async () => {
    for (const [folder, director] of [['platform', platformDirector], ['seed-1', gameDirector]] as const) {
      const { adapter, deps } = setup(JSON.stringify(verdict()));
      const outcome = await runVisualReview(input(card({ folder })), deps);
      expect(outcome).toMatchObject({ kind: 'verdict', ref: 'claude:review-session', director: { id: director.id } });
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
    expect(await runVisualReview(input(card({ folder: 'platform' })), deps)).toEqual({ kind: 'failed', reason: 'the verdict names frames the gate did not change: site/contact-768.png, site/contact-768.png, site/contact-768.png, site/contact-768.png' });
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

  it('waits at gated until a board member signs in, and starts nothing while none is', async () => {
    const { db, adapter, deps } = setup(JSON.stringify(verdict()));
    db.boardActive = false;
    const pending = runVisualReview(input(card({ folder: 'platform' })), deps);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(adapter.specs).toEqual([]);
    db.boardActive = true;
    expect((await pending).kind).toBe('verdict');
    expect(adapter.specs).toHaveLength(1);
  });

  it('stops without a session when the dispatcher stops while it waits', async () => {
    const { db, adapter, deps, stop } = setup(JSON.stringify(verdict()));
    db.boardActive = false;
    const pending = runVisualReview(input(card({ folder: 'platform' })), deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop.abort('dispatcher stopping');
    expect(await pending).toEqual({ kind: 'stopped' });
    expect(adapter.specs).toEqual([]);
  });
});
