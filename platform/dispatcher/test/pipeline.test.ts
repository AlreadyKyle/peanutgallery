import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DispatcherConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { runCardPipeline, type PipelineDeps } from '../src/pipeline.js';
import { parsePriceTable } from '../src/pricing.js';
import { AGENT_EMAIL, git } from '../src/worktree.js';
import { FakeAdapter, startEvent, untilAborted, usageEvent, type FakeScript } from './helpers/fake-adapter.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card } from './helpers/fake-db.js';
import { mockFetch, type FetchCall, type Reply } from './helpers/mock-fetch.js';

const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const MERGE_SHA = 'merge-sha-0123456789';
const GITHUB = 'https://api.github.com/repos/owner/repo';
const NETLIFY = 'https://api.netlify.com/api/v1/sites';
const SITE_URL = 'https://platform.local';

let dir: string;
let repo: string;
let config: DispatcherConfig;
const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

const SPAWN_TABLE = { rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 0.2 }] };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-pipeline-'));
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
  const origin = path.join(dir, 'origin.git');
  repo = path.join(dir, 'repo');
  await git(['init', '-q', '--bare', '--initial-branch=main', origin], dir);
  await git(['init', '-q', '--initial-branch=main', repo], dir);
  await mkdir(path.join(repo, 'seed-1', 'config'), { recursive: true });
  await mkdir(path.join(repo, 'seed-1', 'content'), { recursive: true });
  await mkdir(path.join(repo, 'platform', 'site'), { recursive: true });
  await writeFile(path.join(repo, 'seed-1', 'config', 'spawn-table.json'), `${JSON.stringify(SPAWN_TABLE, null, 2)}\n`, 'utf8');
  await writeFile(path.join(repo, 'seed-1', 'content', 'strings.json'), '{"title":"Dust"}\n', 'utf8');
  await writeFile(path.join(repo, 'platform', 'site', 'index.html'), '<title>Backseat</title>\n', 'utf8');
  await git(['add', '-A'], repo);
  await git(['-c', 'user.name=Dispatcher test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'initial'], repo);
  await git(['remote', 'add', 'origin', origin], repo);
  await git(['push', '-q', 'origin', 'main'], repo);
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
    priceTable: PRICE_TABLE,
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

// GitHub and Netlify answers for a card that sails through; tests override what they need.
interface Remote {
  gate?: Reply;
  merge?: Reply;
  deploys?: Reply;
  page?: Reply;
  version?: Reply;
  restore?: Reply;
  ref?: Reply;
}

function remote(over: Remote = {}) {
  const readyDeploy = { id: 'dep-2', state: 'ready', commit_ref: MERGE_SHA, context: 'production' };
  return mockFetch((method, url) => {
    if (method === 'POST' && url === `${GITHUB}/pulls`) return { status: 201, json: { number: 5, head: { sha: 'head-sha' } } };
    if (method === 'GET' && url.startsWith(`${GITHUB}/commits/head-sha/check-runs`)) {
      return over.gate ?? { status: 200, json: { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'success' }] } };
    }
    if (method === 'PUT' && url === `${GITHUB}/pulls/5/merge`) return over.merge ?? { status: 200, json: { sha: MERGE_SHA } };
    if (method === 'GET' && url === `${NETLIFY}/site-platform/deploys?per_page=20`) return over.deploys ?? { status: 200, json: [readyDeploy] };
    if (method === 'GET' && url === `${NETLIFY}/site-platform`) return { status: 200, json: { ssl_url: `${SITE_URL}/` } };
    if (method === 'POST' && url === `${NETLIFY}/site-platform/deploys/dep-1/restore`) return over.restore ?? { status: 200, json: { id: 'dep-1' } };
    if (method === 'GET' && url === `${SITE_URL}/`) return over.page ?? { status: 200, text: `<meta name="build-sha" content="${MERGE_SHA}">` };
    if (method === 'GET' && url === `${SITE_URL}/version.json`) return over.version ?? { status: 200, json: { sha: MERGE_SHA } };
    if (method === 'GET' && url === `${GITHUB}/git/commits/${MERGE_SHA}`) return { status: 200, json: { sha: MERGE_SHA, parents: [{ sha: 'parent-sha' }] } };
    if (method === 'GET' && url === `${GITHUB}/git/commits/parent-sha`) return { status: 200, json: { sha: 'parent-sha', tree: { sha: 'parent-tree' } } };
    if (method === 'POST' && url === `${GITHUB}/git/commits`) return { status: 201, json: { sha: 'revert-sha' } };
    if (method === 'PATCH' && url === `${GITHUB}/git/refs/heads/main`) return over.ref ?? { status: 200, json: { object: { sha: 'revert-sha' } } };
    return undefined;
  });
}

function deps(db: FakeDb, adapter: FakeAdapter, fetchFn: typeof fetch, stop = new AbortController(), alert = new RecordingAlerter()): PipelineDeps {
  return { db, adapter, config, log: silent, alert, stopSignal: stop.signal, now: () => NOW, fetchFn };
}

const platformCard = () => card({ folder: 'platform', lane: 'code', acceptance_test: null, intent: 'Name the page.' });

const editSite: FakeScript = async (spec, emit) => {
  await emit(startEvent());
  await writeFile(path.join(spec.worktree, 'platform', 'site', 'index.html'), '<title>Peanut Gallery</title>\n', 'utf8');
  await emit(usageEvent(1, 100));
};

const editSpawnTable = async (worktree: string, baseCost: number) => {
  const changed = { rows: SPAWN_TABLE.rows.map((row) => ({ ...row, baseCost })) };
  await writeFile(path.join(worktree, 'seed-1', 'config', 'spawn-table.json'), `${JSON.stringify(changed, null, 2)}\n`, 'utf8');
};

function urls(calls: FetchCall[]): string[] {
  return calls.map((c) => `${c.method} ${c.url}`);
}

describe('runCardPipeline', () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it('takes a card from building to live with a green deploys row and a ship event', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const adapter = new FakeAdapter(editSite);
    await runCardPipeline(c, deps(db, adapter, fetchFn));

    const final = db.cards[0]!;
    expect(final).toMatchObject({ stage: 'live', failing_check: null, branch: 'card/4c2f5a1e-code', commit_sha: MERGE_SHA, actual_usd: 0.0045 });
    expect(db.ledger).toHaveLength(1);
    expect(db.deploys).toEqual([expect.objectContaining({ folder: 'platform', sha: MERGE_SHA, netlify_deploy_id: 'dep-2', is_green: true, smoke_result: 'pass: build merge-sh served' })]);
    expect(db.events.map((e) => e.type)).toEqual(['start', 'gate_pass', 'ship']);
    expect(db.events.at(-1)?.payload).toMatchObject({ sha: MERGE_SHA, deploy_id: 'dep-2', url: SITE_URL });
    expect(urls(calls)).toEqual([
      `POST ${GITHUB}/pulls`,
      `GET ${GITHUB}/commits/head-sha/check-runs?check_name=gate&per_page=50`,
      `PUT ${GITHUB}/pulls/5/merge`,
      `GET ${NETLIFY}/site-platform/deploys?per_page=20`,
      `GET ${NETLIFY}/site-platform`,
      `GET ${SITE_URL}/`,
      `GET ${SITE_URL}/version.json`,
    ]);
    expect(calls[2]?.body).toMatchObject({ sha: 'head-sha', merge_method: 'squash', commit_title: 'card 4c2f5a1e: spawn table row gatherer: baseCost changes from 10 to 11' });
    expect(calls[0]?.body).toMatchObject({ head: 'card/4c2f5a1e-code', base: 'main' });
    expect(String(calls[0]?.body && (calls[0].body as { body: string }).body)).toContain(`Card-Id: ${c.id}`);

    const pushed = await git(['show', '--format=%an <%ae>%n%B', '--name-only', 'refs/remotes/origin/card/4c2f5a1e-code'], repo).catch(() => git(['show', '--format=%an <%ae>%n%B', '--name-only', 'card/4c2f5a1e-code'], path.join(dir, 'origin.git')));
    expect(pushed).toContain(`Builder A (AI agent) <${AGENT_EMAIL}>`);
    expect(pushed).toContain('platform/site/index.html');
    expect(existsSync(path.join(config.worktreeRoot, 'card-4c2f5a1e'))).toBe(false);
    expect(adapter.specs[0]?.prompt).toContain('Allowed paths: platform/site.');
  });

  it('restores the previous green deploy, reverts main and rejects the card when smoke fails', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [{ id: 'row-1', folder: 'platform', sha: 'older-sha', netlify_deploy_id: 'dep-1', is_green: true, smoke_result: 'pass: build older-sh served', created_at: NOW.toISOString() }];
    const { fetchFn, calls } = remote({ page: { status: 500, text: '' } });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert));

    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'smoke', commit_sha: MERGE_SHA });
    expect(db.deploys.at(-1)).toMatchObject({ sha: MERGE_SHA, is_green: false, smoke_result: 'fail: GET / returned 500' });
    expect(db.events.map((e) => e.type)).toEqual(['start', 'gate_pass', 'revert']);
    expect(db.events.at(-1)?.payload).toEqual({
      failed_sha: MERGE_SHA,
      reason: 'smoke failed: fail: GET / returned 500',
      restored_sha: 'older-sha',
      restored_deploy_id: 'dep-1',
      revert_sha: 'revert-sha',
    });
    const restore = urls(calls).indexOf(`POST ${NETLIFY}/site-platform/deploys/dep-1/restore`);
    const commit = urls(calls).indexOf(`POST ${GITHUB}/git/commits`);
    expect(restore).toBeGreaterThan(0);
    expect(commit).toBeGreaterThan(restore);
    expect(calls[commit]?.body).toEqual({
      message: `Revert card 4c2f5a1e: spawn table row gatherer: baseCost changes from 10 to 11\n\nCard-Id: ${c.id}\nReason: smoke failed: fail: GET / returned 500\n`,
      tree: 'parent-tree',
      parents: [MERGE_SHA],
    });
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ sha: 'revert-sha', force: false });
    expect(alert.messages).toEqual([
      'Card 4c2f5a1e was reverted on main (revert-): smoke failed: fail: GET / returned 500',
      'Card 4c2f5a1e rejected (smoke): spawn table row gatherer: baseCost changes from 10 to 11. fail: GET / returned 500',
    ]);
  });

  it('alerts that the rollback is incomplete when main has moved past the merge', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn } = remote({ page: { status: 500, text: '' }, ref: { status: 422, json: { message: 'Update is not a fast forward' } } });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert));

    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'smoke' });
    expect(db.events.at(-1)?.payload).toMatchObject({
      restored_sha: null,
      restore_error: 'no green platform deploy exists to restore',
      revert_error: 'main was not moved to the revert commit revert-sha: http 422 Update is not a fast forward',
    });
    expect(alert.messages[0]).toBe(
      'Card 4c2f5a1e failed after merge and the rollback is incomplete: no green platform deploy exists to restore; main was not moved to the revert commit revert-sha: http 422 Update is not a fast forward. Check main and the live site.',
    );
  });

  it('rejects on a failed gate without merging', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote({ gate: { status: 200, json: { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'failure' }] } } });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'gate', commit_sha: null });
    expect(db.events.map((e) => e.type)).toEqual(['start', 'gate_fail']);
    expect(urls(calls)).not.toContain(`PUT ${GITHUB}/pulls/5/merge`);
    expect(urls(calls).some((call) => call.includes('/git/'))).toBe(false);
    expect(db.deploys).toEqual([]);
  });

  it('rejects when the merge guard refuses the head sha', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn } = remote({ merge: { status: 409, json: { message: 'Head branch was modified.' } } });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'merge', commit_sha: null });
  });

  it('pauses without a deploys row when the dispatcher stops during the gate wait', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const stop = new AbortController();
    const { fetchFn, calls } = mockFetch((method, url) => {
      if (method === 'POST' && url === `${GITHUB}/pulls`) return { status: 201, json: { number: 5, head: { sha: 'head-sha' } } };
      if (url.startsWith(`${GITHUB}/commits/head-sha/check-runs`)) {
        stop.abort('dispatcher stopping');
        return { status: 200, json: { check_runs: [{ name: 'gate', status: 'in_progress', conclusion: null }] } };
      }
      return undefined;
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, stop, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'dispatcher_stopped' });
    expect(alert.messages).toEqual([]);
    expect(db.deploys).toEqual([]);
    expect(db.events.map((e) => e.type)).toEqual(['start']);
    expect(urls(calls)).toHaveLength(2);
  });

  it('pauses without a deploys row when the dispatcher stops during the deploy wait', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const stop = new AbortController();
    const building = { id: 'dep-2', state: 'building', commit_ref: MERGE_SHA, context: 'production' };
    const { fetchFn } = mockFetch((method, url) => {
      if (method === 'POST' && url === `${GITHUB}/pulls`) return { status: 201, json: { number: 5, head: { sha: 'head-sha' } } };
      if (url.startsWith(`${GITHUB}/commits/head-sha/check-runs`)) return { status: 200, json: { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'success' }] } };
      if (method === 'PUT' && url === `${GITHUB}/pulls/5/merge`) return { status: 200, json: { sha: MERGE_SHA } };
      if (url === `${NETLIFY}/site-platform/deploys?per_page=20`) {
        stop.abort('dispatcher stopping');
        return { status: 200, json: [building] };
      }
      return undefined;
    });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, stop));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'dispatcher_stopped', commit_sha: MERGE_SHA });
    expect(db.deploys).toEqual([]);
  });

  it('writes a red deploys row when the deploy itself fails', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const failed = { id: 'dep-2', state: 'error', commit_ref: MERGE_SHA, context: 'production', error_message: 'Build script returned non-zero exit code: 2' };
    const { fetchFn, calls } = remote({ deploys: { status: 200, json: [failed] } });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'deploy' });
    expect(db.deploys).toEqual([expect.objectContaining({ sha: MERGE_SHA, netlify_deploy_id: 'dep-2', is_green: false, smoke_result: 'fail: deploy dep-2 ended in state error: Build script returned non-zero exit code: 2' })]);
    expect(db.events.at(-1)).toMatchObject({ type: 'revert', payload: { failed_sha: MERGE_SHA, revert_sha: 'revert-sha' } });
    expect(db.events.at(-1)?.payload).not.toHaveProperty('restored_sha');
    expect(urls(calls).some((call) => call.includes('/restore'))).toBe(false);
    expect(alert.messages).toHaveLength(2);
  });

  it('pauses on the ceiling and records what was spent', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const adapter = new FakeAdapter(async (spec, emit, signal) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      await emit(usageEvent(1, 100_000));
      await emit(usageEvent(2, 100_000));
      await emit(usageEvent(3, 100_000));
      await untilAborted(signal, 200);
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, adapter, fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'ceiling', actual_usd: 3.006, branch: 'card/4c2f5a1e-config' });
    expect(alert.messages).toEqual([expect.stringMatching(/^Card 4c2f5a1e paused \(ceiling\): spawn table row gatherer/)]);
    expect(db.ledger).toHaveLength(2);
    expect(calls).toEqual([]);
  });

  it('pauses a session that runs past its wall clock', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const adapter = new FakeAdapter(async (_spec, emit, signal) => {
      await emit(startEvent());
      await emit(usageEvent(1, 100));
      await untilAborted(signal, 2000);
    });
    const alert = new RecordingAlerter();
    // 0.0005 minutes is 30 ms; the variable itself takes whole minutes.
    await runCardPipeline(c, { ...deps(db, adapter, fetchFn, undefined, alert), config: { ...config, sessionMaxMinutes: 0.0005 } });
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'wall_clock', actual_usd: 0.0045 });
    expect(alert.messages).toEqual([expect.stringMatching(/^Card 4c2f5a1e paused \(wall_clock\): /)]);
    expect(calls).toEqual([]);
  });

  it('rejects a config card that edits outside the lane', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      await mkdir(path.join(spec.worktree, 'seed-1', 'sim'), { recursive: true });
      await writeFile(path.join(spec.worktree, 'seed-1', 'sim', 'extra.ts'), 'export const extra = 1;\n', 'utf8');
      await emit(usageEvent(1, 100));
    });
    await runCardPipeline(c, deps(db, adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'lane_violation', actual_usd: 0.0045 });
    expect(calls).toEqual([]);
  });

  it('rejects a code card that edits a kernel path inside its folder', async () => {
    const c = card({ lane: 'code', acceptance_test: null });
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await mkdir(path.join(spec.worktree, 'seed-1', 'sim'), { recursive: true });
      await writeFile(path.join(spec.worktree, 'seed-1', 'sim', 'invariants.ts'), 'export const invariants = [];\n', 'utf8');
      await emit(usageEvent(1, 100));
    });
    await runCardPipeline(c, deps(db, adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'lane_violation' });
    expect(calls).toEqual([]);
  });

  it('rejects when the acceptance check does not hold after the session', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    const adapter = new FakeAdapter(async (_spec, emit) => {
      await emit(startEvent());
      await emit(usageEvent(1, 10));
    });
    await runCardPipeline(c, deps(db, adapter, remote().fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'acceptance' });
  });

  it('rejects when the session changes nothing under the lane', async () => {
    const c = card({ acceptance_test: 'rename the cart row' });
    db.cards = [{ ...c, stage: 'building' }];
    const adapter = new FakeAdapter(async (_spec, emit) => {
      await emit(startEvent());
      await emit(usageEvent(1, 10));
    });
    await runCardPipeline(c, deps(db, adapter, remote().fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'no_changes' });
  });

  it('rejects before any session when the check already holds on main', async () => {
    const c = card({ acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 10' });
    db.cards = [{ ...c, stage: 'building' }];
    const adapter = new FakeAdapter(async () => undefined);
    await runCardPipeline(c, deps(db, adapter, remote().fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'acceptance_already_true' });
    expect(adapter.specs).toEqual([]);
  });

  it('rejects a malformed check line and an unsupported lane before touching git', async () => {
    const grammar = card({ acceptance_test: 'check: code seed-1/sim/index.ts x == 1' });
    db.cards = [{ ...grammar, stage: 'building' }];
    const adapter = new FakeAdapter(async () => undefined);
    await runCardPipeline(grammar, deps(db, adapter, remote().fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'acceptance_grammar', branch: null });

    const unsupported = card({ id: 'aaaaaaaa-0000-4000-8000-000000000002', folder: 'platform', lane: 'config', acceptance_test: null });
    db.cards = [{ ...unsupported, stage: 'building' }];
    await runCardPipeline(unsupported, deps(db, adapter, remote().fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'lane_unsupported', branch: null });
    expect(adapter.specs).toEqual([]);
  });

  it('rejects with dispatcher_error and a role-less event when the role cannot be read', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    db.roles = [];
    const adapter = new FakeAdapter(async () => undefined);
    await runCardPipeline(c, deps(db, adapter, remote().fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'dispatcher_error', branch: null });
    expect(db.events).toEqual([{ card_id: c.id, role_id: null, type: 'error', payload: { step: 'pipeline', message: 'db role: no row for role-builder-a' } }]);
    expect(adapter.specs).toEqual([]);
  });

  it('serves the checked value from the worktree the session edited', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    let seen = '';
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      seen = await readFile(path.join(spec.worktree, 'seed-1', 'config', 'spawn-table.json'), 'utf8');
      await editSpawnTable(spec.worktree, 11);
      await emit(usageEvent(1, 10));
    });
    const { fetchFn } = mockFetch((method, url) => {
      if (method === 'POST' && url === `${GITHUB}/pulls`) return { status: 201, json: { number: 5, head: { sha: 'head-sha' } } };
      if (url.startsWith(`${GITHUB}/commits/head-sha/check-runs`)) return { status: 200, json: { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'failure' }] } };
      return undefined;
    });
    await runCardPipeline(c, deps(db, adapter, fetchFn));
    expect(JSON.parse(seen)).toEqual(SPAWN_TABLE);
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'gate', branch: 'card/4c2f5a1e-config' });
    const pushed = await git(['show', '--format=%B', '--name-only', 'card/4c2f5a1e-config'], path.join(dir, 'origin.git'));
    expect(pushed).toContain('Lane: config');
    expect(pushed).toContain('seed-1/config/spawn-table.json');
  });
});
