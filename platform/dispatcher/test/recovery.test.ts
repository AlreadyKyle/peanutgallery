import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DispatcherConfig } from '../src/config.js';
import type { Card } from '../src/db.js';
import { createLogger } from '../src/log.js';
import { resumeMerged } from '../src/pipeline.js';
import { parsePriceTable } from '../src/pricing.js';
import { recoverOrphans, type RecoveryDeps } from '../src/recovery.js';
import { AGENT_EMAIL, git } from '../src/worktree.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card } from './helpers/fake-db.js';
import { mockFetch } from './helpers/mock-fetch.js';

const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
const MERGE_SHA = 'merge-sha-0123456789';
const GITHUB = 'https://api.github.com/repos/owner/repo';
const NETLIFY = 'https://api.netlify.com/api/v1/sites';
const SITE_URL = 'https://platform.local';

let dir: string;
let config: DispatcherConfig;
const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-recovery-'));
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
  const repo = path.join(dir, 'repo');
  await git(['init', '-q', '--initial-branch=main', repo], dir);
  await mkdir(path.join(repo, 'platform', 'site'), { recursive: true });
  await writeFile(path.join(repo, 'platform', 'site', 'index.html'), '<title>Backseat</title>\n', 'utf8');
  await git(['add', '-A'], repo);
  await git(['-c', 'user.name=Dispatcher test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'initial'], repo);
  config = {
    repoRoot: repo,
    agentMode: 'attended',
    supabaseUrl: 'https://db.local',
    supabaseServiceRoleKey: 'service-role',
    githubToken: 'github-token',
    githubRepo: 'owner/repo',
    netlifyAuthToken: 'netlify-token',
    netlifySiteIdSeed: 'site-seed',
    netlifySiteIdPlatform: 'site-platform',
    modelBuilder: 'builder-class',
    modelDirector: null,
    modelHost: null,
    priceTable: parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } })),
    poolDailyCapUsd: 100,
    cardMaxUsd: 25,
    sessionMaxTurns: 60,
    sessionMaxMinutes: 60,
    agentHourlyRateUsd: 5,
    tickMs: 60_000,
    worktreeRoot: path.join(dir, '.worktrees'),
    maxConcurrency: 1,
    schedulerEnabled: false,
    claudeBin: 'claude',
    boardSessionTtlMin: 3,
    studioAnthropicApiKey: null,
    healthcheckUrl: null,
    ntfyTopicUrl: null,
  };
});

afterAll(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(dir, { recursive: true, force: true });
});

describe('recoverOrphans', () => {
  let db: FakeDb;
  let alert: RecordingAlerter;
  let running: Map<string, Date>;
  let resumed: string[];

  const building = card({ id: 'aaaaaaaa-0000-4000-8000-000000000001', stage: 'building', branch: 'card/aaaaaaaa-config' });
  const gatedUnmerged = card({ id: 'bbbbbbbb-0000-4000-8000-000000000002', stage: 'gated', branch: 'card/bbbbbbbb-config' });
  const gatedMerged = card({ id: 'cccccccc-0000-4000-8000-000000000003', stage: 'gated', branch: 'card/cccccccc-code', folder: 'platform', lane: 'code', acceptance_test: null, commit_sha: MERGE_SHA });

  function recoveryDeps(resume: (c: Card) => Promise<void>): RecoveryDeps {
    return { db, config, log: silent, alert, running, now: () => NOW, resume };
  }

  beforeEach(() => {
    db = new FakeDb();
    alert = new RecordingAlerter();
    running = new Map();
    resumed = [];
  });

  it('pauses a building card and a gated card that never merged, and alerts for each', async () => {
    db.cards = [{ ...building }, { ...gatedUnmerged }];
    db.ledger = [{ id: 'ledger-1', billed_to: 'founder', card_id: building.id, role_id: 'role-builder-a', model: 'builder-class', input_tokens: 1, cached_tokens: 0, output_tokens: 1, usd: 0.5 }];
    const background = await recoverOrphans(
      recoveryDeps(async (c) => {
        resumed.push(c.id);
      }),
    );
    expect(background).toEqual([]);
    expect(resumed).toEqual([]);
    expect(db.cards.map((c) => [c.stage, c.failing_check, c.actual_usd])).toEqual([
      ['paused', 'dispatcher_restart', 0.5],
      ['paused', 'dispatcher_restart', 0],
    ]);
    expect(db.events.map((e) => [e.card_id, e.type, e.payload.previous_stage])).toEqual([
      [building.id, 'error', 'building'],
      [gatedUnmerged.id, 'error', 'gated'],
    ]);
    expect(alert.messages).toEqual([
      'Card aaaaaaaa was building when the dispatcher restarted and is paused. Branch card/aaaaaaaa-config and any pull request are left open.',
      'Card bbbbbbbb was gated when the dispatcher restarted and is paused. Branch card/bbbbbbbb-config and any pull request are left open.',
    ]);
  });

  it('alerts and verifies a merged gated card in the background, counted as running until it finishes', async () => {
    db.cards = [{ ...gatedMerged }];
    let finish: () => void = () => undefined;
    const background = await recoverOrphans(
      recoveryDeps(
        (c) =>
          new Promise<void>((resolve) => {
            resumed.push(c.id);
            finish = resolve;
          }),
      ),
    );
    expect(resumed).toEqual([gatedMerged.id]);
    expect([...running.keys()]).toEqual([gatedMerged.id]);
    expect(db.cards[0]).toMatchObject({ stage: 'gated', commit_sha: MERGE_SHA });
    expect(alert.messages).toEqual(['Card cccccccc was merged as merge-sh but not verified when the dispatcher restarted. Its deploy and smoke test run again now.']);
    finish();
    await Promise.all(background);
    expect(running.size).toBe(0);
  });

  it('rolls back a merged orphan whose smoke test fails', async () => {
    db.cards = [{ ...gatedMerged }];
    db.deploys = [{ id: 'row-1', folder: 'platform', sha: 'older-sha', netlify_deploy_id: 'dep-1', is_green: true, smoke_result: 'pass', created_at: NOW.toISOString() }];
    const { fetchFn, calls } = mockFetch((method, url) => {
      if (method === 'GET' && url === `${NETLIFY}/site-platform/deploys?per_page=20`) return { status: 200, json: [{ id: 'dep-2', state: 'ready', commit_ref: MERGE_SHA, context: 'production' }] };
      if (method === 'GET' && url === `${NETLIFY}/site-platform`) return { status: 200, json: { ssl_url: SITE_URL } };
      if (method === 'GET' && url === `${SITE_URL}/`) return { status: 500, text: '' };
      if (method === 'POST' && url === `${NETLIFY}/site-platform/deploys/dep-1/restore`) return { status: 200, json: { id: 'dep-1' } };
      if (method === 'GET' && url === `${GITHUB}/git/commits/${MERGE_SHA}`) return { status: 200, json: { sha: MERGE_SHA, parents: [{ sha: 'parent-sha' }] } };
      if (method === 'GET' && url === `${GITHUB}/git/commits/parent-sha`) return { status: 200, json: { sha: 'parent-sha', tree: { sha: 'parent-tree' } } };
      if (method === 'POST' && url === `${GITHUB}/git/commits`) return { status: 201, json: { sha: 'revert-sha' } };
      if (method === 'PATCH' && url === `${GITHUB}/git/refs/heads/main`) return { status: 200, json: { object: { sha: 'revert-sha' } } };
      return undefined;
    });
    const pipeline = {
      db,
      adapter: new FakeAdapter(async () => undefined),
      config,
      log: silent,
      alert,
      stopSignal: new AbortController().signal,
      now: () => NOW,
      halt: { reason: null },
      fetchFn,
    };
    const background = await recoverOrphans(recoveryDeps((c) => resumeMerged(c, pipeline)));
    await Promise.all(background);

    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'smoke', commit_sha: MERGE_SHA });
    expect(db.events.at(-1)).toMatchObject({ type: 'revert', payload: { failed_sha: MERGE_SHA, restored_sha: 'older-sha', revert_sha: 'revert-sha' } });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain(`POST ${NETLIFY}/site-platform/deploys/dep-1/restore`);
    expect(alert.messages).toEqual([
      'Card cccccccc was merged as merge-sh but not verified when the dispatcher restarted. Its deploy and smoke test run again now.',
      'Card cccccccc was reverted on main (revert-): smoke failed: fail: GET / returned 500',
      'Card cccccccc rejected (smoke): spawn table row gatherer: baseCost changes from 10 to 11. fail: GET / returned 500',
    ]);
    expect(running.size).toBe(0);
  });
});
