import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DispatcherConfig } from '../src/config.js';
import type { Card } from '../src/db.js';
import { createLogger } from '../src/log.js';
import { findCardMerge, resumeMerged, type PipelineDeps } from '../src/pipeline.js';
import { parsePriceTable } from '../src/pricing.js';
import { recoverOrphans, type RecoveryDeps } from '../src/recovery.js';
import { AGENT_EMAIL, git } from '../src/worktree.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card } from './helpers/fake-db.js';
import { mockFetch, type Route } from './helpers/mock-fetch.js';

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
    codeRoot: repo,
    codeReadonly: false,
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
    visualReviewMaxUsd: 1,
    sessionMaxTurns: 60,
    sessionMaxMinutes: 60,
    agentHourlyRateUsd: 5,
    tickMs: 60_000,
    worktreeRoot: path.join(dir, '.worktrees'),
    maxConcurrency: 1,
    claudeBin: 'claude',
    boardSessionTtlMin: 3,
    studioAnthropicApiKey: null,
    healthcheckUrl: null,
    ntfyTopicUrl: null,
    discordWebhookShips: null,
    discordWebhookWeekly: null,
    publicSiteUrl: 'https://site.test',
  };
});

afterAll(async () => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(dir, { recursive: true, force: true });
});

// Netlify and GitHub for a merged platform card whose served build fails smoke, with main still at
// the merge; `over` answers first.
function remote(over: Route = () => undefined) {
  return mockFetch((method, url, body) => {
    const first = over(method, url, body);
    if (first) return first;
    if (method === 'GET' && url === `${GITHUB}/git/ref/heads/main`) return { status: 200, json: { object: { sha: MERGE_SHA } } };
    if (method === 'GET' && url === `${NETLIFY}/site-platform/deploys?page=1&per_page=50`) return { status: 200, json: [{ id: 'dep-2', state: 'ready', commit_ref: MERGE_SHA, context: 'production' }] };
    if (method === 'GET' && url === `${NETLIFY}/site-platform`) return { status: 200, json: { ssl_url: SITE_URL } };
    if (method === 'GET' && url === `${SITE_URL}/`) return { status: 500, text: '' };
    if (method === 'POST' && url === `${NETLIFY}/site-platform/deploys/dep-1/restore`) return { status: 200, json: { id: 'dep-1' } };
    if (method === 'GET' && url === `${GITHUB}/git/commits/${MERGE_SHA}`) return { status: 200, json: { sha: MERGE_SHA, parents: [{ sha: 'parent-sha' }] } };
    if (method === 'GET' && url === `${GITHUB}/git/commits/parent-sha`) return { status: 200, json: { sha: 'parent-sha', tree: { sha: 'parent-tree' } } };
    if (method === 'POST' && url === `${GITHUB}/git/commits`) return { status: 201, json: { sha: 'revert-sha' } };
    if (method === 'PATCH' && url === `${GITHUB}/git/refs/heads/main`) return { status: 200, json: { object: { sha: 'revert-sha' } } };
    return undefined;
  });
}

describe('recoverOrphans', () => {
  let db: FakeDb;
  let alert: RecordingAlerter;
  let running: Map<string, Date>;
  let resumed: string[];

  const building = card({ id: 'aaaaaaaa-0000-4000-8000-000000000001', stage: 'building', branch: 'card/aaaaaaaa-config' });
  const gatedUnmerged = card({ id: 'bbbbbbbb-0000-4000-8000-000000000002', stage: 'gated', branch: 'card/bbbbbbbb-config' });
  const gatedMerged = card({ id: 'cccccccc-0000-4000-8000-000000000003', stage: 'gated', branch: 'card/cccccccc-code', folder: 'platform', lane: 'code', acceptance_test: null, commit_sha: MERGE_SHA });

  function pipelineDeps(fetchFn: typeof fetch): PipelineDeps {
    return {
      db,
      adapter: new FakeAdapter(async () => undefined),
      config,
      log: silent,
      alert,
      stopSignal: new AbortController().signal,
      now: () => NOW,
      fetchFn,
      timings: { retryDelayMs: 1, deployIntervalMs: 5 },
    };
  }

  function recoveryDeps(resume: (c: Card) => Promise<void>, lookupMerge: (c: Card) => Promise<string | null> = async () => null): RecoveryDeps {
    return { db, config, log: silent, alert, running, now: () => NOW, resume, lookupMerge };
  }

  beforeEach(() => {
    db = new FakeDb();
    alert = new RecordingAlerter();
    running = new Map();
    resumed = [];
  });

  it('pauses a building card and a gated card whose pull request did not merge, and alerts for each', async () => {
    db.cards = [{ ...building }, { ...gatedUnmerged }];
    db.ledger = [{ id: 'ledger-1', billed_to: 'founder', card_id: building.id, role_id: 'role-builder-a', model: 'builder-class', input_tokens: 1, cached_tokens: 0, output_tokens: 1, usd: 0.5, request_id: 'card/aaaaaaaa/turn/1' }];
    const looked: string[] = [];
    const background = await recoverOrphans(
      recoveryDeps(
        async (c) => {
          resumed.push(c.id);
        },
        async (c) => {
          looked.push(c.id);
          return null;
        },
      ),
    );
    expect(background).toEqual([]);
    expect(resumed).toEqual([]);
    // Recovery reads building and gated cards from dispatcher_cards, which holds every stage.
    expect(db.stagesRead).toEqual([['building', 'gated']]);
    expect(looked).toEqual([gatedUnmerged.id]);
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

  it('writes the merge sha and verifies a gated card whose pull request merged before the sha was written', async () => {
    db.cards = [{ ...gatedUnmerged }];
    const seen: Array<string | null> = [];
    const background = await recoverOrphans(
      recoveryDeps(
        async (c) => {
          seen.push(c.commit_sha);
        },
        async () => 'found-merge-sha',
      ),
    );
    await Promise.all(background);
    expect(db.cards[0]).toMatchObject({ stage: 'gated', commit_sha: 'found-merge-sha' });
    expect(seen).toEqual(['found-merge-sha']);
  });

  it('rejects a merge_unknown card whose pull request did not merge, and closes nothing', async () => {
    db.cards = [{ ...gatedUnmerged, failing_check: 'merge_unknown' }];
    await recoverOrphans(recoveryDeps(async () => undefined, async () => null));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'merge' });
    expect(alert.messages).toEqual([
      'Card bbbbbbbb had a lost merge request and its pull request is not merged; it is rejected. Branch card/bbbbbbbb-config and its pull request are left open for the board to close or merge.',
    ]);
  });

  it('leaves a card the board moved while recovery read it as the board set it', async () => {
    // The list is read before the board's change lands.
    class StaleList extends FakeDb {
      override async listCardsInStages() {
        return [{ ...building }, { ...gatedUnmerged, failing_check: 'merge_unknown' }];
      }
    }
    db = new StaleList();
    db.cards = [
      { ...building, stage: 'rejected' },
      { ...gatedUnmerged, stage: 'paused', failing_check: 'merge_unknown' },
    ];
    await recoverOrphans(recoveryDeps(async () => undefined, async () => null));
    expect(db.cards.map((c) => [c.stage, c.failing_check])).toEqual([
      ['rejected', null],
      ['paused', 'merge_unknown'],
    ]);
    expect(db.events).toEqual([]);
    expect(alert.messages).toEqual([
      'Card aaaaaaaa changed stage while the dispatcher was recovering it, so it was not moved to paused.',
      'Card bbbbbbbb changed stage while the dispatcher was recovering it, so it was not moved to rejected.',
    ]);
  });

  it('leaves a gated card as it is, and alerts, when its pull request cannot be read', async () => {
    db.cards = [{ ...gatedUnmerged }];
    await recoverOrphans(
      recoveryDeps(
        async () => undefined,
        async () => {
          throw new Error('github pull requests: http 502');
        },
      ),
    );
    expect(db.cards[0]).toMatchObject({ stage: 'gated', failing_check: null, commit_sha: null });
    expect(alert.messages).toEqual([
      'Card bbbbbbbb was gated when the dispatcher restarted, and whether its pull request merged could not be read (github pull requests: http 502). It is left gated for the board.',
    ]);
  });

  it('rolls back a merged orphan whose smoke test fails', async () => {
    db.cards = [{ ...gatedMerged }];
    db.deploys = [{ id: 'row-1', folder: 'platform', sha: 'older-sha', netlify_deploy_id: 'dep-1', is_green: true, smoke_result: 'pass', created_at: NOW.toISOString() }];
    const { fetchFn, calls } = remote();
    const background = await recoverOrphans(recoveryDeps((c) => resumeMerged(c, pipelineDeps(fetchFn))));
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

  it('runs no smoke test or rollback, and leaves the card gated, when main has moved past the merge', async () => {
    db.cards = [{ ...gatedMerged }];
    const { fetchFn, calls } = remote((method, url) => (method === 'GET' && url === `${GITHUB}/git/ref/heads/main` ? { status: 200, json: { object: { sha: 'newer-sha-abcdef' } } } : undefined));
    await resumeMerged({ ...gatedMerged }, pipelineDeps(fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'gated', commit_sha: MERGE_SHA });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`GET ${GITHUB}/git/ref/heads/main`]);
    expect(alert.messages).toEqual([
      'Card cccccccc was merged as merge-sh but main has moved to newer-sh since. It is left gated for the board; no smoke test or rollback ran.',
    ]);
  });

  it('only records the ship of a card whose smoke test had already passed', async () => {
    db.cards = [{ ...gatedMerged }];
    db.events = [{ card_id: gatedMerged.id, role_id: 'role-builder-a', type: 'message', payload: { step: 'smoke_pass', sha: MERGE_SHA, deploy_id: 'dep-2', url: SITE_URL, smoke: 'pass: build merge-sh served' } }];
    const { fetchFn, calls } = remote();
    await resumeMerged({ ...gatedMerged }, pipelineDeps(fetchFn));
    expect(calls).toEqual([]);
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA });
    expect(db.deploys).toEqual([expect.objectContaining({ sha: MERGE_SHA, netlify_deploy_id: 'dep-2', is_green: true, smoke_result: 'pass: build merge-sh served' })]);
    expect(db.events.at(-1)).toMatchObject({ type: 'ship', payload: { sha: MERGE_SHA, deploy_id: 'dep-2' } });
  });

  it("finds a card's merge from the newest pull request for its branch", async () => {
    const pulls = `${GITHUB}/pulls?state=all&head=owner%3Acard%2Fbbbbbbbb-config&sort=created&direction=desc&per_page=1`;
    const merged = remote((method, url) => (url === pulls ? { status: 200, json: [{ number: 8, merged_at: '2026-09-16T12:00:00Z', merge_commit_sha: 'found-merge-sha', state: 'closed' }] } : undefined));
    expect(await findCardMerge(gatedUnmerged, pipelineDeps(merged.fetchFn))).toBe('found-merge-sha');
    const open = remote((method, url) => (url === pulls ? { status: 200, json: [{ number: 8, merged_at: null, merge_commit_sha: null, state: 'open' }] } : undefined));
    expect(await findCardMerge(gatedUnmerged, pipelineDeps(open.fetchFn))).toBeNull();
    expect(await findCardMerge({ ...gatedUnmerged, branch: null }, pipelineDeps(open.fetchFn))).toBeNull();
  });
});
