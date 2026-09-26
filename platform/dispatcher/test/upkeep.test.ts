// The Janitor's two code jobs (docs/specs/agent-upkeep.md), on mock-fetch fixtures.
// janitor: one fixture per check (schema, model, cli, scan, producer), each finding recorded and sent
// once; a second run records nothing new and sends nothing; a passing check closes its finding; a
// check that cannot run closes nothing; it runs while the studio is paused and writes only findings.
// upkeep_merge: a Dependabot patch that meets every condition merges at its head sha under the merge
// lock, then deploys and smoke-tests both sites; each fixture that breaks exactly one condition is
// refused naming it; a pull request behind main gets one "@dependabot rebase"; nothing happens while
// the studio is paused or main is red; a failed smoke restores the site and reverts main.
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import type { AgentAdapter } from '../src/adapters/types.js';
import type { PinState } from '../src/cli-pin.js';
import type { GateStatus } from '../src/github.js';
import { janitor, schemaFindings } from '../src/job-handlers/janitor.js';
import { isPatchBump, lockfileChanges, neverList, packageJsonChanges, upkeepMerge, type Decision } from '../src/job-handlers/upkeep-merge.js';
import { fingerprintEnv, migrationsFingerprintRunner, type UpkeepDeps } from '../src/job-handlers/upkeep.js';
import { skipReason, type JobContext } from '../src/jobs.js';
import { mergeLock } from '../src/lock.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { gitBlobId } from '../src/smoke.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW } from './helpers/fake-db.js';
import { mockFetch, type Reply } from './helpers/mock-fetch.js';

const GITHUB = 'https://api.github.com/repos/owner/repo';
const NETLIFY = 'https://api.netlify.com/api/v1/sites';
const PRICE = { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 };
const silent = createLogger(new Writable({ write: (_c, _e, cb) => cb() }));
const DAY = 24 * 60 * 60_000;

function config(over: Partial<UpkeepDeps['config']> = {}): UpkeepDeps['config'] {
  return {
    githubToken: 'github-token',
    githubRepo: 'owner/repo',
    netlifyAuthToken: 'netlify-token',
    netlifySiteIdSeed: 'site-seed',
    netlifySiteIdPlatform: 'site-platform',
    modelBuilder: 'claude-builder',
    modelDirector: 'claude-director',
    modelHost: null,
    priceTable: parsePriceTable(JSON.stringify({ 'claude-builder': PRICE, 'claude-director': PRICE })),
    studioAnthropicApiKey: null,
    codeRoot: '/code',
    ...over,
  };
}

function context(db: FakeDb, upkeep: UpkeepDeps, job: 'janitor' | 'upkeep_merge', alert = new RecordingAlerter()): JobContext {
  return {
    run: { id: `run-${job}`, job_name: job, origin: 'schedule', status: 'running', card_id: null, input: {}, parent_run_id: null, created_at: NOW.toISOString() },
    job: { name: job, role_id: 'role-janitor', calls_model: false, runs_when_paused: job === 'janitor' },
    role: null,
    mode: 'attended',
    db,
    adapter: { mode: 'attended' } as unknown as AgentAdapter,
    log: silent,
    alert,
    stopSignal: new AbortController().signal,
    now: () => NOW,
    upkeep,
  };
}

describe('janitor', () => {
  interface JanitorFixture {
    production: Record<string, string>;
    migrations: Record<string, string>;
    pin: PinState;
    evalIds: Record<string, string> | null;
    listed: string[];
    scanJobs: Array<{ name: string; conclusion: string }>;
    fingerprintError: Error | null;
  }

  function fixture(): JanitorFixture {
    return {
      production: { 'table:public.cards': 'aaa', 'function:public.f()': 'bbb', 'table:public.stray': 'ccc' },
      migrations: { 'table:public.cards': 'aaa', 'function:public.f()': 'bbx', 'view:public.v': 'ddd' },
      pin: { ok: false, installed: '2.1.283', pinned: '2.1.280', detail: 'Claude Code 2.1.283 is installed but the pin is 2.1.280.' },
      evalIds: { MODEL_DIRECTOR: 'claude-director-old' },
      listed: ['claude-director'],
      scanJobs: [
        { name: 'osv', conclusion: 'failure' },
        { name: 'links', conclusion: 'success' },
      ],
      fingerprintError: null,
    };
  }

  function setup(f: JanitorFixture, over: Partial<UpkeepDeps['config']> = {}) {
    const db = new FakeDb();
    db.productionFingerprint = f.production;
    const { fetchFn, calls } = mockFetch((method, url) => {
      if (method === 'GET' && url === 'https://api.anthropic.com/v1/models?limit=1000') return { status: 200, json: { data: f.listed.map((id) => ({ id, type: 'model' })) } };
      if (method === 'GET' && url === `${GITHUB}/actions/workflows/janitor.yml/runs?branch=main&status=completed&per_page=1`) {
        return { status: 200, json: { workflow_runs: [{ id: 77, html_url: 'https://github.com/owner/repo/actions/runs/77', head_sha: 'm'.repeat(40), conclusion: 'failure' }] } };
      }
      if (method === 'GET' && url === `${GITHUB}/actions/runs/77/jobs?per_page=100`) {
        return { status: 200, json: { jobs: f.scanJobs.map((job, i) => ({ ...job, html_url: `https://github.com/owner/repo/actions/runs/77/job/${i}` })) } };
      }
      return undefined;
    });
    const upkeep: UpkeepDeps = {
      config: config(over),
      fetchFn,
      mainGate: async () => ({ sha: 'm'.repeat(40), status: { state: 'pass' } }),
      migrationsFingerprint: async () => {
        if (f.fingerprintError) throw f.fingerprintError;
        return f.migrations;
      },
      cliPin: async () => f.pin,
      newestEvalResult: async () => (f.evalIds === null ? null : { file: 'platform/agents/evals/results/2026-09-26T000000Z.json', model_ids: f.evalIds }),
      servedFiles: async () => [],
    };
    const alert = new RecordingAlerter();
    return { db, upkeep, alert, calls, ctx: context(db, upkeep, 'janitor', alert) };
  }

  it('records one finding per drift on each check and sends one message for each', async () => {
    const f = fixture();
    const t = setup(f, { studioAnthropicApiKey: 'studio-key', priceTable: parsePriceTable(JSON.stringify({ 'claude-builder': PRICE })) });
    t.db.signals = [
      { kind: 'unclaimed', card_id: '11111111-1111-4111-8111-111111111111', executor: 'Builder A', figures: { hours: 30, funded_usd: 5 } },
      { kind: 'overrun', card_id: '22222222-2222-4222-8222-222222222222', executor: 'Builder B', figures: { actual_usd: 3, estimate_usd: 2 } },
      { kind: 'throughput', card_id: null, executor: null, figures: { week: '2026-W39', last_7_days: 1, previous_7_days: 4, funded_waiting: 2 } },
    ];
    const output = (await janitor(t.ctx)) as { checked: string[]; opened: string[]; closed: string[]; errors: unknown[] };
    expect(output.checked).toEqual(['schema', 'model', 'cli', 'scan', 'producer']);
    expect(output.errors).toEqual([]);
    expect(output.opened).toEqual([
      'schema:function:public.f()',
      'schema:table:public.stray',
      'schema:view:public.v',
      'model:MODEL_DIRECTOR:price',
      'model:MODEL_BUILDER:listed',
      'model:MODEL_DIRECTOR:eval',
      'cli:version',
      'scan:osv',
      'producer:unclaimed:11111111-1111-4111-8111-111111111111',
      'producer:overrun:22222222-2222-4222-8222-222222222222',
      'producer:throughput:2026-W39',
    ]);
    expect(t.alert.messages).toHaveLength(11);
    const subjects = Object.fromEntries(t.db.findings.map((x) => [x.fingerprint, x.subject]));
    expect(subjects['schema:function:public.f()']).toBe('function:public.f() differs between production and the migrations');
    expect(subjects['schema:table:public.stray']).toBe('table:public.stray is in production but no migration makes it');
    expect(subjects['schema:view:public.v']).toBe('view:public.v is in the migrations but not in production');
    expect(subjects['model:MODEL_DIRECTOR:price']).toBe('MODEL_DIRECTOR claude-director has no row in PRICE_TABLE_JSON');
    expect(subjects['model:MODEL_BUILDER:listed']).toBe('MODEL_BUILDER claude-builder is not listed by the Anthropic API');
    expect(subjects['model:MODEL_DIRECTOR:eval']).toBe('MODEL_DIRECTOR is claude-director but the newest eval result ran claude-director-old');
    expect(subjects['cli:version']).toBe('Claude Code 2.1.283 is installed but the pin is 2.1.280');
    expect(t.db.findings.find((x) => x.fingerprint === 'scan:osv')?.detail).toMatchObject({ run: 'https://github.com/owner/repo/actions/runs/77', conclusion: 'failure' });
    expect(subjects['producer:throughput:2026-W39']).toMatch(/^1 cards shipped in the last seven days, fewer than half the 4 the week before, with 2 funded cards waiting$/);
    expect(t.alert.messages[0]).toBe('Janitor: function:public.f() differs between production and the migrations. It is listed under Needs you.');
    // The studio key's model list is a free read, sent with the key and nothing else.
    expect(t.calls.filter((c) => c.url.startsWith('https://api.anthropic.com'))).toHaveLength(1);
  });

  it('records nothing new and sends nothing on a second run', async () => {
    const t = setup(fixture());
    await janitor(t.ctx);
    const sent = t.alert.messages.length;
    const output = (await janitor(t.ctx)) as { opened: string[]; recorded: number };
    expect(output.opened).toEqual([]);
    expect(output.recorded).toBeGreaterThan(0);
    expect(t.alert.messages).toHaveLength(sent);
  });

  it('closes a finding when its check passes, and leaves the other kinds open', async () => {
    const f = fixture();
    const t = setup(f);
    await janitor(t.ctx);
    f.migrations = { ...f.production };
    f.pin = { ok: true, version: '2.1.280' };
    const output = (await janitor(t.ctx)) as { closed: string[] };
    expect(output.closed).toEqual(['schema:function:public.f()', 'schema:table:public.stray', 'schema:view:public.v', 'cli:version']);
    expect((await t.db.openFindings()).map((x) => x.fingerprint)).toEqual(['model:MODEL_DIRECTOR:eval', 'scan:osv']);
    // Seen again after closing, a finding reopens and is sent again.
    f.pin = { ok: false, installed: '2.1.284', pinned: '2.1.280', detail: 'x' };
    const sent = t.alert.messages.length;
    expect(((await janitor(t.ctx)) as { opened: string[] }).opened).toEqual(['cli:version']);
    expect(t.alert.messages).toHaveLength(sent + 1);
  });

  it('closes nothing of a check that could not run, and names why', async () => {
    const f = fixture();
    const t = setup(f);
    await janitor(t.ctx);
    f.fingerprintError = new Error('schema-fingerprint.ts exited 1');
    const output = (await janitor(t.ctx)) as { checked: string[]; closed: string[]; errors: Array<{ check: string; error: string }> };
    expect(output.checked).not.toContain('schema');
    expect(output.errors).toEqual([{ check: 'schema', error: 'schema-fingerprint.ts exited 1' }]);
    expect(output.closed).toEqual([]);
    expect((await t.db.openFindings()).filter((x) => x.kind === 'schema')).toHaveLength(3);
  });

  it('checks no model against an eval result when there is none, and none against the API without the studio key', async () => {
    const f = fixture();
    f.evalIds = null;
    const t = setup(f);
    await janitor(t.ctx);
    expect(t.db.findings.filter((x) => x.kind === 'model')).toEqual([]);
    expect(t.calls.some((c) => c.url.includes('anthropic.com'))).toBe(false);
  });

  it('runs while the studio is paused and writes only findings and its job run', async () => {
    const t = setup(fixture());
    t.db.studio.paused = true;
    expect(skipReason({ name: 'janitor', role_id: null, calls_model: false, runs_when_paused: true }, { origin: 'schedule' }, null, { paused: true })).toBeNull();
    const output = (await janitor(t.ctx)) as { opened: string[] };
    expect(output.opened.length).toBeGreaterThan(0);
    expect(t.db.findingWrites.every((w) => w.startsWith('record:') || w.startsWith('close:'))).toBe(true);
    expect([t.db.events, t.db.deploys, t.db.cards, t.db.jobRuns, t.db.drafts]).toEqual([[], [], [], [], []]);
    expect(t.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('diffs two fingerprints object by object', () => {
    expect(schemaFindings({ a: '1', b: '2' }, { a: '1', b: '2' })).toEqual([]);
    expect(schemaFindings({ a: '1' }, { a: '2' }).map((x) => x.fingerprint)).toEqual(['schema:a']);
  });
});

// upkeep_merge ------------------------------------------------------------------------------------

const MAIN = 'a'.repeat(40);
const OLD_MAIN = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const MERGE = 'd'.repeat(40);
const SITE = { platform: 'https://platform.local', seed: 'https://seed.local' };
const SERVED = new TextEncoder().encode('{"cost":10}\n');

// A v9 lockfile: the dispatcher's importer (yaml and supabase-js, and tsx as its dev dependency), each package, and a
// snapshot for each, with the dependencies SNAPSHOT_DEPS gives it at any version.
const SNAPSHOT_DEPS: Record<string, Record<string, string>> = {
  tsx: { esbuild: '0.28.2', 'get-tsconfig': '4.10.0' },
  '@supabase/supabase-js': { '@supabase/auth-js': '2.116.0' },
  '@scope/tool': { 'deep-helper': '1.0.0' },
};
const DISPATCHER_IMPORTER = {
  dependencies: { yaml: { specifier: '2.9.1', version: '2.9.1' }, '@supabase/supabase-js': { specifier: '^2.116.0', version: '2.116.0' } },
  devDependencies: { tsx: { specifier: '^4.23.13', version: '4.23.13' } },
};
const lock = (packages: string[], importer: Record<string, unknown> = DISPATCHER_IMPORTER) =>
  stringifyYaml({
    lockfileVersion: '9.0',
    importers: { '.': {}, 'platform/dispatcher': importer },
    packages: Object.fromEntries(packages.map((p) => [p, { resolution: { integrity: 'sha512-x' } }])),
    snapshots: Object.fromEntries(
      packages.map((p) => {
        const deps = SNAPSHOT_DEPS[p.slice(0, p.lastIndexOf('@'))];
        return [p, deps ? { dependencies: deps } : {}];
      }),
    ),
  });
// Every package main's lockfile names: the site's left-pad and @scope/tool (with its own dependency),
// and the dispatcher's closure.
const BASE_PACKAGES = ['left-pad@1.3.0', '@scope/tool@2.4.1', 'deep-helper@1.0.0', 'yaml@2.9.1', 'tsx@4.23.13', 'esbuild@0.28.2', 'get-tsconfig@4.10.0', '@supabase/supabase-js@2.116.0', '@supabase/auth-js@2.116.0', '@electric-sql/pglite@0.3.7'];
const withPackages = (...swaps: Array<[string, string]>) => BASE_PACKAGES.map((p) => swaps.find(([from]) => from === p)?.[1] ?? p);

interface MergeFixture {
  verified: boolean;
  files: Array<{ filename: string; status: string }>;
  contents: Record<string, string>;
  published: Record<string, string>;
  behind: number;
  mergeBase: string;
  headGate: Reply;
  comments: Array<{ body: string; created_at: string }>;
  version: string;
  main: GateStatus;
}

function mergeFixture(): MergeFixture {
  return {
    verified: true,
    files: [
      { filename: 'platform/site/package.json', status: 'modified' },
      { filename: 'pnpm-lock.yaml', status: 'modified' },
    ],
    contents: {
      [`platform/site/package.json@${MAIN}`]: JSON.stringify({ name: '@backseat/site', dependencies: { 'left-pad': '^1.3.0' }, devDependencies: { typescript: '^5.9.0' } }),
      [`platform/site/package.json@${HEAD}`]: JSON.stringify({ name: '@backseat/site', dependencies: { 'left-pad': '^1.3.1' }, devDependencies: { typescript: '^5.9.0' } }),
      [`pnpm-lock.yaml@${MAIN}`]: lock(BASE_PACKAGES),
      [`pnpm-lock.yaml@${HEAD}`]: lock(withPackages(['left-pad@1.3.0', 'left-pad@1.3.1'])),
    },
    published: { 'left-pad@1.3.1': new Date(NOW.getTime() - 9 * DAY).toISOString() },
    behind: 0,
    mergeBase: MAIN,
    headGate: { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status: 'completed', conclusion: 'success' }] } },
    comments: [],
    version: MERGE,
    main: { state: 'pass' },
  };
}

function mergeSetup(f: MergeFixture) {
  const db = new FakeDb();
  db.deploys = [
    { id: 'g1', folder: 'platform', sha: 'old', netlify_deploy_id: 'dep-green-platform', is_green: true, smoke_result: 'pass', created_at: NOW.toISOString() },
    { id: 'g2', folder: 'seed-1', sha: 'old', netlify_deploy_id: 'dep-green-seed', is_green: true, smoke_result: 'pass', created_at: NOW.toISOString() },
  ];
  const posted: string[] = [];
  const green = { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status: 'completed', conclusion: 'success' }] } };
  const { fetchFn, calls } = mockFetch((method, url, body) => {
    if (method === 'GET' && url === `${GITHUB}/pulls?state=open&sort=created&direction=asc&per_page=100`) {
      return {
        status: 200,
        json: [
          { number: 3, title: 'Board work', user: { login: 'AlreadyKyle' }, head: { sha: 'f'.repeat(40), ref: 'board/x' }, base: { ref: 'main' }, created_at: '2026-09-01T00:00:00Z' },
          { number: 7, title: 'Bump left-pad from 1.3.0 to 1.3.1', user: { login: 'dependabot[bot]' }, head: { sha: HEAD, ref: 'dependabot/npm_and_yarn/left-pad-1.3.1' }, base: { ref: 'main' }, created_at: '2026-09-10T00:00:00Z' },
        ],
      };
    }
    if (method === 'GET' && url === `${GITHUB}/commits/${HEAD}`) {
      return { status: 200, json: { commit: { verification: { verified: f.verified, reason: f.verified ? 'valid' : 'unsigned' }, committer: { date: '2026-09-10T00:00:00Z' } } } };
    }
    if (method === 'GET' && url === `${GITHUB}/compare/${MAIN}...${HEAD}`) {
      return { status: 200, json: { merge_base_commit: { sha: f.mergeBase }, ahead_by: 1, behind_by: f.behind, commits: [{ sha: HEAD }], files: f.files } };
    }
    const contents = /\/contents\/(.+)\?ref=([0-9a-f]+)$/.exec(url);
    if (method === 'GET' && contents) {
      const text = f.contents[`${decodeURIComponent(contents[1]!)}@${contents[2]}`];
      return text === undefined ? { status: 404, json: { message: 'Not Found' } } : { status: 200, text };
    }
    const registry = /^https:\/\/registry\.npmjs\.org\/(.+)$/.exec(url);
    if (method === 'GET' && registry) {
      const name = decodeURIComponent(registry[1]!);
      const time = Object.fromEntries(Object.entries(f.published).filter(([key]) => key.startsWith(`${name}@`)).map(([key, at]) => [key.slice(name.length + 1), at]));
      return { status: 200, json: { name, time } };
    }
    if (method === 'GET' && url === `${GITHUB}/issues/7/comments?per_page=100`) return { status: 200, json: f.comments };
    if (method === 'POST' && url === `${GITHUB}/issues/7/comments`) {
      posted.push((body as { body: string }).body);
      f.comments.push({ body: (body as { body: string }).body, created_at: NOW.toISOString() });
      return { status: 201, json: {} };
    }
    if (method === 'GET' && url === `${GITHUB}/actions/runs?head_sha=${HEAD}&per_page=50`) return f.headGate;
    if (method === 'GET' && url === `${GITHUB}/actions/runs?head_sha=${MERGE}&per_page=50`) return green;
    if (method === 'GET' && url === `${GITHUB}/git/ref/heads/main`) return { status: 200, json: { object: { sha: MAIN } } };
    if (method === 'PUT' && url === `${GITHUB}/pulls/7/merge`) return { status: 200, json: { sha: MERGE } };
    for (const [site, base] of [['site-platform', SITE.platform], ['site-seed', SITE.seed]] as const) {
      if (method === 'GET' && url === `${NETLIFY}/${site}/deploys?page=1&per_page=50`) return { status: 200, json: [{ id: `dep-new-${site}`, state: 'ready', commit_ref: MERGE, context: 'production' }] };
      if (method === 'GET' && url === `${NETLIFY}/${site}`) return { status: 200, json: { ssl_url: base } };
      if (method === 'POST' && url.startsWith(`${NETLIFY}/${site}/deploys/`) && url.endsWith('/restore')) return { status: 200, json: {} };
      if (method === 'GET' && url === `${base}/`) return { status: 200, text: `<meta name="build-sha" content="${MERGE}">` };
      if (method === 'GET' && url === `${base}/version.json`) return { status: 200, json: { sha: site === 'site-platform' ? f.version : MERGE } };
    }
    if (method === 'GET' && url === `${SITE.seed}/config/cost.json`) return { status: 200, text: new TextDecoder().decode(SERVED) };
    if (method === 'GET' && url === `${GITHUB}/git/commits/${MERGE}`) return { status: 200, json: { sha: MERGE, parents: [{ sha: MAIN }] } };
    if (method === 'GET' && url === `${GITHUB}/git/commits/${MAIN}`) return { status: 200, json: { sha: MAIN, tree: { sha: 'main-tree' } } };
    if (method === 'POST' && url === `${GITHUB}/git/commits`) return { status: 201, json: { sha: 'revert-sha' } };
    if (method === 'PATCH' && url === `${GITHUB}/git/refs/heads/main`) return { status: 200, json: {} };
    return undefined;
  });
  const upkeep: UpkeepDeps = {
    config: config(),
    fetchFn,
    mainGate: async () => ({ sha: MAIN, status: f.main }),
    migrationsFingerprint: async () => ({}),
    cliPin: async () => ({ ok: true, version: '2.1.280' }),
    newestEvalResult: async () => null,
    servedFiles: async () => [{ path: 'seed-1/config/cost.json', route: '/config/cost.json', mode: '100644', blob: gitBlobId(SERVED) }],
    timings: { deployIntervalMs: 1, deployTimeoutMs: 200, gateIntervalMs: 1, gateTimeoutMs: 200, retryDelayMs: 1 },
  };
  const alert = new RecordingAlerter();
  return { db, calls, posted, alert, ctx: context(db, upkeep, 'upkeep_merge', alert) };
}

async function decide(f: MergeFixture) {
  const t = mergeSetup(f);
  const output = (await upkeepMerge(t.ctx)) as { decisions: Decision[]; skipped?: string };
  return { ...t, output, merged: t.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/merge')) };
}

describe('upkeep_merge', () => {
  it('merges a Dependabot patch that meets every condition at its head sha, then deploys and smoke-tests both sites', async () => {
    const t = await decide(mergeFixture());
    expect(t.output.decisions).toEqual([{ pr: 7, result: 'merged', sha: MERGE, detail: 'merged, deployed and smoke-tested platform and seed-1' }]);
    const put = t.calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({ sha: HEAD, merge_method: 'squash', commit_title: 'Bump left-pad from 1.3.0 to 1.3.1 (#7)' });
    expect(t.db.deploys.filter((d) => d.sha === MERGE).map((d) => [d.folder, d.netlify_deploy_id, d.is_green])).toEqual([
      ['platform', 'dep-new-site-platform', true],
      ['seed-1', 'dep-new-site-seed', true],
    ]);
    expect(t.alert.messages).toEqual([`Upkeep merged pull request #7 (Bump left-pad from 1.3.0 to 1.3.1) as ${MERGE.slice(0, 8)}; both sites deployed and passed smoke.`]);
    // Pull request 3 is the board's: never read beyond the list.
    expect(t.calls.some((c) => c.url.includes('f'.repeat(40)))).toBe(false);
  });

  it('merges under the merge lock, after a card merge holding it', async () => {
    let release: () => void = () => undefined;
    const held = mergeLock.run(() => new Promise<void>((resolve) => (release = resolve)));
    const t = mergeSetup(mergeFixture());
    const run = upkeepMerge(t.ctx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(t.calls.some((c) => c.method === 'PUT')).toBe(false);
    release();
    await held;
    const output = (await run) as { decisions: Decision[] };
    expect(output.decisions[0]?.result).toBe('merged');
  });

  const broken: Array<[string, (f: MergeFixture) => void, string, RegExp]> = [
    ['an unverified head commit', (f) => (f.verified = false), 'verified', /did not verify .* \(unsigned\)/],
    ['a file other than package.json or the lockfile', (f) => f.files.push({ filename: 'platform/site/src/pay.ts', status: 'modified' }), 'files', /platform\/site\/src\/pay\.ts \(modified\)/],
    ['an added package.json', (f) => (f.files[0] = { filename: 'platform/site/package.json', status: 'added' }), 'files', /package\.json \(added\)/],
    [
      'a minor bump',
      (f) => {
        f.contents[`platform/site/package.json@${HEAD}`] = JSON.stringify({ name: '@backseat/site', dependencies: { 'left-pad': '^1.4.0' }, devDependencies: { typescript: '^5.9.0' } });
      },
      'semver_patch',
      /left-pad from \^1\.3\.0 to \^1\.4\.0, which is not a patch/,
    ],
    [
      'a changed script',
      (f) => {
        f.contents[`platform/site/package.json@${HEAD}`] = JSON.stringify({ name: '@backseat/site-x', dependencies: { 'left-pad': '^1.3.1' }, devDependencies: { typescript: '^5.9.0' } });
      },
      'semver_patch',
      /changes name, which is not a dependency version/,
    ],
    ['a lockfile minor bump', (f) => (f.contents[`pnpm-lock.yaml@${HEAD}`] = lock(withPackages(['left-pad@1.3.0', 'left-pad@1.4.0']))), 'semver_patch', /left-pad@1\.4\.0, which is not a patch/],
    ['a new package in the lockfile', (f) => (f.contents[`pnpm-lock.yaml@${HEAD}`] = lock([...withPackages(['left-pad@1.3.0', 'left-pad@1.3.1']), 'evil@1.0.0'])), 'new_package', /adds the package evil/],
    ...(
      [
        ["one of the dispatcher's runtime dependencies", 'yaml@2.9.1', 'yaml@2.9.2', /^yaml is on the never list$/],
        ['tsx, the dev dependency the dispatcher runs under', 'tsx@4.23.13', 'tsx@4.23.14', /^tsx is on the never list$/],
        ["a package in a runtime dependency's closure", '@supabase/auth-js@2.116.0', '@supabase/auth-js@2.116.1', /^@supabase\/auth-js is on the never list$/],
        ["a package in tsx's closure", 'get-tsconfig@4.10.0', 'get-tsconfig@4.10.1', /^get-tsconfig is on the never list$/],
        ['PGlite, which the daily check runs on the host', '@electric-sql/pglite@0.3.7', '@electric-sql/pglite@0.3.8', /^@electric-sql\/pglite is on the never list$/],
      ] as const
    ).map(([name, from, to, detail]): [string, (f: MergeFixture) => void, string, RegExp] => [
      `a patch to ${name}`,
      (f) => {
        f.contents[`pnpm-lock.yaml@${HEAD}`] = lock(withPackages(['left-pad@1.3.0', 'left-pad@1.3.1'], [from, to]));
        f.published[to] = new Date(NOW.getTime() - 30 * DAY).toISOString();
      },
      'never_list',
      detail,
    ]),
    ['a lockfile with no dispatcher importer', (f) => (f.contents[`pnpm-lock.yaml@${MAIN}`] = lock(BASE_PACKAGES).replace('platform/dispatcher:', 'platform/other:')), 'never_list', /names no platform\/dispatcher importer/],
    ['a version less than seven days old', (f) => (f.published['left-pad@1.3.1'] = new Date(NOW.getTime() - 2 * DAY).toISOString()), 'release_age', /left-pad@1\.3\.1 was published .*, less than seven days ago/],
    ['a version the registry does not list', (f) => delete f.published['left-pad@1.3.1'], 'release_age', /does not list left-pad@1\.3\.1/],
    ['no gate run at the head sha', (f) => (f.headGate = { status: 200, json: { workflow_runs: [] } }), 'gate', /is missing/],
    ['a failed gate at the head sha', (f) => (f.headGate = { status: 200, json: { workflow_runs: [{ path: '.github/workflows/gate.yml', status: 'completed', conclusion: 'failure' }] } }), 'gate', /failed \(failure\)/],
  ];

  for (const [name, breakIt, condition, detail] of broken) {
    it(`refuses ${name}, naming ${condition}`, async () => {
      const f = mergeFixture();
      breakIt(f);
      const t = await decide(f);
      expect(t.output.decisions).toEqual([{ pr: 7, result: 'refused', condition, detail: expect.stringMatching(detail) }]);
      expect(t.merged).toBe(false);
      expect(t.posted).toEqual([]);
    });
  }

  it('reads the gate at the head sha once, so it fails closed at once while Actions cannot run', async () => {
    const f = mergeFixture();
    f.headGate = { status: 200, json: { workflow_runs: [] } };
    const t = await decide(f);
    expect(t.calls.filter((c) => c.url === `${GITHUB}/actions/runs?head_sha=${HEAD}&per_page=50`)).toHaveLength(1);
  });

  it("comments @dependabot rebase once when the pull request is not built on main's head, and waits", async () => {
    const f = mergeFixture();
    f.behind = 2;
    f.mergeBase = OLD_MAIN;
    f.contents[`platform/site/package.json@${OLD_MAIN}`] = f.contents[`platform/site/package.json@${MAIN}`]!;
    f.contents[`pnpm-lock.yaml@${OLD_MAIN}`] = f.contents[`pnpm-lock.yaml@${MAIN}`]!;
    const first = await decide(f);
    expect(first.output.decisions).toEqual([{ pr: 7, result: 'rebase_requested', detail: expect.stringMatching(/commented @dependabot rebase/) }]);
    expect(first.posted).toEqual(['@dependabot rebase']);
    expect(first.merged).toBe(false);
    const second = await decide(f);
    expect(second.output.decisions).toEqual([{ pr: 7, result: 'waiting_for_rebase', detail: expect.stringMatching(/a rebase was asked for/) }]);
    expect(second.posted).toEqual([]);
  });

  it('does nothing while the studio is paused, or while main is red', async () => {
    const paused = mergeSetup(mergeFixture());
    paused.db.studio.paused = true;
    expect(await upkeepMerge(paused.ctx)).toEqual({ skipped: 'studio_paused', decisions: [] });
    expect(paused.calls).toEqual([]);
    expect(skipReason({ name: 'upkeep_merge', role_id: null, calls_model: false, runs_when_paused: false }, { origin: 'schedule' }, null, { paused: true })).toBe('studio_paused');

    const f = mergeFixture();
    f.main = { state: 'fail', conclusion: 'failure' };
    const red = await decide(f);
    expect(red.output).toEqual({ skipped: 'main_red', main: MAIN, decisions: [] });
    expect(red.calls).toEqual([]);
  });

  it('restores the site and reverts main when the smoke test fails, as a card merge does', async () => {
    const f = mergeFixture();
    f.version = 'e'.repeat(40);
    const t = await decide(f);
    expect(t.output.decisions).toEqual([
      { pr: 7, result: 'rolled_back', sha: MERGE, detail: expect.stringMatching(/^platform smoke failed: fail: version\.json sha e+ differs/), revert_sha: 'revert-sha', problems: [] },
    ]);
    expect(t.calls.some((c) => c.method === 'POST' && c.url === `${NETLIFY}/site-platform/deploys/dep-green-platform/restore`)).toBe(true);
    expect(t.calls.find((c) => c.method === 'POST' && c.url === `${GITHUB}/git/commits`)?.body).toMatchObject({ tree: 'main-tree', parents: [MERGE] });
    expect(t.calls.some((c) => c.method === 'PATCH' && c.url === `${GITHUB}/git/refs/heads/main`)).toBe(true);
    expect(t.db.deploys.filter((d) => d.sha === MERGE).map((d) => [d.folder, d.is_green])).toEqual([['platform', false]]);
    expect(t.alert.messages[0]).toMatch(/failed: platform smoke failed.*It was reverted \(revert-s\) and the sites restored\./);
    expect(t.db.studio.paused).toBe(false);
  });
});

describe('the merge policy helpers', () => {
  it('knows a patch from anything else', () => {
    expect(isPatchBump('^1.2.3', '^1.2.4')).toBe(true);
    expect(isPatchBump('1.2.3', '1.2.10')).toBe(true);
    expect(isPatchBump('^1.2.3', '1.2.4')).toBe(false);
    expect(isPatchBump('1.2.3', '1.3.0')).toBe(false);
    expect(isPatchBump('1.2.3', '1.2.3')).toBe(false);
    expect(isPatchBump('1.2.3', '1.2.4-beta.1')).toBe(false);
  });

  it('reads package.json and lockfile changes', () => {
    expect(packageJsonChanges('p', '{"dependencies":{"a":"^1.0.0"}}', '{"dependencies":{"a":"^1.0.1"}}')).toEqual({ ok: true, changes: [{ name: 'a', from: '^1.0.0', to: '^1.0.1' }] });
    expect(packageJsonChanges('p', '{"dependencies":{"a":"^1.0.0"}}', '{"dependencies":{"a":"^1.0.0","b":"1.0.0"}}')).toMatchObject({ ok: false });
    expect(lockfileChanges(lock(['a@1.0.0', '@s/b@2.0.0']), lock(['a@1.0.1', '@s/b@2.0.0']))).toEqual({ ok: true, change: { added: [{ name: 'a', version: '1.0.1' }], changedNames: ['a'] } });
  });

  it("builds the never list from the lockfile's closure of the dispatcher, dev dependencies and workspace links included, and PGlite's", () => {
    const text = stringifyYaml({
      lockfileVersion: '9.0',
      importers: {
        'platform/dispatcher': { dependencies: { a: { specifier: '^1.0.0', version: '1.0.0' }, '@backseat/lib': { specifier: 'workspace:*', version: 'link:../lib' } }, devDependencies: { tsx: { specifier: '^4.0.0', version: '4.0.0' } } },
        'platform/lib': { dependencies: { c: { specifier: '1.0.0', version: '1.0.0' } } },
        'platform/site': { dependencies: { react: { specifier: '19.0.0', version: '19.0.0' } } },
      },
      snapshots: {
        'a@1.0.0': { dependencies: { b: '2.0.0(peer@1.0.0)', 'string-width-cjs': 'string-width@4.2.3' } },
        'b@2.0.0(peer@1.0.0)': { optionalDependencies: { fsevents: '2.3.3' } },
        'string-width@4.2.3': {},
        'fsevents@2.3.3': {},
        'c@1.0.0': {},
        'tsx@4.0.0': { dependencies: { 'get-tsconfig': '4.10.0' } },
        'get-tsconfig@4.10.0': {},
        '@electric-sql/pglite@0.3.7': { dependencies: { d: '1.0.0' } },
        'd@1.0.0': {},
        'react@19.0.0': {},
      },
    });
    expect([...neverList(text)].sort()).toEqual(
      ['@backseat/lib', '@electric-sql/pglite', 'a', 'b', 'c', 'd', 'esbuild', 'fsevents', 'get-tsconfig', 'pnpm', 'string-width', 'string-width-cjs', 'tsx', 'vite'].sort(),
    );
    expect(() => neverList(stringifyYaml({ lockfileVersion: '9.0', importers: { '.': {} } }))).toThrow(/names no platform\/dispatcher importer/);
    // The repository's own lockfile: the dispatcher's loader, a package deep in its runtime closure,
    // and PGlite are in; the site's React is not.
    const repo = neverList(readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8'));
    expect(['tsx', 'esbuild', '@supabase/auth-js', 'fast-deep-equal', '@electric-sql/pglite', 'vite', 'pnpm'].filter((name) => !repo.has(name))).toEqual([]);
    expect(repo.has('react')).toBe(false);
  });

  it('runs the schema fingerprint with none of the dispatcher\'s secrets in its environment', async () => {
    const env = { PATH: '/usr/bin', HOME: '/Users/studio', TMPDIR: '/tmp/x', SUPABASE_SERVICE_ROLE_KEY: 'service', GITHUB_TOKEN: 'gh', NETLIFY_AUTH_TOKEN: 'netlify', STUDIO_ANTHROPIC_API_KEY: 'anthropic' };
    expect(fingerprintEnv(env)).toEqual({ PATH: '/usr/bin', HOME: '/Users/studio', TMPDIR: '/tmp/x', TSX_DISABLE_CACHE: '1' });
    let seen: NodeJS.ProcessEnv | null = null;
    const run = migrationsFingerprintRunner('/code', async (_file, _args, options) => {
      seen = options.env;
      return { stdout: 'noise\n{"table:public.cards":"abc"}\n' };
    }, env);
    expect(await run()).toEqual({ 'table:public.cards': 'abc' });
    expect(seen).toEqual({ PATH: '/usr/bin', HOME: '/Users/studio', TMPDIR: '/tmp/x', TSX_DISABLE_CACHE: '1' });
  });
});
