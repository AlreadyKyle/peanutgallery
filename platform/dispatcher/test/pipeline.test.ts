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
import { SessionBudgets } from '../src/budgets.js';
import { storedPatch, type PatchStore, type StoredPatch } from '../src/patch.js';
import { runCardPipeline, type PipelineDeps, type PipelineTimings } from '../src/pipeline.js';
import { parsePriceTable } from '../src/pricing.js';
import { tick } from '../src/tick.js';
import { TypedOutput } from '../src/typed-output.js';
import type { VisualVerdict } from '../src/visual-review.js';
import { strToU8, zipSync } from 'fflate';
import { AGENT_EMAIL, defaultGitRunner, git, setGitRunner, type GitCall } from '../src/worktree.js';
import { FakeAdapter, startEvent, untilAborted, usageEvent, type FakeScript } from './helpers/fake-adapter.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card, role } from './helpers/fake-db.js';
import { githubGitRoute, type CompareFile } from './helpers/github-git.js';
import { mockFetch, type FetchCall, type Reply } from './helpers/mock-fetch.js';

const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const MERGE_SHA = 'merge-sha-0123456789';
const GITHUB = 'https://api.github.com/repos/owner/repo';
const NETLIFY = 'https://api.netlify.com/api/v1/sites';
const SITE_URL = 'https://platform.local';
const SEED_URL = 'https://seed.local';
const CHECK_RUNS = /^https:\/\/api\.github\.com\/repos\/owner\/repo\/actions\/runs\?head_sha=([^&]+)/;
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
  await writeFile(path.join(repo, 'platform', 'site', 'page.html'), '<title>Backseat</title>\n', 'utf8');
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
  // The gate at the card's base, main's head when the card was claimed; green when unset.
  baseGate?: Reply;
  merge?: Answer;
  deploys?: Answer;
  site?: Answer;
  page?: Answer;
  version?: Reply;
  restore?: Reply;
  ref?: Reply;
  compareExtra?: CompareFile[];
  // main's head at the merge; origin's main when unset.
  main?: Answer;
  close?: Reply;
}

function answer(value: Answer | undefined, head: string, fallback: Reply): Reply {
  if (value === undefined) return fallback;
  return typeof value === 'function' ? value(head) : value;
}

// main's head as origin has it, read inside the merge lock before the merge.
function mainRoute(method: string, url: string): Reply | undefined {
  if (method === 'GET' && url === `${GITHUB}/git/ref/heads/main`) return { status: 200, json: { object: { sha: originSha('refs/heads/main') } } };
  return undefined;
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
      const green = { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status: 'completed', conclusion: 'success' }] } };
      if (CHECK_RUNS.exec(url)?.[1] === initialSha) return over.baseGate ?? green;
      return over.gate ?? green;
    }
    const git = github(method, url);
    if (git) return git;
    const main = over.main ? answer(over.main, state.head, { status: 500 }) : mainRoute(method, url);
    if (method === 'GET' && url === `${GITHUB}/git/ref/heads/main` && main) return main;
    if (method === 'PATCH' && url === `${GITHUB}/pulls/5`) return over.close ?? { status: 200, json: { number: 5, state: 'closed' } };
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
  await writeFile(path.join(spec.worktree, 'platform', 'site', 'page.html'), '<title>Mob Machine</title>\n', 'utf8');
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
      `GET ${GITHUB}/actions/runs?head_sha=${state.head}&per_page=50`,
      `GET ${GITHUB}/git/ref/heads/main`,
      `GET ${GITHUB}/compare/${initialSha}...${state.head}`,
      `GET ${GITHUB}/git/trees/${initialSha}?recursive=1`,
      `GET ${GITHUB}/git/trees/${state.head}?recursive=1`,
      `PUT ${GITHUB}/pulls/5/merge`,
      `GET ${deploysUrl('site-platform')}`,
      `GET ${NETLIFY}/site-platform`,
      `GET ${SITE_URL}/`,
      `GET ${SITE_URL}/version.json`,
      `GET ${GITHUB}/actions/runs?head_sha=${MERGE_SHA}&per_page=50`,
    ]);
    expect(calls[6]?.body).toMatchObject({ sha: state.head, merge_method: 'squash', commit_title: 'card 4c2f5a1e: spawn table row gatherer: baseCost changes from 10 to 11' });
    expect(calls[0]?.body).toMatchObject({ head: 'card/4c2f5a1e-code', base: 'main' });
    expect(String(calls[0]?.body && (calls[0].body as { body: string }).body)).toContain(`Card-Id: ${c.id}`);

    const pushed = await git(['show', '--format=%an <%ae>%P%n%B', '--name-only', 'card/4c2f5a1e-code'], origin);
    expect(pushed).toContain(`Builder A (AI agent) <${AGENT_EMAIL}>${initialSha}`);
    expect(pushed).toContain('platform/site/page.html');
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
  ])('restores and reverts, then pauses the card rather than rejecting it, when %s after the merge', async (_name, over, detail, timings) => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [OLDER_GREEN];
    const { fetchFn, calls } = remote(over);
    const alert = new RecordingAlerter();
    await runCardPipeline(c, { ...deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert), timings: { ...FAST, ...timings } });

    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'post_merge_outage', commit_sha: MERGE_SHA });
    expect(db.events.find((event) => event.type === 'revert')).toMatchObject({
      payload: { failed_sha: MERGE_SHA, reason: `post-merge check failed: ${detail}`, restored_sha: 'older-sha', revert_sha: 'revert-sha' },
    });
    expect(db.events.at(-1)).toMatchObject({ type: 'message', payload: { step: 'infrastructure', check: 'post_merge_outage', stage: 'paused' } });
    expect(urls(calls)).toContain(`POST ${NETLIFY}/site-platform/deploys/dep-1/restore`);
    expect(urls(calls)).toContain(`PATCH ${GITHUB}/git/refs/heads/main`);
    expect(db.deploys.filter((row) => row.is_green)).toEqual([OLDER_GREEN]);
    expect(alert.messages).toEqual([
      `Card 4c2f5a1e was reverted on main (revert-): post-merge check failed: ${detail}`,
      `Card 4c2f5a1e stopped by infrastructure, not by its change (post_merge_outage): spawn table row gatherer: baseCost changes from 10 to 11. ${detail}. The change was rolled back as unverified; the card is paused with its money and is not rejected. It resumes on its own once nothing blocks it (at most 3 times a day and 8 in all, backing off from 15 minutes), or from /board sooner.`,
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
      'Card 4c2f5a1e failed after merge and the rollback is incomplete: no green platform deploy exists to restore; main was not moved to the revert commit revert-sha: http 422 Update is not a fast forward. Check main and the live site. The studio is paused until the board unpauses it.',
    );
    expect(db.studio.paused).toBe(true);
    expect(db.pausedBy).toBe('dispatcher: the revert of card 4c2f5a1e failed');
    expect(db.pauseReason).toBe('incident');
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
    const { fetchFn, calls } = remote({ gate: { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status:'completed', conclusion: 'failure' }] } } });
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

  it('sends a card back to funded when the merge is refused because main moved after the guard', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    let reads = 0;
    const { fetchFn } = remote({
      main: () => (++reads === 1 ? { status: 200, json: { object: { sha: originSha('refs/heads/main') } } } : { status: 200, json: { object: { sha: 'a-board-merge-0123456789' } } }),
      merge: { status: 405, json: { message: 'Base branch was modified. Review and try the merge again.' } },
    });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'main_moved', commit_sha: null });
    expect(db.events.at(-1)).toMatchObject({ type: 'message', payload: { step: 'requeue', reason: 'main_moved' } });
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

  // GitHub lagging behind a push is an infrastructure stop (docs/specs/money-safety.md): never a
  // rejection. With no stored patch to re-gate (attended mode), the card pauses with its money.
  it('waits for an existing pull request to show the pushed sha, then pauses on pr_head, unrejected, without gating on the stale head', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote({
      created: { status: 422, json: { message: 'A pull request already exists for owner:card/4c2f5a1e-code.' } },
      existing: { status: 200, json: [{ number: 5, head: { sha: 'stale-sha' } }] },
      pull: { status: 200, json: { number: 5, head: { sha: 'stale-sha' }, merged: false } },
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, { ...deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert), infraStops: new Map() });
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'pr_head', commit_sha: null });
    expect(db.events.at(-1)).toMatchObject({ type: 'message', payload: { step: 'infrastructure', check: 'pr_head', stops: 1, stage: 'paused' } });
    expect(alert.messages).toEqual([expect.stringMatching(/^Card 4c2f5a1e stopped by infrastructure, not by its change \(pr_head\): .*did not show the pushed sha/)]);
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

  // GitHub answers a merge that took too long with a 5xx while the merge goes ahead, so a 5xx is as
  // unknown as a timeout: main has then moved because of this very merge, and the card must not be
  // sent back to funded (or rejected) with its change already on main and never verified.
  it.each([500, 502, 503, 504])('continues with the merge commit when the merge request answers %i but the pull request merged', async (status) => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    let reads = 0;
    const { fetchFn } = remote({
      main: () => ({ status: 200, json: { object: { sha: ++reads === 1 ? originSha('refs/heads/main') : MERGE_SHA } } }),
      merge: { status, json: { message: 'Server Error' } },
      pull: (head) => ({ status: 200, json: { number: 5, head: { sha: head }, merged: true, merge_commit_sha: MERGE_SHA } }),
    });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA });
  });

  it('leaves the card gated with a merge_unknown marker when the merge request answers 502 and the pull request does not show merged', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, state } = remote({ merge: { status: 502, json: { message: 'Server Error' } } });
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'gated', failing_check: 'merge_unknown', commit_sha: null });
    expect(db.events.at(-1)).toMatchObject({ type: 'error', payload: { step: 'merge_unknown', pr: 5, sha: state.head } });
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
      gate: { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status:'in_progress', conclusion: null }] } },
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
    expect(noSha.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'dispatcher_stopped', commit_sha: null });
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
      if (method === 'GET' && CHECK_RUNS.test(url)) return { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status:'completed', conclusion: 'success' }] } };
      const git = github(method, url) ?? mainRoute(method, url);
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
    expect(gets).toContain(`${GITHUB}/actions/runs?head_sha=${state.merged}&per_page=50`);
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
      await symlink('../../.github', path.join(spec.worktree, 'seed-1', 'content', 'gh.json'));
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

  // A database error before any session is not the card's failure (docs/specs/money-safety.md): the
  // card goes back to funded, and pauses at the third such stop in a row. It is never rejected.
  it('puts the card back in funded, unrejected, with a role-less event when the role cannot be read, and pauses it at the third stop', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    db.roles = [];
    const adapter = new FakeAdapter(async () => undefined);
    const infraStops = new Map<string, number>();
    const alert = new RecordingAlerter();
    await runCardPipeline(c, { ...deps(db, adapter, remote().fetchFn, undefined, alert), infraStops });
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'dispatcher_error', branch: null });
    expect(db.events).toEqual([
      {
        card_id: c.id,
        role_id: null,
        type: 'message',
        payload: { step: 'infrastructure', check: 'dispatcher_error', detail: 'db role: no row for role-builder-a', stops: 1, stage: 'funded' },
      },
    ]);
    expect(alert.messages[0]).toMatch(/It stopped before any session ran, so it is back in funded to be claimed again \(stop 1; it pauses at 3 in a row\)\.$/);
    for (const expected of ['funded', 'paused']) {
      db.cards = [{ ...db.cards[0]!, stage: 'building' }];
      await runCardPipeline(c, { ...deps(db, adapter, remote().fetchFn, undefined, alert), infraStops });
      expect(db.cards[0]).toMatchObject({ stage: expected, failing_check: 'dispatcher_error' });
    }
    expect(alert.messages.at(-1)).toMatch(/It stopped this way 3 times in a row, so it is paused with its money\. It resumes on its own once nothing blocks it/);
    expect(adapter.specs).toEqual([]);
  });

  // Runs fn when the gate's workflow runs are first read, as a board action would land during the wait.
  function duringGate(fetchFn: typeof fetch, fn: () => void): typeof fetch {
    let done = false;
    return (async (input: string | URL | Request, init?: RequestInit) => {
      if (!done && CHECK_RUNS.test(String(input))) {
        done = true;
        fn();
      }
      return fetchFn(input, init);
    }) as typeof fetch;
  }

  it('pauses the card, unmerged, when the board pauses the studio during the gate wait', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), duringGate(fetchFn, () => (db.studio.paused = true)), undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'paused_by_board', commit_sha: null });
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
    expect(db.deploys).toEqual([]);
    expect(alert.messages).toEqual([
      'Card 4c2f5a1e paused (paused_by_board): spawn table row gatherer: baseCost changes from 10 to 11. the board paused the studio while the card was in the gate; it was not merged. It resumes on its own once nothing blocks it (at most 3 times a day and 8 in all, backing off from 15 minutes), or from /board sooner.',
    ]);
  });

  it.each([
    ['moved off horizon now', { horizon: 'next' }, 'horizon', 'the board moved the card to horizon next while it was in the gate; it was not merged'],
    ['vetoed', { director_stance: 'vetoed' }, 'vetoed', 'the card was vetoed while it was in the gate; it was not merged'],
  ])('pauses a card %s during the gate wait without merging it', async (_name, change, check, detail) => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), duringGate(fetchFn, () => Object.assign(db.cards[0]!, change))));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: check });
    expect(db.events.at(-1)).toMatchObject({ type: 'gate_pass' });
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
    expect(detail).toContain('it was not merged');
  });

  it('leaves a card the board moved during the gate wait as the board set it, unmerged, and closes its pull request', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), duringGate(fetchFn, () => (db.cards[0]!.stage = 'rejected')), undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: null, commit_sha: null });
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
    expect(calls.find((call) => call.method === 'PATCH' && call.url === `${GITHUB}/pulls/5`)?.body).toEqual({ state: 'closed' });
    expect(alert.messages).toEqual([
      'Card 4c2f5a1e: the card moved to rejected while it was in the gate; it was not merged and its stage is left as the board set it. Pull request #5 was closed. spawn table row gatherer: baseCost changes from 10 to 11',
    ]);
  });

  it('never overwrites a stage the board set during the session', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    const adapter = new FakeAdapter(async (spec, emit) => {
      await editSite(spec, emit, new AbortController().signal);
      db.cards[0]!.stage = 'rejected';
    });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, adapter, fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: null });
    expect(urls(calls).some((call) => CHECK_RUNS.test(call.slice(4)) || call.startsWith('PUT'))).toBe(false);
    expect(alert.messages).toEqual([
      'Card 4c2f5a1e: the card is rejected, not building, so it was not moved to gated; the dispatcher left it as it is. Pull request #5 was closed. spawn table row gatherer: baseCost changes from 10 to 11',
    ]);
  });

  it('sends a card back to funded, unmerged, when main moved while it was in the gate', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote({ main: { status: 200, json: { object: { sha: 'a-board-merge-0123456789' } } } });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'main_moved', commit_sha: null });
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
    expect(db.events.at(-1)).toMatchObject({ type: 'message', payload: { step: 'requeue', reason: 'main_moved' } });
    expect(String(db.events.at(-1)?.payload.detail)).toMatch(/^main moved from [0-9a-f]{8} to a-board- while the card was in the gate/);
    expect(alert.messages).toEqual([]);
  });

  it('restores the previous green deploy when the deploy does not finish in time, since it may still publish', async () => {
    const c = platformCard();
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [OLDER_GREEN];
    const building = { id: 'dep-2', state: 'building', commit_ref: MERGE_SHA, context: 'production' };
    const { fetchFn, calls } = remote({ deploys: { status: 200, json: [building] } });
    await runCardPipeline(c, { ...deps(db, new FakeAdapter(editSite), fetchFn), timings: { ...FAST, deployTimeoutMs: 30 } });
    // Netlify not finishing is not the card's failure: rolled back, then paused rather than rejected.
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'deploy_timeout' });
    expect(urls(calls)).toContain(`POST ${NETLIFY}/site-platform/deploys/dep-1/restore`);
    expect(db.events.find((event) => event.type === 'revert')).toMatchObject({ payload: { reason: 'deploy did not finish: deploy dep-2 still building after 0.03 s', restored_sha: 'older-sha', revert_sha: 'revert-sha' } });
  });

  it('pauses the studio and the card, keeping its money, when the API says the Console credit ran out, and nothing more is claimed', async () => {
    const c = card();
    db.studio.agent_mode = 'unattended';
    db.cards = [{ ...c, stage: 'building' }, card({ id: 'aaaaaaaa-0000-4000-8000-00000000000b', priority: 200 })];
    const adapter = new FakeAdapter(
      async (_spec, emit, signal) => {
        await emit(startEvent(undefined, 'ANTHROPIC_API_KEY'));
        await emit({ type: 'message', text: 'Credit balance is too low' });
        await emit({ type: 'turn_usage', turn: 1, model: '<synthetic>', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, contentChars: 25, thinking: false });
        await untilAborted(signal, 200);
      },
      { mode: 'unattended' },
    );
    const alert = new RecordingAlerter();
    const { fetchFn, calls } = remote();
    await runCardPipeline(c, deps(db, adapter, fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'console_credit', actual_usd: 0 });
    expect(db.studio.paused).toBe(true);
    expect(db.pausedBy).toBe('dispatcher: Console credit needed (card 4c2f5a1e)');
    expect(db.pauseReason).toBe('awaiting_credit');
    expect(db.ledger).toEqual([]);
    expect(calls).toEqual([]);
    expect(alert.messages).toEqual([
      'Console credit needed: card 4c2f5a1e stopped because the API refused the studio key for credit or its spend limit. The studio is paused. Buy credit or raise the Console limit, record the purchase on /board. The dispatcher tries the studio key with a one-token call 15 minutes after the pause, then backing off to every 4 hours, and unpauses the studio on its own once the call goes through. The card is paused, keeps its money and resumes on its own after the studio does.',
      'Card 4c2f5a1e paused (console_credit): spawn table row gatherer: baseCost changes from 10 to 11. the API refused the studio key for credit: Credit balance is too low. It resumes on its own once nothing blocks it (at most 3 times a day and 8 in all, backing off from 15 minutes), or from /board sooner.',
    ]);
    const outcome = await tick({
      db,
      mode: 'unattended',
      boardSessionTtlMin: 3,
      maxConcurrency: 1,
      running: new Map(),
      budgets: new SessionBudgets(),
      leaseHolder: 'dispatcher-a',
      leaseTtlSeconds: 300,
      stuckAfterMs: 60 * 60_000,
      now: () => NOW,
      runCard: async () => undefined,
      log: silent,
      alert,
    });
    expect(outcome).toEqual({ action: 'sleep', reason: 'paused' });
    expect(db.claims).toBe(0);
  });

  it("pauses the studio and the card, keeping its money, when the API says the usage tier's monthly cap is reached", async () => {
    const c = card();
    db.studio.agent_mode = 'unattended';
    db.cards = [{ ...c, stage: 'building' }];
    const tierError =
      'the Managed Agents session could not be created: 429 {"type":"error","error":{"type":"rate_limit_error","message":"You have reached your API usage limits: your organization has crossed its monthly API usage threshold."},"error_code":"enforced_spend_limit_reached"}';
    const adapter = new FakeAdapter(
      async (_spec, emit, signal) => {
        await emit(startEvent(undefined, 'ANTHROPIC_API_KEY'));
        await emit({ type: 'error', message: tierError });
        await untilAborted(signal, 200);
      },
      { mode: 'unattended' },
    );
    const alert = new RecordingAlerter();
    const { fetchFn, calls } = remote();
    await runCardPipeline(c, deps(db, adapter, fetchFn, undefined, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'usage_tier_cap', actual_usd: 0 });
    expect(db.studio.paused).toBe(true);
    expect(db.pausedBy).toBe('dispatcher: usage tier cap reached (card 4c2f5a1e)');
    expect(db.pauseReason).toBe('spend_limit');
    expect(db.ledger).toEqual([]);
    expect(calls).toEqual([]);
    expect(alert.messages[0]).toBe(
      "Usage tier cap reached: card 4c2f5a1e stopped because the API says the studio organisation has reached the monthly usage limit of its Anthropic tier. The studio is paused. Buying credit does not clear it: the limit resets when the month turns, or sooner if Anthropic raises the tier (Console, Limits). Report the tier's monthly limit so the dispatcher stops below it. The dispatcher tries the studio key with a one-token call every hour and unpauses the studio on its own once the call goes through. The card is paused, keeps its money and resumes on its own after the studio does.",
    );
    expect(alert.messages[1]).toMatch(/^Card 4c2f5a1e paused \(usage_tier_cap\): /);
    expect(alert.messages).toHaveLength(2);
  });

  it('sends the card back to funded with no rejection when its executor role is paused, and it runs again once the role is resumed, with no card action', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    const alert = new RecordingAlerter();
    const adapter = new FakeAdapter(async (_spec, emit, signal) => {
      await emit(startEvent());
      db.roles[0]!.paused = true;
      await untilAborted(signal, 2000);
    });
    await runCardPipeline(c, { ...deps(db, adapter, remote().fetchFn, undefined, alert), config: { ...config, tickMs: 5 } });
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'role_paused' });
    expect(db.events.find((e) => e.payload.step === 'requeue')?.payload).toMatchObject({ reason: 'role_paused' });
    expect(alert.messages).toEqual([]);
    const tickDeps = {
      db,
      mode: 'attended' as const,
      boardSessionTtlMin: 3,
      maxConcurrency: 1,
      running: new Map<string, Date>(),
      budgets: new SessionBudgets(),
      leaseHolder: 'dispatcher-a',
      leaseTtlSeconds: 300,
      stuckAfterMs: 60 * 60_000,
      now: () => NOW,
      runCard: async () => undefined,
      log: silent,
      alert,
    };
    expect(await tick(tickDeps)).toEqual({ action: 'sleep', reason: 'no_eligible_card' });
    db.roles[0]!.paused = false;
    expect(await tick(tickDeps)).toEqual({ action: 'started', cardId: c.id });
  });

  it('gives the session the budget the tick set, and sends the card back to funded when that budget is gone', async () => {
    const c = card();
    db.cards = [{ ...c, stage: 'building' }];
    const budgets = new SessionBudgets();
    budgets.start(c.id, 0);
    const adapter = new FakeAdapter(async () => undefined, { mode: 'unattended' });
    const alert = new RecordingAlerter();
    await runCardPipeline(c, { ...deps(db, adapter, remote().fetchFn, undefined, alert), budgets });
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'insufficient_balance' });
    expect(adapter.specs).toEqual([]);
    expect(alert.messages).toEqual([]);

    db.cards = [{ ...c, stage: 'building' }];
    budgets.start(c.id, 1.25);
    const spent = new FakeAdapter(async (spec, emit) => {
      await emit(startEvent(undefined, 'ANTHROPIC_API_KEY'));
      await editSpawnTable(spec.worktree, 11);
      await emit(usageEvent(1, 100));
    }, { mode: 'unattended', subtype: 'error_max_budget_usd', isError: true, exitCode: 1 });
    await runCardPipeline(c, { ...deps(db, spent, remote().fetchFn, undefined, alert), budgets });
    expect(spent.specs[0]?.maxBudgetUsd).toBe(1.25);
    // The session told the budgets its running estimate, so what it may still spend fell.
    expect(budgets.remaining().get(c.id)).toBeLessThan(1.25);
    expect(budgets.remaining().get(c.id)).toBeGreaterThan(1.2);
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'budget' });
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
    const { fetchFn } = remote({ gate: { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status:'completed', conclusion: 'failure' }] } } });
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
      return { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status: 'completed', conclusion }] } };
    }
    const git = github(method, url) ?? mainRoute(method, url);
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
  const file = path.join(repo, 'platform', 'site', 'page.html');
  const original = readFileSync(file, 'utf8');
  execFileSync('git', ['checkout', '-q', initialSha, '--', 'platform/site/page.html'], { cwd: repo, stdio: 'pipe' });
  const before = readFileSync(file, 'utf8');
  execFileSync('bash', ['-c', `printf '%s\n' "$1" > "$2"`, 'x', title, file]);
  const patch = execFileSync('git', ['diff', '--no-renames', '--full-index', initialSha, '--', 'platform/site/page.html'], { cwd: repo, stdio: 'pipe' }).toString();
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
    expect(db.events.find((event) => event.payload.step === 'patch_reused')).toMatchObject({ type: 'message', payload: { base_sha: initialSha, files: ['platform/site/page.html'] } });
    const pushed = await git(['show', 'card/eeeeeeee-code:platform/site/page.html'], origin);
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

// docs/specs/money-safety.md: an infrastructure failure never rejects a paid card. Before the merge it
// goes back to funded on its stored patch and is re-gated with no session; without a stored patch, or
// at the limit of stops in a row, it pauses. A card whose own change fails is still rejected.
describe('a paid card and an infrastructure failure', () => {
  const RUN = (status: string, conclusion: string | null) => ({ status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status, conclusion }] } });
  const SLOW: Partial<PipelineTimings> = { ...FAST, gateTimeoutMs: 20, gateIntervalMs: 5 };

  async function withPatch(id: string) {
    const db = new FakeDb();
    const c = platformCard({ id });
    db.cards = [{ ...c, stage: 'building' }];
    db.deploys = [OLDER_GREEN];
    const patches = new MemoryPatchStore();
    await patches.save(storedPatch(c.id, initialSha, Buffer.from(storedSitePatch('<title>Studio</title>')), 'Name the page Studio', 'sesn_earlier'));
    let sessions = 0;
    const adapter = new FakeAdapter(async () => {
      sessions += 1;
    });
    return { db, c, patches, adapter, sessions: () => sessions };
  }

  it.each<[string, Remote, string]>([
    ['no gate run ever starts', { gate: { status: 200, json: { workflow_runs: [] } } }, 'gate_missing'],
    ['the gate is still running at the deadline', { gate: RUN('in_progress', null) }, 'gate_pending'],
    ['the gate run was cancelled', { gate: RUN('completed', 'cancelled') }, 'gate_infrastructure'],
    ['the gate run failed to start', { gate: RUN('completed', 'startup_failure') }, 'gate_infrastructure'],
    ['main was already red at the card\'s base', { gate: RUN('completed', 'failure'), baseGate: RUN('completed', 'failure') }, 'main_red'],
    [
      'the pull request never shows the pushed sha',
      {
        created: { status: 422, json: { message: 'A pull request already exists for owner:card/eeeeeeee-code.' } },
        existing: { status: 200, json: [{ number: 5, head: { sha: 'stale-sha' } }] },
        pull: { status: 200, json: { number: 5, head: { sha: 'stale-sha' }, merged: false } },
      },
      'pr_head',
    ],
  ])('re-queues the card on its stored patch, unmerged and unrejected, when %s', async (_name, over, check) => {
    const { db, c, patches, adapter, sessions } = await withPatch('eeeeeeee-0000-4000-8000-000000000011');
    const infraStops = new Map<string, number>();
    const alert = new RecordingAlerter();
    const { fetchFn, calls } = remote(over);
    await runCardPipeline(c, { ...deps(db, adapter, fetchFn, undefined, alert), timings: SLOW, patches, infraStops });
    expect(sessions()).toBe(0);
    expect(db.ledger).toEqual([]);
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: check, commit_sha: null });
    expect(patches.rows).toHaveLength(1);
    expect(db.events.map((e) => e.type)).not.toContain('gate_fail');
    expect(db.events.at(-1)).toMatchObject({ type: 'message', payload: { step: 'infrastructure', check, stops: 1, stage: 'funded' } });
    expect(urls(calls).some((call) => call.startsWith('PUT') || call.includes('/git/commits') || call.includes('/rerun'))).toBe(false);
    expect(alert.messages).toEqual([expect.stringMatching(new RegExp(`^Card eeeeeeee stopped by infrastructure, not by its change \\(${check}\\): .* It is back in funded and is re-gated from its stored patch with no new session \\(stop 1; it pauses at 3 in a row\\)\\.$`))]);
    expect(infraStops.get(c.id)).toBe(1);
  });

  it('re-queues on a GitHub outage before the merge, and pauses at the third stop in a row', async () => {
    const { db, c, patches, adapter } = await withPatch('eeeeeeee-0000-4000-8000-000000000012');
    const infraStops = new Map<string, number>();
    const alert = new RecordingAlerter();
    const { fetchFn } = remote({ created: { status: 502, json: { message: 'Bad Gateway' } } });
    for (const expected of ['funded', 'funded', 'paused']) {
      db.cards = [{ ...db.cards[0]!, stage: 'building' }];
      await runCardPipeline(c, { ...deps(db, adapter, fetchFn, undefined, alert), timings: SLOW, patches, infraStops });
      expect(db.cards[0]).toMatchObject({ stage: expected, failing_check: 'outage' });
    }
    expect(alert.messages.at(-1)).toMatch(/It stopped this way 3 times in a row, so it is paused with its money and its stored patch/);
    expect(patches.rows).toHaveLength(1);
  });

  it('puts a card back in funded, with no session and nothing pushed, when the fetch of main fails before any work', async () => {
    const db = new FakeDb();
    const c = platformCard({ id: 'eeeeeeee-0000-4000-8000-000000000016' });
    db.cards = [{ ...c, stage: 'building' }];
    let sessions = 0;
    const adapter = new FakeAdapter(async () => {
      sessions += 1;
    });
    setGitRunner((call) => {
      if (call.args.includes('fetch')) return Promise.reject(new Error('fatal: unable to access https://github.com/owner/repo.git/: Could not resolve host: github.com'));
      return defaultGitRunner(call);
    });
    const alert = new RecordingAlerter();
    const { fetchFn, calls } = remote();
    await runCardPipeline(c, { ...deps(db, adapter, fetchFn, undefined, alert), patches: new MemoryPatchStore(), infraStops: new Map() });
    setGitRunner(null);
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'dispatcher_error', commit_sha: null });
    expect(sessions).toBe(0);
    expect(db.ledger).toEqual([]);
    expect(calls).toEqual([]);
    expect(db.events.at(-1)).toMatchObject({ type: 'message', payload: { step: 'infrastructure', check: 'dispatcher_error', stops: 1, stage: 'funded' } });
    expect(alert.messages).toEqual([expect.stringMatching(/Could not resolve host: github\.com\. It stopped before any session ran, so it is back in funded to be claimed again \(stop 1; it pauses at 3 in a row\)\.$/)]);
  });

  it('re-queues on a database error after the gate passes, instead of rejecting the card', async () => {
    class FlakyDb extends FakeDb {
      override async insertEvent(cardId: string, roleId: string | null, type: Parameters<FakeDb['insertEvent']>[2], payload: Record<string, unknown>) {
        if (type === 'gate_pass') throw new Error('db event: TypeError: fetch failed');
        return super.insertEvent(cardId, roleId, type, payload);
      }
    }
    const { c, patches, adapter, sessions } = await withPatch('eeeeeeee-0000-4000-8000-000000000017');
    const db = new FlakyDb();
    db.cards = [{ ...c, stage: 'building' }];
    const { fetchFn, calls } = remote();
    await runCardPipeline(c, { ...deps(db, adapter, fetchFn), timings: SLOW, patches, infraStops: new Map() });
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'dispatcher_error', commit_sha: null });
    expect(sessions()).toBe(0);
    expect(patches.rows).toHaveLength(1);
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
  });

  it('clears the count of stops once the gate passes, and ships from the stored patch', async () => {
    const { db, c, patches, adapter, sessions } = await withPatch('eeeeeeee-0000-4000-8000-000000000013');
    const infraStops = new Map<string, number>([['eeeeeeee-0000-4000-8000-000000000013', 2]]);
    const { fetchFn } = remote();
    await runCardPipeline(c, { ...deps(db, adapter, fetchFn), patches, infraStops });
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA });
    expect(sessions()).toBe(0);
    expect(infraStops.has(c.id)).toBe(false);
  });

  it('pauses rather than re-queueing a card with no stored patch, so no new session starts', async () => {
    const db = new FakeDb();
    const c = platformCard({ id: 'eeeeeeee-0000-4000-8000-000000000014' });
    db.cards = [{ ...c, stage: 'building' }];
    const alert = new RecordingAlerter();
    const { fetchFn } = remote({ gate: RUN('completed', 'startup_failure') });
    await runCardPipeline(c, { ...deps(db, new FakeAdapter(editSite), fetchFn, undefined, alert), timings: SLOW, patches: new MemoryPatchStore(), infraStops: new Map() });
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'gate_infrastructure' });
    expect(alert.messages[0]).toMatch(/It has no stored patch to re-gate, so it is paused with its money rather than starting a new session/);
  });

  it("still rejects a card whose own change fails the gate on a green base", async () => {
    const { db, c, patches, adapter } = await withPatch('eeeeeeee-0000-4000-8000-000000000015');
    const { fetchFn, calls } = remote({ gate: RUN('completed', 'failure') });
    await runCardPipeline(c, { ...deps(db, adapter, fetchFn), timings: SLOW, patches, infraStops: new Map() });
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'gate' });
    expect(db.events.at(-1)).toMatchObject({ type: 'gate_fail', payload: { detail: 'gate concluded failure' } });
    expect(urls(calls).filter((call) => CHECK_RUNS.exec(call.slice(4))?.[1] === initialSha)).toHaveLength(1);
  });

  it('still rolls back and rejects a card whose gate fails at the merge sha, and pauses one whose gate there was cancelled', async () => {
    for (const [mergeGate, stage, check] of [
      ['failure', 'rejected', 'smoke'],
      ['cancelled', 'paused', 'post_merge_outage'],
    ] as const) {
      // The seed remote merges for real and its revert is mocked, so each case starts from the initial commit.
      await git(['update-ref', 'refs/heads/main', initialSha], origin);
      const db = new FakeDb();
      const c = card();
      db.cards = [{ ...c, stage: 'building' }];
      db.deploys = [{ ...OLDER_GREEN, folder: 'seed-1' }];
      const adapter = new FakeAdapter(async (spec, emit) => {
        await emit(startEvent());
        await editSpawnTable(spec.worktree, 11);
        await emit(usageEvent(1, 10));
      });
      const { fetchFn, calls } = seedRemote({ mergeGate });
      await runCardPipeline(c, { ...deps(db, adapter, fetchFn), infraStops: new Map() });
      expect(db.cards[0]).toMatchObject({ stage, failing_check: check });
      expect(urls(calls)).toContain(`PATCH ${GITHUB}/git/refs/heads/main`);
    }
  });
});


// The Directors' visual review (docs/specs/design-review.md), with fake GitHub (a gate run with an id,
// its design-frames artifact and the storage download) and fake adapters for the builder and the
// Platform Director.
describe('the visual review', () => {
  const READ_SET = ['Read', 'Glob', 'Grep'];
  const director = role({ id: 'role-platform-director', name: 'Platform Director', title: 'Platform Director', model: 'builder-class', prompt_path: 'platform/agents/prompts/platform-director.md', tools_json: READ_SET, write_access: false, agent_class: 'reviewer' });
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
  const FRAMES_ZIP = zipSync({ 'site/changed.txt': strToU8('home-375.png\n'), 'site/home-375.before.png': PNG, 'site/home-375.after.png': PNG });
  const NOTHING_CHANGED = zipSync({ 'site/changed.txt': strToU8('') });
  const STORAGE = 'https://storage.example/frames.zip';
  const typed = new TypedOutput();

  const pass = { verdict: 'pass' as const, frame: 'site/home-375.png', reason_code: 'meets' };
  const verdict = (over: Partial<VisualVerdict['criteria']> = {}): VisualVerdict => ({ criteria: { intent: pass, fit: pass, legibility: pass, all_ages: pass, ...over } });
  const LEGIBILITY = { legibility: { verdict: 'revise' as const, frame: 'site/home-375.png', reason_code: 'dead_space' } };
  const ALL_AGES = { all_ages: { verdict: 'revise' as const, frame: 'site/home-375.png', reason_code: 'rating_concern' } };

  // The remote with a gate run that has an id, and the artifact routes; artifact null uploads none.
  function visualRemote(artifact: Uint8Array | null = FRAMES_ZIP, over: Remote = {}) {
    const green = { status: 200, json: { workflow_runs: [{ id: 77, path: '.github/workflows/gate.yml', status: 'completed', conclusion: 'success' }] } };
    const base = remote({ gate: green, ...over });
    const frameCalls: string[] = [];
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === `${GITHUB}/actions/runs/77/artifacts?per_page=100`) {
        frameCalls.push('artifacts');
        const artifacts = artifact ? [{ id: 9, name: 'design-frames', expired: false, size_in_bytes: artifact.byteLength }] : [];
        return new Response(JSON.stringify({ artifacts }), { status: 200 });
      }
      if (url === `${GITHUB}/actions/artifacts/9/zip`) return new Response(null, { status: 302, headers: { location: STORAGE } });
      if (url === STORAGE) {
        frameCalls.push('download');
        return new Response(artifact, { status: 200 });
      }
      return base.fetchFn(input, init);
    }) as typeof fetch;
    return { ...base, fetchFn, frameCalls };
  }

  // The builder writes a new title each session, so a revision is a real change on the card's commit.
  function builder() {
    let session = 0;
    const prompts: string[] = [];
    const adapter = new FakeAdapter(async (spec, emit) => {
      session += 1;
      prompts.push(spec.prompt);
      await emit(startEvent());
      await writeFile(path.join(spec.worktree, 'platform', 'site', 'page.html'), `<title>Mob Machine ${session}</title>\n`, 'utf8');
      await emit(usageEvent(1, 100));
    });
    return { adapter, prompts, sessions: () => session };
  }

  // The Director answers each review in turn; its session ids are review-1, review-2 and so on.
  function reviewer(answers: string[], sessionId?: (n: number) => string) {
    let n = 0;
    const adapter = new FakeAdapter(
      async (_spec, emit) => {
        n += 1;
        await emit({ type: 'start', sessionId: sessionId ? sessionId(n) : `review-${n}`, model: 'builder-class', tools: READ_SET, apiKeySource: 'none' });
        await emit(usageEvent(1, 50));
      },
      { result: () => answers[Math.min(n, answers.length) - 1] ?? '' },
    );
    return { adapter, reviews: () => n };
  }

  function visualDeps(db: FakeDb, build: FakeAdapter, review: FakeAdapter, fetchFn: typeof fetch, alert = new RecordingAlerter()): PipelineDeps {
    const stop = new AbortController();
    const base = deps(db, build, fetchFn, stop, alert);
    return {
      ...base,
      visual: {
        framesRoot: path.join(dir, 'frames'),
        review: {
          db,
          session: { adapter: review, typed, priceTable: PRICE_TABLE, maxTurns: 20, maxMs: 60_000, boardSessionTtlMin: 3, watchIntervalMs: 5, log: silent, stopSignal: stop.signal, now: () => NOW, ledgerRetryMs: 1 },
          rubric: async () => 'THE RUBRIC',
          promptRoot: repo,
          budgetUsd: 5,
          waitIntervalMs: 5,
        },
      },
    };
  }

  function setupDb(overrides: Parameters<typeof card>[0] = {}) {
    const db = new FakeDb();
    db.roles = [role(), director];
    const c = platformCard({ id: '5a5a5a5a-0000-4000-8000-000000000001', ...overrides });
    db.cards = [{ ...c, stage: 'building' }];
    return { db, c };
  }

  const branchCommit = async () => git(['log', '--format=%P %s', '-1', 'card/5a5a5a5a-code'], origin);
  const branchTitle = async () => git(['show', 'card/5a5a5a5a-code:platform/site/page.html'], origin);

  it('merges a gate run with no design-frames, and one whose frames all match the base, with no review', async () => {
    for (const artifact of [null, NOTHING_CHANGED]) {
      await git(['update-ref', 'refs/heads/main', initialSha], origin);
      const { db, c } = setupDb();
      const { fetchFn } = visualRemote(artifact);
      const review = reviewer([JSON.stringify(verdict())]);
      await runCardPipeline(c, visualDeps(db, builder().adapter, review.adapter, fetchFn));
      expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA, review_rounds: 0 });
      expect(review.reviews()).toBe(0);
      expect(db.approvals).toEqual([]);
    }
  });

  it('records a visual approval, the builder as maker and the review as grader, and merges when all pass', async () => {
    const { db, c } = setupDb();
    const { fetchFn, frameCalls, calls } = visualRemote();
    const review = reviewer([JSON.stringify(verdict())]);
    await runCardPipeline(c, visualDeps(db, builder().adapter, review.adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA, review_rounds: 0 });
    expect(frameCalls).toEqual(['artifacts', 'download']);
    expect(db.approvals).toEqual([
      {
        kind: 'visual',
        cardId: c.id,
        approverRoleId: director.id,
        makerRoleId: 'role-builder-a',
        makerRef: 'claude:session-1',
        graderRef: 'claude:review-1',
        verdict: { ...verdict(), decision: 'merge', review: 1, sha: expect.stringMatching(/^[0-9a-f]{40}$/) },
      },
    ]);
    // The review's model calls are the founder's, with the Director's role, never the card's.
    expect(db.ledger.filter((row) => row.role_id === director.id)).toEqual([expect.objectContaining({ billed_to: 'founder', card_id: null })]);
    expect(db.events.find((e) => e.payload.step === 'visual_review')).toMatchObject({ role_id: director.id, payload: { decision: 'merge', review: 1, rounds_used: 0 } });
    // The approval is written before the merge request.
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(true);
    expect(review.adapter.specs[0]?.roleTools).toEqual(READ_SET);
  });

  it('revises once with only the typed feedback, squashes the revision into one commit on the base, gates it again and merges', async () => {
    const { db, c } = setupDb();
    const { fetchFn } = visualRemote();
    const build = builder();
    const review = reviewer([JSON.stringify(verdict(LEGIBILITY)), JSON.stringify(verdict())]);
    await runCardPipeline(c, visualDeps(db, build.adapter, review.adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA, review_rounds: 1 });
    expect([build.sessions(), review.reviews()]).toEqual([2, 2]);
    const addendum = build.prompts[1]!.slice(build.prompts[0]!.length);
    expect(addendum.trim().split('\n')).toEqual([expect.stringContaining('revision 1 of 2'), '- legibility: dead_space (frame site/home-375.png)']);
    expect(build.prompts[0]).not.toContain('Visual review');
    // One commit on the base, holding the revision.
    expect(await branchCommit()).toBe(`${initialSha} card 4c2f5a1e: spawn table row gatherer: baseCost changes from 10 to 11`.replace('4c2f5a1e', '5a5a5a5a'));
    expect(await branchTitle()).toBe('<title>Mob Machine 2</title>');
    expect(db.events.filter((e) => e.type === 'gate_pass')).toHaveLength(2);
    expect(db.approvals).toHaveLength(1);
    expect(db.approvals[0]).toMatchObject({ graderRef: 'claude:review-2', makerRef: 'claude:session-1', verdict: { decision: 'merge', review: 2 } });
  });

  it('merges an open legibility criterion after two revise rounds, with its final verdict recorded', async () => {
    const { db, c } = setupDb();
    const { fetchFn } = visualRemote();
    const build = builder();
    const review = reviewer([JSON.stringify(verdict(LEGIBILITY))]);
    await runCardPipeline(c, visualDeps(db, build.adapter, review.adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'live', commit_sha: MERGE_SHA, review_rounds: 2 });
    expect([build.sessions(), review.reviews()]).toEqual([3, 3]);
    expect(db.approvals).toEqual([expect.objectContaining({ graderRef: 'claude:review-3', verdict: expect.objectContaining({ ...verdict(LEGIBILITY), decision: 'merge_open', review: 3 }) })]);
  });

  it('rejects the card through the gate-rejection path when all ages is still open after two rounds', async () => {
    const { db, c } = setupDb();
    const { fetchFn, calls } = visualRemote();
    const alert = new RecordingAlerter();
    const review = reviewer([JSON.stringify(verdict(ALL_AGES))]);
    await runCardPipeline(c, visualDeps(db, builder().adapter, review.adapter, fetchFn, alert));
    expect(db.cards[0]).toMatchObject({ stage: 'rejected', failing_check: 'visual_review:all_ages', review_rounds: 2 });
    expect(review.reviews()).toBe(3);
    expect(db.approvals).toEqual([]);
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
    expect(alert.messages.at(-1)).toMatch(/rejected \(visual_review:all_ages\)/);
  });

  it('reads the rounds used from the card after a restart, so a card at the cap is not revised again', async () => {
    const { db, c } = setupDb();
    db.cards[0]!.review_rounds = 2;
    const { fetchFn } = visualRemote();
    const build = builder();
    const review = reviewer([JSON.stringify(verdict(LEGIBILITY))]);
    // The claim read the card before the restart's count; the pipeline reads it again.
    await runCardPipeline({ ...c, review_rounds: 0 }, visualDeps(db, build.adapter, review.adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'live', review_rounds: 2 });
    expect([build.sessions(), review.reviews()]).toEqual([1, 1]);
    expect(db.approvals[0]).toMatchObject({ verdict: { decision: 'merge_open' } });
  });

  it('records nothing and does not merge when the final message is not one valid verdict', async () => {
    const { db, c } = setupDb();
    const { fetchFn, calls } = visualRemote();
    const review = reviewer(['The frames look fine to me.']);
    await runCardPipeline(c, visualDeps(db, builder().adapter, review.adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'visual_review', review_rounds: 0 });
    expect(db.approvals).toEqual([]);
    expect(db.events.some((e) => e.payload.step === 'visual_review')).toBe(false);
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
  });

  it('refuses the approval when the review session is the builder session, and does not merge', async () => {
    const { db, c } = setupDb();
    const { fetchFn, calls } = visualRemote();
    const review = reviewer([JSON.stringify(verdict())], () => 'session-1');
    await runCardPipeline(c, visualDeps(db, builder().adapter, review.adapter, fetchFn));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'visual_review' });
    expect(db.approvals).toEqual([]);
    expect(urls(calls).some((call) => call.startsWith('PUT'))).toBe(false);
    // Postgres refuses it too.
    await expect(db.recordVisualApproval({ cardId: c.id, verdict: {}, approverRoleId: director.id, makerRoleId: null, makerRef: 'claude:x', graderRef: 'claude:x' })).rejects.toThrow(/must differ/);
  });

  // A builder that stores each patch it hands back against its session's base, as the managed adapter
  // does (adapters/managed.ts): main for a fresh session, the card's commit for a revision. A fresh
  // session names the page; a revision only adds a file, whose hunk would apply at main as well.
  function storingBuilder(patches: PatchStore, cardId: string, options: { mode?: 'attended' | 'unattended'; outputTokens?: number; afterFirst?: () => void } = {}) {
    let session = 0;
    const adapter = new FakeAdapter(
      async (spec, emit) => {
        session += 1;
        await emit(startEvent(undefined, options.mode === 'unattended' ? 'ANTHROPIC_API_KEY' : 'none'));
        const revising = spec.prompt.includes('Visual review: revision');
        if (revising) await writeFile(path.join(spec.worktree, 'platform', 'site', 'revision.html'), `<p>revision ${session}</p>\n`, 'utf8');
        else await writeFile(path.join(spec.worktree, 'platform', 'site', 'page.html'), `<title>Mob Machine ${session}</title>\n`, 'utf8');
        await emit(usageEvent(1, session === 1 ? (options.outputTokens ?? 100) : 100));
        const run = (args: string[]) => execFileSync('git', args, { cwd: spec.worktree, stdio: 'pipe' }).toString();
        const base = run(['rev-parse', 'HEAD']).trim();
        run(['add', '-A']);
        const diff = run(['diff', '--cached', '--no-renames', '--full-index', base]);
        run(['reset', '-q']);
        await patches.save(storedPatch(cardId, base, Buffer.from(diff), null, `sesn_${session}`));
        if (session === 1) options.afterFirst?.();
      },
      { mode: options.mode ?? 'attended' },
    );
    return { adapter, sessions: () => session };
  }

  it('keeps no revision patch after a push outage, so the card pauses and a later claim builds the whole change', async () => {
    const { db, c } = setupDb();
    const patches = new MemoryPatchStore();
    const build = storingBuilder(patches, c.id);
    let opened = 0;
    // The revision's pull request request fails: GitHub is down after the revision session ran.
    const { fetchFn } = visualRemote(FRAMES_ZIP, { created: (head) => (++opened === 1 ? { status: 201, json: { number: 5, head: { sha: head } } } : { status: 502, json: { message: 'Bad gateway' } }) });
    const review = reviewer([JSON.stringify(verdict(LEGIBILITY))]);
    const alert = new RecordingAlerter();
    await runCardPipeline(c, { ...visualDeps(db, build.adapter, review.adapter, fetchFn, alert), patches, infraStops: new Map() });
    expect(build.sessions()).toBe(2);
    // The revision's patch was made against the card's commit; it is gone, and so is the first one.
    expect(patches.rows).toEqual([]);
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'outage', review_rounds: 1 });
    expect(alert.messages.at(-1)).toMatch(/no stored patch to re-gate/);

    // The board resumes it and it is claimed again: a session builds the whole change, never the revision alone.
    db.cards[0]!.stage = 'building';
    await git(['update-ref', 'refs/heads/main', initialSha], origin);
    const again = visualRemote();
    await runCardPipeline(c, { ...visualDeps(db, build.adapter, reviewer([JSON.stringify(verdict())]).adapter, again.fetchFn), patches, infraStops: new Map() });
    expect(db.events.some((e) => e.payload.step === 'patch_reused')).toBe(false);
    expect(build.sessions()).toBe(3);
    expect(db.cards[0]).toMatchObject({ stage: 'live' });
    expect(await branchTitle()).toBe('<title>Mob Machine 3</title>');
  });

  it('refuses a revision patch left in the store, whose base is the card commit, instead of merging the revision alone', async () => {
    const { db, c } = setupDb();
    const store = new MemoryPatchStore();
    // The discard after the revision session fails, so the revision's patch is still stored.
    let discards = 0;
    const patches: PatchStore = {
      save: (patch) => store.save(patch),
      latest: (cardId) => store.latest(cardId),
      discard: async (cardId) => {
        if (++discards === 2) throw new Error('db card_patches delete: timeout');
        await store.discard(cardId);
      },
    };
    const build = storingBuilder(patches, c.id);
    let opened = 0;
    const { fetchFn } = visualRemote(FRAMES_ZIP, { created: (head) => (++opened === 1 ? { status: 201, json: { number: 5, head: { sha: head } } } : { status: 502, json: { message: 'Bad gateway' } }) });
    await runCardPipeline(c, { ...visualDeps(db, build.adapter, reviewer([JSON.stringify(verdict(LEGIBILITY))]).adapter, fetchFn), patches, infraStops: new Map() });
    expect(store.rows).toHaveLength(1);
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'outage' });

    db.cards[0]!.stage = 'building';
    await git(['update-ref', 'refs/heads/main', initialSha], origin);
    const alert = new RecordingAlerter();
    await runCardPipeline(c, { ...visualDeps(db, build.adapter, reviewer([JSON.stringify(verdict())]).adapter, visualRemote().fetchFn, alert), patches, infraStops: new Map() });
    expect(build.sessions()).toBe(2);
    expect(store.rows).toEqual([]);
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'patch_conflict' });
    expect(alert.messages.at(-1)).toMatch(/is not on main/);
  });

  it("gives a revision only what the claim's budget still holds after the first session, under a binding cap", async () => {
    const { db, c } = setupDb({ estimate_usd: 10 });
    // The throttle sized the claim at $3 (a cap bound it), well under the $15 ceiling.
    const budgets = new SessionBudgets();
    budgets.start(c.id, 3);
    const build = storingBuilder(new MemoryPatchStore(), c.id, { mode: 'unattended', outputTokens: 100_000 });
    const review = reviewer([JSON.stringify(verdict(LEGIBILITY)), JSON.stringify(verdict())]);
    await runCardPipeline(c, { ...visualDeps(db, build.adapter, review.adapter, visualRemote().fetchFn), budgets });
    expect(db.cards[0]).toMatchObject({ stage: 'live', review_rounds: 1 });
    const [first, revision] = build.adapter.specs;
    expect(first?.maxBudgetUsd).toBe(3);
    // The first session spent about $1.50 of it (1,000 input and 100,000 output tokens at $3 and $15
    // a million); the revision may spend the rest, not $3 again.
    expect(revision?.maxBudgetUsd).toBeGreaterThan(1.45);
    expect(revision?.maxBudgetUsd).toBeLessThan(1.5);
    // Once no session can run, the rest of the budget is no longer held from other cards.
    expect(budgets.remaining().get(c.id)).toBe(0);
  });

  it("sends the card back to funded with its first patch, and counts no round, when the claim's budget is spent", async () => {
    const { db, c } = setupDb({ estimate_usd: 10 });
    const budgets = new SessionBudgets();
    budgets.start(c.id, 3);
    const patches = new MemoryPatchStore();
    // The first session's meter reached the whole budget as it finished.
    const build = storingBuilder(patches, c.id, { mode: 'unattended', afterFirst: () => budgets.record(c.id, 3) });
    const review = reviewer([JSON.stringify(verdict(LEGIBILITY))]);
    await runCardPipeline(c, { ...visualDeps(db, build.adapter, review.adapter, visualRemote().fetchFn), budgets, patches });
    expect(build.sessions()).toBe(1);
    expect(db.cards[0]).toMatchObject({ stage: 'funded', failing_check: 'insufficient_balance', review_rounds: 0 });
    expect(patches.rows.map((row) => row.baseSha)).toEqual([initialSha]);
  });

  it('starts no revision while the board has agents paused or the executor is paused, and counts no round', async () => {
    for (const [pause, stage, check] of [
      [(db: FakeDb) => void (db.studio.paused = true), 'paused', 'paused_by_board'],
      [(db: FakeDb) => void (db.roles[0]!.paused = true), 'funded', 'role_paused'],
    ] as const) {
      await git(['update-ref', 'refs/heads/main', initialSha], origin);
      const { db, c } = setupDb();
      const build = builder();
      // The board pauses while the Director is reviewing.
      const review = new FakeAdapter(
        async (_spec, emit) => {
          await emit({ type: 'start', sessionId: 'review-1', model: 'builder-class', tools: READ_SET, apiKeySource: 'none' });
          await emit(usageEvent(1, 50));
          pause(db);
        },
        { result: () => JSON.stringify(verdict(LEGIBILITY)) },
      );
      await runCardPipeline(c, visualDeps(db, build.adapter, review, visualRemote().fetchFn));
      expect(build.sessions()).toBe(1);
      expect(db.cards[0]).toMatchObject({ stage, failing_check: check, review_rounds: 0 });
    }
  });
});
