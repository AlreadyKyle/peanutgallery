import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionPaused } from '../src/adapters/types.js';
import type { DispatcherConfig } from '../src/config.js';
import { haltReason, resetHalt } from '../src/halt.js';
import { createLogger } from '../src/log.js';
import { storedPatch, type PatchStore, type StoredPatch } from '../src/patch.js';
import { runCardPipeline, type PipelineDeps, type PipelineTimings } from '../src/pipeline.js';
import { parsePriceTable } from '../src/pricing.js';
import { AGENT_EMAIL, defaultGitRunner, git, setGitRunner, type GitCall } from '../src/worktree.js';
import { FakeAdapter, startEvent, untilAborted, usageEvent, type FakeScript } from './helpers/fake-adapter.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card } from './helpers/fake-db.js';
import { githubGitRoute, type CompareFile } from './helpers/github-git.js';
import { mockFetch, type FetchCall, type Reply } from './helpers/mock-fetch.js';

const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const MERGE_SHA = 'merge-sha-0123456789';
const GITHUB = 'https://api.github.com/repos/owner/repo';
const NETLIFY = 'https://api.netlify.com/api/v1/sites';
const SITE_URL = 'https://platform.local';
const SEED_URL = 'https://seed.local';
const CHECK_RUNS = /^https:\/\/api\.github\.com\/repos\/owner\/repo\/commits\/([^/]+)\/check-runs/;
const deploysUrl = (site: string) => `${NETLIFY}/${site}/deploys?page=1&per_page=50`;

let dir: string;
let origin: string;
let repo: string;
let initialSha: string;
let config: DispatcherConfig;
const savedEnv = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

const SPAWN_TABLE = { rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 0.2 }] };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-pipeline-'));
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
  origin = path.join(dir, 'origin.git');
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
  initialSha = await git(['rev-parse', 'HEAD'], repo);
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

// A test that merges for real moves origin's main; every test starts from the initial commit and
// with no halt.
beforeEach(async () => {
  resetHalt();
  setGitRunner(null);
  await git(['update-ref', 'refs/heads/main', initialSha], origin);
});

function originSha(ref: string): string {
  return execFileSync('git', ['rev-parse', '--verify', ref], { cwd: origin, stdio: 'pipe' }).toString().trim();
}

function originHas(branch: string): boolean {
  try {
    originSha(`refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

type Answer = Reply | ((head: string) => Reply);

// GitHub and Netlify answers for a card that sails through; tests override what they need. The
// pull request's head is the sha the dispatcher really pushed, read from the origin repository, and
// compare and trees are computed from it.
interface Remote {
  created?: Answer;
  existing?: Answer;
  pull?: Answer;
  gate?: Reply;
  merge?: Answer;
  deploys?: Answer;
  site?: Answer;
  page?: Answer;
  version?: Reply;
  restore?: Reply;
  ref?: Reply;
  compareExtra?: CompareFile[];
}

function answer(value: Answer | undefined, head: string, fallback: Reply): Reply {
  if (value === undefined) return fallback;
  return typeof value === 'function' ? value(head) : value;
}

// Revert routes that answer for any merge sha.
function revertRoute(method: string, url: string, ref?: Reply): Reply | undefined {
  if (method === 'GET' && url === `${GITHUB}/git/commits/parent-sha`) return { status: 200, json: { sha: 'parent-sha', tree: { sha: 'parent-tree' } } };
  const commit = /\/git\/commits\/([^/]+)$/.exec(url);
  if (method === 'GET' && commit) return { status: 200, json: { sha: commit[1], parents: [{ sha: 'parent-sha' }] } };
  if (method === 'POST' && url === `${GITHUB}/git/commits`) return { status: 201, json: { sha: 'revert-sha' } };
  if (method === 'PATCH' && url === `${GITHUB}/git/refs/heads/main`) return ref ?? { status: 200, json: { object: { sha: 'revert-sha' } } };
  return undefined;
}

function remote(over: Remote = {}) {
  const state = { head: '' };
  const readyDeploy = { id: 'dep-2', state: 'ready', commit_ref: MERGE_SHA, context: 'production' };
  const github = githubGitRoute(origin, over.compareExtra);
  const mock = mockFetch((method, url, body) => {
    if (method === 'POST' && url === `${GITHUB}/pulls`) {
      state.head = originSha(`refs/heads/${(body as { head: string }).head}`);
      return answer(over.created, state.head, { status: 201, json: { number: 5, head: { sha: state.head } } });
    }
    if (method === 'GET' && url.startsWith(`${GITHUB}/pulls?state=open`)) return answer(over.existing, state.head, { status: 200, json: [] });
    if (method === 'GET' && url === `${GITHUB}/pulls/5`) {
      return answer(over.pull, state.head, { status: 200, json: { number: 5, head: { sha: state.head }, merged: false, merge_commit_sha: null } });
    }
    if (method === 'GET' && CHECK_RUNS.test(url)) {
      return over.gate ?? { status: 200, json: { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'success' }] } };
    }
    const git = github(method, url);
    if (git) return git;
    if (method === 'PUT' && url === `${GITHUB}/pulls/5/merge`) return answer(over.merge, state.head, { status: 200, json: { sha: MERGE_SHA } });
    if (method === 'GET' && url === deploysUrl('site-platform')) return answer(over.deploys, state.head, { status: 200, json: [readyDeploy] });
    if (method === 'GET' && url === `${NETLIFY}/site-platform`) return answer(over.site, state.head, { status: 200, json: { ssl_url: `${SITE_URL}/` } });
    if (method === 'POST' && url === `${NETLIFY}/site-platform/deploys/dep-1/restore`) return over.restore ?? { status: 200, json: { id: 'dep-1' } };
    if (method === 'GET' && url === `${SITE_URL}/`) return answer(over.page, state.head, { status: 200, text: `<meta name="build-sha" content="${MERGE_SHA}">` });
    if (method === 'GET' && url === `${SITE_URL}/version.json`) return over.version ?? { status: 200, json: { sha: MERGE_SHA } };
    return revertRoute(method, url, over.ref);
  });
  return { ...mock, state };
}

const FAST: Partial<PipelineTimings> = { prHeadTimeoutMs: 50, prHeadIntervalMs: 5, retryDelayMs: 1, deployIntervalMs: 5, mergeStateTimeoutMs: 40, mergeStateIntervalMs: 5 };

function deps(db: FakeDb, adapter: FakeAdapter, fetchFn: typeof fetch, stop = new AbortController(), alert = new RecordingAlerter()): PipelineDeps {
  return { db, adapter, config, log: silent, alert, stopSignal: stop.signal, now: () => NOW, fetchFn, timings: FAST };
}

const platformCard = (overrides: Parameters<typeof card>[0] = {}) => card({ folder: 'platform', lane: 'code', acceptance_test: null, intent: 'Name the page.', ...overrides });
const OLDER_GREEN = { id: 'row-1', folder: 'platform' as const, sha: 'older-sha', netlify_deploy_id: 'dep-1', is_green: true, smoke_result: 'pass: build older-sh served', created_at: NOW.toISOString() };

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

function recordGit(): GitCall[] {
  const calls: GitCall[] = [];
  setGitRunner((call) => {
    calls.push(call);
    return defaultGitRunner(call);
  });
  return calls;
}

describe('runCardPipeline', () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it('takes a card from building to live with a green deploys row and a ship event', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls, state } = remote();
    const adapter = new FakeAdapter(editSite);
    await runCardPipeline(c, deps(db, adapter, fetchFn));

    const final = db.cards[0]!;
    expect(final).toMatchObject({ stage: 'live', failing_check: null, branch: 'card/4c2f5a1e-code', commit_sha: MERGE_SHA, actual_usd: 0.0045 });
    expect(db.ledger).toHaveLength(1);
    expect(db.deploys).toEqual([expect.objectContaining({ folder: 'platform', sha: MERGE_SHA, netlify_deploy_id: 'dep-2', is_green: true, smoke_result: 'pass: build merge-sh served; gate green at the merge sha' })]);
    expect(db.events.map((e) => [e.type, e.payload.step])).toEqual([
      ['start', undefined],
      ['gate_pass', undefined],
      ['message', 'smoke_pass'],
      ['ship', undefined],
    ]);
    expect(db.events.at(-1)?.payload).toMatchObject({ sha: MERGE_SHA, deploy_id: 'dep-2', url: SITE_URL });
    expect(state.head).toMatch(/^[0-9a-f]{40}$/);
    expect(urls(calls)).toEqual([
      `POST ${GITHUB}/pulls`,
      `GET ${GITHUB}/commits/${state.head}/check-runs?check_name=gate&per_page=50`,
      `GET ${GITHUB}/compare/${initialSha}...${state.head}`,
      `GET ${GITHUB}/git/trees/${initialSha}?recursive=1`,
      `GET ${GITHUB}/git/trees/${state.head}?recursive=1`,
      `PUT ${GITHUB}/pulls/5/merge`,
      `GET ${deploysUrl('site-platform')}`,
      `GET ${NETLIFY}/site-platform`,
      `GET ${SITE_URL}/`,
      `GET ${SITE_URL}/version.json`,
      `GET ${GITHUB}/commits/${MERGE_SHA}/check-runs?check_name=gate&per_page=50`,
    ]);
    expect(calls[5]?.body).toMatchObject({ sha: state.head, merge_method: 'squash', commit_title: 'card 4c2f5a1e: spawn table row gatherer: baseCost changes from 10 to 11' });
    expect(calls[0]?.body).toMatchObject({ head: 'card/4c2f5a1e-code', base: 'main' });
    expect(String(calls[0]?.body && (calls[0].body as { body: string }).body)).toContain(`Card-Id: ${c.id}`);

    const pushed = await git(['show', '--format=%an <%ae>%P%n%B', '--name-only', 'card/4c2f5a1e-code'], origin);
    expect(pushed).toContain(`Builder A (AI agent) <${AGENT_EMAIL}>${initialSha}`);
    expect(pushed).toContain('platform/site/index.html');
    expect(existsSync(path.join(config.worktreeRoot, 'card-4c2f5a1e'))).toBe(false);
    expect(adapter.specs[0]?.prompt).toContain('Allowed paths: platform/site.');
  });

  it('restores the previous green deploy, reverts main and rejects the card when smoke fails', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [OLDER_GREEN];
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

  it.each<[string, Remote, string, Partial<PipelineTimings>]>([
    ['the site read keeps returning 500', { site: { status: 500, json: {} } }, 'netlify site site-platform: http 500', {}],
    [
      'the smoke fetch keeps throwing',
      {
        page: () => {
          throw new TypeError('fetch failed');
        },
      },
      'fetch failed',
      {},
    ],
    ['the deploy list returns 502 up to the deadline', { deploys: { status: 502, json: {} } }, 'netlify deploys: http 502', { deployTimeoutMs: 30 }],
  ])('restores, reverts and rejects post_merge when %s after the merge', async (_name, over, detail, timings) => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [OLDER_GREEN];
    const { fetchFn, calls } = remote(over);
    const alert = new RecordingAlerter();
    await runCardPipeline(c, { ...deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert), timings: { ...FAST, ...timings } });

    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'post_merge', commit_sha: MERGE_SHA });
    expect(db.events.at(-1)).toMatchObject({
      type: 'revert',
      payload: { failed_sha: MERGE_SHA, reason: `post-merge check failed: ${detail}`, restored_sha: 'older-sha', revert_sha: 'revert-sha' },
    });
    expect(urls(calls)).toContain(`POST ${NETLIFY}/site-platform/deploys/dep-1/restore`);
    expect(urls(calls)).toContain(`PATCH ${GITHUB}/git/refs/heads/main`);
    expect(db.deploys.filter((row) => row.is_green)).toEqual([OLDER_GREEN]);
    expect(alert.messages).toEqual([
      `Card 4c2f5a1e was reverted on main (revert-): post-merge check failed: ${detail}`,
      `Card 4c2f5a1e rejected (post_merge): spawn table row gatherer: baseCost changes from 10 to 11. ${detail}`,
    ]);
  });

  it('rides out a single 502 from the deploy list, a failed site read and a failed restore call, and ships', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    let deployReads = 0;
    let siteReads = 0;
    const { fetchFn } = remote({
      deploys: () => {
        deployReads += 1;
        return deployReads === 1 ? { status: 502, json: {} } : { status: 200, json: [{ id: 'dep-2', state: 'ready', commit_ref: MERGE_SHA, context: 'production' }] };
      },
      site: () => {
        siteReads += 1;
        if (siteReads === 1) throw new TypeError('fetch failed');
        return { status: 200, json: { ssl_url: SITE_URL } };
      },
    });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA });
    expect([deployReads, siteReads]).toEqual([2, 2]);
  });

  it('retries the restore and the revert when their requests throw', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [OLDER_GREEN];
    let restores = 0;
    let patches = 0;
    const base = remote({ page: { status: 500, text: '' } });
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/deploys/dep-1/restore') && ++restores === 1) throw new TypeError('fetch failed');
      if (init?.method === 'PATCH' && ++patches === 1) throw new TypeError('fetch failed');
      return base.fetchFn(input, init);
    }) as typeof fetch;
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'smoke' });
    expect([restores, patches]).toEqual([2, 2]);
    expect(db.events.at(-1)?.payload).toMatchObject({ restored_sha: 'older-sha', revert_sha: 'revert-sha' });
    expect(db.events.at(-1)?.payload).not.toHaveProperty('restore_error');
  });

  it('leaves a verified card gated with its merge sha, without a revert, when the ship writes keep failing', async () => {
    const c = platformCard();
    class FailingDeploys extends FakeDb {
      attempts = 0;
      override async insertDeploy() {
        this.attempts += 1;
        throw new Error('db deploys insert: connection reset');
      }
    }
    const failing = new FailingDeploys();
    failing.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(failing, new FakeAdapter(editSite), fetchFn, undefined, alert));

    expect(failing.attempts).toBe(4);
    expect(failing.cards[0]).toMatchObject({ stage: 'gated', failing_check: null, commit_sha: MERGE_SHA });
    expect(failing.events.map((e) => e.type)).toEqual(['start', 'gate_pass', 'message']);
    expect(failing.events.at(-1)?.payload).toEqual({ step: 'smoke_pass', sha: MERGE_SHA, deploy_id: 'dep-2', url: SITE_URL, smoke: 'pass: build merge-sh served; gate green at the merge sha' });
    expect(urls(calls).some((call) => call.includes('/git/commits') || call.includes('/restore'))).toBe(false);
    expect(alert.messages).toEqual([
      'Card 4c2f5a1e merged as merge-sh and passed smoke, but recording it failed: db deploys insert: connection reset. It is left gated and is checked again when the dispatcher starts.',
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

  it('still restores, reverts and alerts when the database fails during the rollback', async () => {
    const c = platformCard();
    class BrokenDb extends FakeDb {
      override async lastGreen(): Promise<never> {
        throw new Error('db last_green: connection reset');
      }
      override async insertEvent(cardId: string, roleId: string | null, type: Parameters<FakeDb['insertEvent']>[2], payload: Record<string, unknown>) {
        if (type === 'revert') throw new Error('db agent_events insert: connection reset');
        return super.insertEvent(cardId, roleId, type, payload);
      }
    }
    const broken = new BrokenDb();
    broken.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote({ page: { status: 500, text: '' } });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(broken, new FakeAdapter(editSite), fetchFn, undefined, alert));

    expect(broken.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'smoke' });
    expect(urls(calls)).toContain(`PATCH ${GITHUB}/git/refs/heads/main`);
    expect(alert.messages[0]).toBe(
      'Card 4c2f5a1e failed after merge and the rollback is incomplete: the last green deploy could not be read (db last_green: connection reset). Check main and the live site.',
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

  it('rejects history, without merging, when GitHub reports a range that differs from the local check', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote({ compareExtra: [{ filename: 'platform/gate/ship-gate.sh', status: 'modified' }] });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'history', commit_sha: null });
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
    expect(alert.messages[0]).toContain('platform/gate/ship-gate.sh');
  });

  it('waits for an existing pull request to show the pushed sha, then rejects pr_head without gating on the stale head', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote({
      created: { status: 422, json: { message: 'A pull request already exists for owner:card/4c2f5a1e-code.' } },
      existing: { status: 200, json: [{ number: 5, head: { sha: 'stale-sha' } }] },
      pull: { status: 200, json: { number: 5, head: { sha: 'stale-sha' }, merged: false } },
    });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'pr_head', commit_sha: null });
    expect(urls(calls).filter((call) => call === `GET ${GITHUB}/pulls/5`).length).toBeGreaterThan(1);
    expect(urls(calls).some((call) => CHECK_RUNS.test(call.slice(4)) || call.startsWith('PUT'))).toBe(false);
  });

  it('continues with the merge commit when the merge request times out but the pull request merged', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn } = remote({
      merge: () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
      pull: (head) => ({ status: 200, json: { number: 5, head: { sha: head }, merged: true, merge_commit_sha: MERGE_SHA } }),
    });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA });
  });

  it('leaves the card gated with a merge_unknown marker when the merge request times out and the pull request does not show merged', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls, state } = remote({
      merge: () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'gated', failing_check: 'merge_unknown', commit_sha: null });
    expect(db.events.at(-1)).toMatchObject({ type: 'error', payload: { step: 'merge_unknown', pr: 5, sha: state.head } });
    expect(urls(calls).some((call) => call.includes('/deploys') || call.includes('/git/commits'))).toBe(false);
    expect(alert.messages).toEqual([
      expect.stringMatching(/^Card 4c2f5a1e: the merge request for pull request #5 failed .* It is left gated; the dispatcher checks it again when it starts, and nothing was closed\.$/),
    ]);
  });

  it('pauses without a deploys row when the dispatcher stops during the gate wait', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const stop = new AbortController();
    const { fetchFn, calls } = remote({
      gate: { status: 200, json: { check_runs: [{ name: 'gate', status: 'in_progress', conclusion: null }] } },
      created: (head) => {
        stop.abort('dispatcher stopping');
        return { status: 201, json: { number: 5, head: { sha: head } } };
      },
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, stop, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'dispatcher_stopped' });
    expect(alert.messages).toEqual([]);
    expect(db.deploys).toEqual([]);
    expect(db.events.map((e) => e.type)).toEqual(['start']);
    expect(urls(calls)).toHaveLength(2);
  });

  it('leaves a merged card gated with its merge sha, and alerts, when the dispatcher stops during the deploy wait', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const stop = new AbortController();
    const building = { id: 'dep-2', state: 'building', commit_ref: MERGE_SHA, context: 'production' };
    const { fetchFn, calls } = remote({
      merge: () => {
        stop.abort('dispatcher stopping');
        return { status: 200, json: { sha: MERGE_SHA } };
      },
      deploys: { status: 200, json: [building] },
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, stop, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'gated', failing_check: null, commit_sha: MERGE_SHA });
    expect(db.deploys).toEqual([]);
    expect(db.events.map((e) => e.type)).toEqual(['start', 'gate_pass']);
    expect(urls(calls).some((call) => call.includes('/git/commits') || call.includes('/restore'))).toBe(false);
    expect(alert.messages).toEqual([
      'Card 4c2f5a1e merged as merge-sh but the dispatcher stopped while the deploy was running. It is left gated and is checked again when the dispatcher starts.',
    ]);
  });

  it('rolls back instead of leaving the card gated when it stops during the deploy wait with no commit_sha written', async () => {
    const c = platformCard();
    class NoShaDb extends FakeDb {
      override async updateCard(id: string, patch: Parameters<FakeDb['updateCard']>[1]) {
        if (patch.commit_sha) throw new Error('db update card: connection reset');
        return super.updateCard(id, patch);
      }
    }
    const noSha = new NoShaDb();
    noSha.cards = [{ ...c, stage: 'building' }];
    noSha.deploys = [OLDER_GREEN];
    const stop = new AbortController();
    const { fetchFn, calls } = remote({
      merge: () => {
        stop.abort('dispatcher stopping');
        return { status: 200, json: { sha: MERGE_SHA } };
      },
      deploys: { status: 200, json: [{ id: 'dep-2', state: 'building', commit_ref: MERGE_SHA, context: 'production' }] },
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(noSha, new FakeAdapter(editSite), fetchFn, stop, alert));
    expect(noSha.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'post_merge', commit_sha: null });
    expect(urls(calls)).toContain(`POST ${NETLIFY}/site-platform/deploys/dep-1/restore`);
    expect(urls(calls)).toContain(`PATCH ${GITHUB}/git/refs/heads/main`);
    expect(alert.messages[0]).toBe('Card 4c2f5a1e merged as merge-sh but its commit_sha was not written (db update card: connection reset). Verification goes on.');
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

  it('never merges, verifies or reverts two cards at the same time', async () => {
    const first = platformCard({ id: 'a1a1a1a1-0000-4000-8000-00000000000a' });
    const second = platformCard({ id: 'b2b2b2b2-0000-4000-8000-00000000000b' });
    db.cards = [
      { ...first, stage: 'building' },
      { ...second, stage: 'building' },
    ];
    const heads = new Map<number, string>();
    const polls = new Map<string, number>();
    const merged: string[] = [];
    const timeline: string[] = [];
    const github = githubGitRoute(origin);
    const { fetchFn } = mockFetch((method, url, body) => {
      if (method === 'POST' && url === `${GITHUB}/pulls`) {
        const number = heads.size + 1;
        const head = originSha(`refs/heads/${(body as { head: string }).head}`);
        heads.set(number, head);
        return { status: 201, json: { number, head: { sha: head } } };
      }
      if (method === 'GET' && CHECK_RUNS.test(url)) return { status: 200, json: { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'success' }] } };
      const git = github(method, url);
      if (git) return git;
      const merge = /\/pulls\/(\d+)\/merge$/.exec(url);
      if (method === 'PUT' && merge) {
        const sha = `merge-${heads.get(Number(merge[1]))!.slice(0, 8)}`;
        merged.push(sha);
        timeline.push(`merge ${sha}`);
        return { status: 200, json: { sha } };
      }
      if (method === 'GET' && url === deploysUrl('site-platform')) {
        // A deploy builds until the other card has merged too, or for 200 polls (a second or more), so
        // without the lock the second merge lands while the first card is still verifying.
        const list = merged.map((sha) => {
          const seen = (polls.get(sha) ?? 0) + 1;
          polls.set(sha, seen);
          return { id: `dep-${sha}`, state: merged.length === 2 || seen >= 200 ? 'ready' : 'building', commit_ref: sha, context: 'production' };
        });
        return { status: 200, json: list };
      }
      if (method === 'GET' && url === `${NETLIFY}/site-platform`) return { status: 200, json: { ssl_url: SITE_URL } };
      if (method === 'GET' && url === `${SITE_URL}/`) return { status: 200, text: `<meta name="build-sha" content="${merged.at(-1)}">` };
      if (method === 'GET' && url === `${SITE_URL}/version.json`) {
        timeline.push(`verify ${merged.at(-1)}`);
        return { status: 200, json: { sha: merged.at(-1) } };
      }
      return revertRoute(method, url);
    });
    await Promise.all([
      runCardPipeline(first, deps(db, new FakeAdapter(editSite), fetchFn)),
      runCardPipeline(second, deps(db, new FakeAdapter(editSite), fetchFn)),
    ]);
    expect(db.cards.map((c) => c.stage)).toEqual(['live', 'live']);
    expect(merged).toHaveLength(2);
    expect(timeline).toEqual([`merge ${merged[0]}`, `verify ${merged[0]}`, `merge ${merged[1]}`, `verify ${merged[1]}`]);
  });

  it('smokes a seed card without running card code: the served files match the merge commit and the gate is green there', async () => {
    const c = card({ id: 'dddddddd-0000-4000-8000-000000000004' });
    db.cards = [{ ...c, stage: 'building' }];
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      await emit(usageEvent(1, 10));
    });
    const { fetchFn, calls, state } = seedRemote();
    await runCardPipeline(c, deps(db, adapter, fetchFn));

    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: state.merged });
    expect(state.merged).toMatch(/^[0-9a-f]{40}$/);
    const gets = calls.filter((call) => call.method === 'GET').map((call) => call.url);
    expect(gets).toContain(`${SEED_URL}/config/spawn-table.json`);
    expect(gets).toContain(`${SEED_URL}/content/strings.json`);
    expect(gets).toContain(`${GITHUB}/commits/${state.merged}/check-runs?check_name=gate&per_page=50`);
    expect(db.deploys.at(-1)).toMatchObject({ sha: state.merged, is_green: true, smoke_result: expect.stringContaining('2 served file(s) match the merge commit; gate green at the merge sha') });
    expect(existsSync(path.join(config.worktreeRoot, 'smoke-dddddddd'))).toBe(false);
    expect(await git(['worktree', 'list', '--porcelain'], repo)).not.toContain('smoke-');
  });

  it('rolls a seed card back when a served file differs from the merge commit by one byte', async () => {
    const c = card({ id: 'dddddddd-0000-4000-8000-000000000005' });
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [{ ...OLDER_GREEN, folder: 'seed-1' }];
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      await emit(usageEvent(1, 10));
    });
    const { fetchFn, state } = seedRemote({ tamper: '/content/strings.json' });
    await runCardPipeline(c, deps(db, adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'smoke', commit_sha: state.merged });
    expect(db.deploys.at(-1)).toMatchObject({ sha: state.merged, is_green: false, smoke_result: `fail: served /content/strings.json differs from seed-1/content/strings.json at the merge commit ${state.merged.slice(0, 8)}` });
    expect(db.events.at(-1)).toMatchObject({ type: 'revert', payload: { failed_sha: state.merged, restored_sha: 'older-sha', revert_sha: 'revert-sha' } });
  });

  it('rolls a seed card back when the gate fails at the merge sha', async () => {
    const c = card({ id: 'dddddddd-0000-4000-8000-000000000006' });
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [{ ...OLDER_GREEN, folder: 'seed-1' }];
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      await emit(usageEvent(1, 10));
    });
    const { fetchFn, state } = seedRemote({ mergeGate: 'failure' });
    await runCardPipeline(c, deps(db, adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'smoke', commit_sha: state.merged });
    expect(db.deploys.at(-1)).toMatchObject({ is_green: false, smoke_result: 'fail: the gate at the merge sha concluded failure' });
  });

  it('rejects an agent commit in the worktree as history and pushes nothing', async () => {
    const c = card({ id: 'bbbbbbbb-0000-4000-8000-000000000002' });
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      execFileSync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.com', 'commit', '-q', '-a', '-m', 'agent'], { cwd: spec.worktree, stdio: 'pipe' });
      await emit(usageEvent(1, 10));
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, adapter, fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'history' });
    expect(calls).toEqual([]);
    expect(originHas('card/bbbbbbbb-config')).toBe(false);
    expect(alert.messages).toEqual([expect.stringMatching(/^Card bbbbbbbb rejected \(history\): /)]);
  });

  it('rejects a symlink in the committed range as file_mode and pushes nothing', async () => {
    const c = card({ id: 'cccccccc-0000-4000-8000-000000000003' });
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      await symlink('../../.github', path.join(spec.worktree, 'seed-1', 'content', 'gh'));
      await emit(usageEvent(1, 10));
    });
    await runCardPipeline(c, deps(db, adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'file_mode' });
    expect(calls).toEqual([]);
    expect(originHas('card/cccccccc-config')).toBe(false);
  });

  it('rejects git_tamper, halts, and runs no git at all after a session plants a signing program', async () => {
    const c = card({ id: 'eeeeeeee-0000-4000-8000-000000000005' });
    db.cards = [{ ...c, stage: 'building' }];
    const configFile = path.join(repo, '.git', 'config');
    const clean = await readFile(configFile, 'utf8');
    const marker = path.join(dir, 'gpg-ran.txt');
    const signer = path.join(dir, 'sign.sh');
    await writeFile(signer, `#!/bin/sh\necho ran >> "${marker}"\nexit 1\n`, { encoding: 'utf8', mode: 0o755 });
    const { fetchFn, calls } = remote();
    const gitCalls = recordGit();
    let atSessionEnd = -1;
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      await appendFile(configFile, `[gpg]\n\tprogram = ${signer}\n[commit]\n\tgpgSign = true\n`, 'utf8');
      await emit(usageEvent(1, 10));
      atSessionEnd = gitCalls.length;
    });
    const alert = new RecordingAlerter();
    try {
      await runCardPipeline(c, deps(db, adapter, fetchFn, undefined, alert));
    } finally {
      setGitRunner(null);
      await writeFile(configFile, clean, 'utf8');
    }
    const halted = haltReason();
    resetHalt();
    await git(['worktree', 'prune'], repo);
    expect(atSessionEnd).toBeGreaterThan(0);
    expect(gitCalls).toHaveLength(atSessionEnd);
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'git_tamper' });
    expect(halted).toMatch(/^git_tamper: /);
    expect(calls).toEqual([]);
    expect(originHas('card/eeeeeeee-config')).toBe(false);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(config.worktreeRoot, 'card-eeeeeeee'))).toBe(false);
    expect(alert.messages).toEqual([expect.stringMatching(/^Card eeeeeeee rejected \(git_tamper\): .*gpg\.program.*The dispatcher claims no card and runs no git until it restarts/)]);
  });

  // What a session can plant to make git read configuration, attributes or objects from somewhere
  // the snapshot and the allowlist do not look, or to have git run a program. Each returns its cleanup.
  const REDIRECTS: Array<[string, (worktree: string) => Promise<() => Promise<void>>]> = [
    [
      'a commondir pointing at a copy of the repository with a smudge filter',
      async (worktree) => {
        const copy = path.join(worktree, 'seed-1', 'content', 'copy.git');
        await cp(path.join(repo, '.git'), copy, { recursive: true });
        await appendFile(path.join(copy, 'config'), `[filter "x"]\n\tsmudge = "echo ran >> '${path.join(dir, 'filter-ran.txt')}'; cat"\n`, 'utf8');
        await mkdir(path.join(copy, 'info'), { recursive: true });
        await writeFile(path.join(copy, 'info', 'attributes'), '* filter=x\n', 'utf8');
        await writeFile(path.join(repo, '.git', 'commondir'), `${copy}\n`, 'utf8');
        return () => rm(path.join(repo, '.git', 'commondir'), { force: true });
      },
    ],
    ['info/attributes', async () => placed(path.join(repo, '.git', 'info', 'attributes'), '* filter=x\n')],
    ['objects/info/alternates', async () => placed(path.join(repo, '.git', 'objects', 'info', 'alternates'), `${path.join(dir, 'elsewhere', 'objects')}\n`)],
    ['objects/info/http-alternates', async () => placed(path.join(repo, '.git', 'objects', 'info', 'http-alternates'), 'https://evil.example/objects\n')],
    ['a hook that is not a sample', async () => placed(path.join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\nexit 0\n')],
    ['a worktree config.worktree', async (worktree) => placed(path.join(repo, '.git', 'worktrees', path.basename(worktree), 'config.worktree'), '[core]\n\tbare = false\n')],
    ['a worktree commondir that is not ../..', async (worktree) => placed(path.join(repo, '.git', 'worktrees', path.basename(worktree), 'commondir'), `${path.join(dir, 'elsewhere')}\n`)],
  ];

  async function placed(file: string, content: string): Promise<() => Promise<void>> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
    return () => rm(file, { force: true });
  }

  it.each(REDIRECTS)('rejects git_tamper and runs no git after a session plants %s', async (_name, plantIt) => {
    const c = card({ id: 'abcdef01-0000-4000-8000-000000000007' });
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const gitCalls = recordGit();
    let atSessionEnd = -1;
    let cleanup: () => Promise<void> = async () => undefined;
    const adapter = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent());
      await editSpawnTable(spec.worktree, 11);
      cleanup = await plantIt(spec.worktree);
      await emit(usageEvent(1, 10));
      atSessionEnd = gitCalls.length;
    });
    const alert = new RecordingAlerter();
    try {
      await runCardPipeline(c, deps(db, adapter, fetchFn, undefined, alert));
    } finally {
      setGitRunner(null);
      await cleanup();
    }
    const halted = haltReason();
    resetHalt();
    await git(['worktree', 'prune'], repo);
    expect(atSessionEnd).toBeGreaterThan(0);
    expect(gitCalls).toHaveLength(atSessionEnd);
    expect(halted).toMatch(/^git_tamper: /);
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'git_tamper' });
    expect(calls).toEqual([]);
    expect(originHas('card/abcdef01-config')).toBe(false);
    expect(existsSync(path.join(dir, 'filter-ran.txt'))).toBe(false);
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

  for (const [name, target] of [
    ['a file outside the worktree', 'outside'],
    ['/dev/zero', '/dev/zero'],
  ] as const) {
    it(`fails the acceptance check, never reading through it, when the session leaves a symlink to ${name} at the checked file`, async () => {
      const c = card();
      db.cards = [{ ...c, stage: 'building' }];
      const outside = path.join(dir, 'outside-spawn-table.json');
      await writeFile(outside, `${JSON.stringify({ rows: SPAWN_TABLE.rows.map((row) => ({ ...row, baseCost: 11 })) })}\n`, 'utf8');
      const adapter = new FakeAdapter(async (spec, emit) => {
        await emit(startEvent());
        const file = path.join(spec.worktree, 'seed-1', 'config', 'spawn-table.json');
        await rm(file);
        await symlink(target === 'outside' ? outside : target, file);
        await emit(usageEvent(1, 10));
      });
      await runCardPipeline(c, deps(db, adapter, remote().fetchFn));
      expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'acceptance' });
    });
  }

  it('pauses, not rejects, a card whose adapter started no session for a reason that is not the card', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    const adapter = new FakeAdapter(async () => {
      throw new SessionPaused('managed_api', 'the Managed Agents session could not be created: 529 overloaded_error');
    });
    const alert = new RecordingAlerter();
    const { fetchFn, calls } = remote();
    await runCardPipeline(c, deps(db, adapter, fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'managed_api' });
    expect(calls).toEqual([]);
    expect(alert.messages[0]).toMatch(/paused \(managed_api\).*529 overloaded_error/);
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
    const { fetchFn } = remote({ gate: { status: 200, json: { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'failure' }] } } });
    await runCardPipeline(c, deps(db, adapter, fetchFn));
    expect(JSON.parse(seen)).toEqual(SPAWN_TABLE);
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'gate', branch: 'card/4c2f5a1e-config' });
    const pushed = await git(['show', '--format=%B', '--name-only', 'card/4c2f5a1e-config'], origin);
    expect(pushed).toContain('Lane: config');
    expect(pushed).toContain('seed-1/config/spawn-table.json');
  });
});

// The seed site, where the merge lands the pushed commit on origin's main so the merge sha is a real
// commit whose served files the smoke test compares byte for byte. The served config and content are
// the merge commit's own bytes, unless tamper names a route to serve one byte off; mergeGate is the
// gate's conclusion at the merge sha (the card's own head always passes).
function seedRemote(options: { tamper?: string; mergeGate?: string } = {}) {
  const state = { merged: '' };
  const github = githubGitRoute(origin);
  const mock = mockFetch((method, url, body) => {
    if (method === 'POST' && url === `${GITHUB}/pulls`) {
      return { status: 201, json: { number: 5, head: { sha: originSha(`refs/heads/${(body as { head: string }).head}`) } } };
    }
    const checks = CHECK_RUNS.exec(url);
    if (method === 'GET' && checks) {
      const conclusion = checks[1] === state.merged && options.mergeGate ? options.mergeGate : 'success';
      return { status: 200, json: { check_runs: [{ name: 'gate', status: 'completed', conclusion }] } };
    }
    const git = github(method, url);
    if (git) return git;
    if (method === 'PUT' && url === `${GITHUB}/pulls/5/merge`) {
      state.merged = (body as { sha: string }).sha;
      execFileSync('git', ['update-ref', 'refs/heads/main', state.merged], { cwd: origin, stdio: 'pipe' });
      return { status: 200, json: { sha: state.merged } };
    }
    if (method === 'GET' && url === deploysUrl('site-seed')) return { status: 200, json: [{ id: 'dep-9', state: 'ready', commit_ref: state.merged, context: 'production' }] };
    if (method === 'GET' && url === `${NETLIFY}/site-seed`) return { status: 200, json: { ssl_url: SEED_URL } };
    if (method === 'POST' && url === `${NETLIFY}/site-seed/deploys/dep-1/restore`) return { status: 200, json: { id: 'dep-1' } };
    if (method === 'GET' && url === `${SEED_URL}/`) return { status: 200, text: `<meta name="build-sha" content="${state.merged}">` };
    if (method === 'GET' && url === `${SEED_URL}/version.json`) return { status: 200, json: { sha: state.merged } };
    const served = /^https:\/\/seed\.local(\/(config|content)\/.+)$/.exec(url);
    if (method === 'GET' && served) {
      const route = served[1]!;
      const text = execFileSync('git', ['show', `${state.merged}:seed-1${route}`], { cwd: origin, stdio: 'pipe' }).toString();
      return { status: 200, text: route === options.tamper ? `${text} ` : text };
    }
    return revertRoute(method, url);
  });
  return { ...mock, state };
}

// Accepted managed-session patches, kept per card (card_patches in production).
class MemoryPatchStore implements PatchStore {
  rows: StoredPatch[] = [];
  async save(patch: StoredPatch) {
    this.rows.push(patch);
  }
  async latest(cardId: string) {
    return [...this.rows].reverse().find((row) => row.cardId === cardId) ?? null;
  }
  async discard(cardId: string) {
    this.rows = this.rows.filter((row) => row.cardId !== cardId);
  }
}

// The patch an earlier managed session had accepted for a platform card: made against the initial
// commit, stored with it.
function storedSitePatch(title: string): string {
  const file = path.join(repo, 'platform', 'site', 'index.html');
  const original = readFileSync(file, 'utf8');
  execFileSync('git', ['checkout', '-q', initialSha, '--', 'platform/site/index.html'], { cwd: repo, stdio: 'pipe' });
  const before = readFileSync(file, 'utf8');
  execFileSync('bash', ['-c', `printf '%s\n' "$1" > "$2"`, 'x', title, file]);
  const patch = execFileSync('git', ['diff', '--no-renames', '--full-index', initialSha, '--', 'platform/site/index.html'], { cwd: repo, stdio: 'pipe' }).toString();
  execFileSync('bash', ['-c', 'printf "%s" "$1" > "$2"', 'x', before === original ? original : before, file]);
  return patch;
}

describe('a card with a stored patch', () => {
  it('is rebuilt from the patch at the new base and merged with no session and no new ledger row', async () => {
    const db = new FakeDb();
    const c = platformCard({ id: 'eeeeeeee-0000-4000-8000-000000000001' });
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [OLDER_GREEN];
    const patches = new MemoryPatchStore();
    await patches.save(storedPatch(c.id, initialSha, Buffer.from(storedSitePatch('<title>Studio</title>')), 'Name the page Studio', 'sesn_earlier'));
    let sessions = 0;
    const adapter = new FakeAdapter(async () => {
      sessions += 1;
    });
    const { fetchFn } = remote();
    await runCardPipeline(c, { ...deps(db, adapter, fetchFn), patches });
    expect(sessions).toBe(0);
    expect(adapter.specs).toEqual([]);
    expect(db.ledger).toEqual([]);
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA });
    expect(db.events.find((event) => event.payload.step === 'patch_reused')).toMatchObject({ type: 'message', payload: { base_sha: initialSha, files: ['platform/site/index.html'] } });
    const pushed = await git(['show', 'card/eeeeeeee-code:platform/site/index.html'], origin);
    expect(pushed).toBe('<title>Studio</title>');
  });

  it('pauses as patch_conflict, discards the patch and starts no session when the patch no longer applies', async () => {
    const db = new FakeDb();
    const c = platformCard({ id: 'eeeeeeee-0000-4000-8000-000000000002' });
    db.cards = [{ ...c, stage: 'building' }];
    const patches = new MemoryPatchStore();
    await patches.save(storedPatch(c.id, initialSha, Buffer.from(storedSitePatch('<title>Studio</title>').replace('-<title>Backseat</title>', '-<title>Something else</title>')), 'Name the page Studio', 'sesn_earlier'));
    const adapter = new FakeAdapter(async () => undefined);
    const alert = new RecordingAlerter();
    const { fetchFn, calls } = remote();
    await runCardPipeline(c, { ...deps(db, adapter, fetchFn, undefined, alert), patches });
    expect(adapter.specs).toEqual([]);
    expect(db.ledger).toEqual([]);
    expect(patches.rows).toEqual([]);
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'patch_conflict' });
    expect(calls).toEqual([]);
    expect(alert.messages[0]).toMatch(/paused \(patch_conflict\).*no longer applies on main/);
  });
});

