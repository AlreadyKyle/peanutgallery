import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter, ClosedSessions, ManagedControl } from '../src/adapters/types.js';
import { loadConfig, type DispatcherConfig } from '../src/config.js';
import { StartupError, exitCodeFor } from '../src/exit-code.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { CODE_PATHS, checkCodeReadonly, checkRoleModels, failStaleJobRuns, startupChecks, unattendedStartup, type StartupDeps } from '../src/startup.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeDb, recordCalls, role } from './helpers/fake-db.js';

const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }));
const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));

const config: DispatcherConfig = {
  codeRoot: '/repo',
  codeReadonly: false,
  repoRoot: '/repo',
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
  visualReviewMaxUsd: 1,
  draftSessionMaxUsd: 0.75,
  sessionMaxTurns: 60,
  sessionMaxMinutes: 60,
  agentHourlyRateUsd: 5,
  tickMs: 60_000,
  worktreeRoot: '/repo/.worktrees',
  maxConcurrency: 1,
  claudeBin: 'claude',
  studioAnthropicApiKey: 'studio-key',
  healthcheckUrl: null,
  ntfyTopicUrl: null,
  discordWebhookShips: null,
  discordWebhookWeekly: null,
  publicSiteUrl: 'https://site.test',
};

// The managed controls, recording the order they run in; each step may be made to throw.
class ManagedStub implements ManagedControl {
  calls: string[] = [];
  containmentError: Error | null = null;
  probeError: Error | null = null;
  async checkContainment() {
    this.calls.push('containment');
    if (this.containmentError) throw this.containmentError;
  }
  async probe() {
    this.calls.push('probe');
    if (this.probeError) throw this.probeError;
  }
  async closeOrphans() {
    this.calls.push('closeOrphans');
    return new Map<string, ClosedSessions>();
  }
}

function unattendedDb(): FakeDb {
  const db = new FakeDb();
  return db;
}

function deps(db: FakeDb, overrides: Partial<StartupDeps> = {}) {
  const managed = new ManagedStub();
  const adapter: AgentAdapter = Object.assign(new FakeAdapter(async () => {}), { managed });
  const built: StartupDeps = { db, adapter, config, log: silent, ...overrides };
  return { deps: built, managed };
}

// A code root with the folders the check reads, left writable.
async function codeTree(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'backseat-code-root-'));
  for (const relative of CODE_PATHS) await mkdir(path.join(root, relative), { recursive: true });
  return root;
}

const trees: string[] = [];
afterEach(async () => {
  for (const root of trees.splice(0)) {
    for (const relative of CODE_PATHS) await chmod(path.join(root, relative), 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

// Root writes through any mode bits, so the read-only case only means something as another user.
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('checkCodeReadonly', () => {
  it('refuses to start, exit 78, when the code root or its node_modules is writable', async () => {
    const root = await codeTree();
    trees.push(root);
    const error = await checkCodeReadonly(root).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StartupError);
    expect(exitCodeFor(error)).toBe(78);
    expect((error as Error).message).toContain(`the code root ${root} is writable by this process`);
    expect((error as Error).message).toContain('node_modules (writable)');
  });

  it('refuses a code root with no node_modules', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'backseat-code-root-'));
    trees.push(root);
    await chmod(root, 0o555);
    const error = await checkCodeReadonly(root).catch((caught: unknown) => caught);
    expect(exitCodeFor(error)).toBe(78);
    expect((error as Error).message).toContain('node_modules (missing)');
  });

  it.skipIf(asRoot)('passes on a code root no one but root can write to', async () => {
    const root = await codeTree();
    trees.push(root);
    for (const relative of [...CODE_PATHS].reverse()) await chmod(path.join(root, relative), 0o555);
    await expect(checkCodeReadonly(root)).resolves.toBeUndefined();
  });
});

describe('failStaleJobRuns', () => {
  it('finishes every job run still marked running as failed with dispatcher_restart, once the lease is held, and logs the count', async () => {
    const db = new FakeDb();
    db.jobList = [{ name: 'tidy_up', role_id: null, calls_model: false, runs_when_paused: false, enabled: true }];
    const lines: string[] = [];
    const log = createLogger(new Writable({ write: (chunk, _enc, cb) => { lines.push(String(chunk)); cb(); } }));
    await expect(failStaleJobRuns(db, 'mac/1/abcd', log)).rejects.toThrow('Only the dispatcher lease holder');
    await db.claimLease('mac/1/abcd', 300);
    const left = await db.enqueueJobRun({ job: 'tidy_up', origin: 'operator' });
    const queued = await db.enqueueJobRun({ job: 'tidy_up', origin: 'operator' });
    await db.claimJobRun(left.id, 'mac/1/abcd');
    expect(await failStaleJobRuns(db, 'mac/1/abcd', log)).toBe(1);
    expect(db.jobRuns.map((r) => [r.id, r.status, r.reason])).toEqual([[left.id, 'failed', 'dispatcher_restart'], [queued.id, 'queued', null]]);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ scope: 'startup', msg: '1 running job run(s) finished as failed', count: 1, reason: 'dispatcher_restart' });
  });
});

describe('startupChecks', () => {
  it('checks the code root first when DISPATCHER_CODE_READONLY is required, before the database or a probe', async () => {
    const root = await codeTree();
    trees.push(root);
    const { deps: startup, managed } = deps(unattendedDb(), { config: { ...config, codeRoot: root, codeReadonly: true } });
    const error = await startupChecks(startup).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain('is writable by this process');
    expect(exitCodeFor(error)).toBe(78);
    expect(managed.calls).toEqual([]);
  });

  it('runs every check on a read-only code root', async () => {
    if (asRoot) return;
    const root = await codeTree();
    trees.push(root);
    for (const relative of [...CODE_PATHS].reverse()) await chmod(path.join(root, relative), 0o555);
    const { deps: startup, managed } = deps(unattendedDb(), { config: { ...config, codeRoot: root, codeReadonly: true } });
    await startupChecks(startup);
    expect(managed.calls).toEqual(['containment', 'probe']);
  });

  // docs/specs/unattended-roles.md, PR5: attended mode is retired. An old .env that still says
  // AGENT_MODE=attended is warned about and ignored, and startup runs as it always does now: no mode
  // to agree on, no board session, containment and the probe on the managed adapter.
  it('starts with AGENT_MODE=attended in .env: the config warns, and startup runs containment and the probe', async () => {
    const env = {
      AGENT_MODE: 'attended',
      GITHUB_REPO: 'owner/repo',
      MODEL_BUILDER: 'builder-class',
      PRICE_TABLE_JSON: JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }),
      SUPABASE_URL: 'https://db.local',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      GITHUB_TOKEN: 'github_pat_-fixture-write',
      GITHUB_READ_TOKEN: 'github_pat_-fixture-read',
      NETLIFY_AUTH_TOKEN: 'netlify-token',
      NETLIFY_SITE_ID_SEED: 'site-seed',
      NETLIFY_SITE_ID_PLATFORM: 'site-platform',
      STUDIO_ANTHROPIC_API_KEY: 'studio-key',
      MANAGED_AGENT_ID: 'agent_1',
      MANAGED_AGENT_VERSION: '1',
      MANAGED_ENVIRONMENT_ID: 'env_1',
    };
    const warnings: string[] = [];
    const loaded = loadConfig(env, '/repo', (message) => warnings.push(message));
    expect(warnings).toEqual([expect.stringContaining('AGENT_MODE=attended is ignored')]);
    expect(loaded.studioAnthropicApiKey).toBe('studio-key');
    const { db, calls } = recordCalls(new FakeDb());
    const { deps: startup, managed } = deps(db, { config: loaded });
    await expect(startupChecks(startup)).resolves.toBeUndefined();
    expect(managed.calls).toEqual(['containment', 'probe']);
    expect([...calls].filter((name) => /board|getStudioState/i.test(name))).toEqual([]);
  });

  it('checks containment, then runs the managed probe', async () => {
    const { deps: startup, managed } = deps(unattendedDb());
    await startupChecks(startup);
    expect(managed.calls).toEqual(['containment', 'probe']);
  });

  it('runs no probe when containment fails, and keeps its exit code', async () => {
    const { deps: startup, managed } = deps(unattendedDb());
    managed.containmentError = new StartupError('GITHUB_READ_TOKEN can write to owner/repo', true);
    const error = await startupChecks(startup).catch((caught: unknown) => caught);
    expect(exitCodeFor(error)).toBe(78);
    expect(managed.calls).toEqual(['containment']);
  });

  it('checks the role models before the probe', async () => {
    const db = new FakeDb();
    db.roles = [role({ model: 'mystery-model' })];
    const { deps: startup, managed } = deps(db);
    await expect(startupChecks(startup)).rejects.toThrow('no price in PRICE_TABLE_JSON for Builder A (mystery-model)');
    expect(managed.calls).toHaveLength(0);
    expect(db.ledger).toHaveLength(0);
  });
});

describe('unattendedStartup', () => {
  it('refuses, exit 78, an adapter that is not the managed one: the dispatcher never runs a local agent', async () => {
    for (const mode of ['unattended', 'attended'] as const) {
      const adapter = new FakeAdapter(async () => {}, { mode });
      const error = await unattendedStartup({ db: unattendedDb(), adapter, config, log: silent }).catch((caught: unknown) => caught);
      expect(error).toEqual(new StartupError('the dispatcher runs only on the managed adapter, which this process did not build', true));
      expect(exitCodeFor(error)).toBe(78);
    }
    const attended = Object.assign(new FakeAdapter(async () => {}, { mode: 'attended' }), { managed: new ManagedStub() });
    const error = await unattendedStartup({ db: unattendedDb(), adapter: attended, config, log: silent }).catch((caught: unknown) => caught);
    expect(error).toEqual(new StartupError('the dispatcher runs only on the managed adapter, which this process did not build', true));
    expect(exitCodeFor(error)).toBe(78);
  });

  it('passes a probe failure through with its own exit code', async () => {
    const { deps: startup, managed } = deps(unattendedDb());
    managed.probeError = new StartupError('the probe session could not be created: overloaded', false);
    const error = await unattendedStartup(startup).catch((caught: unknown) => caught);
    expect(exitCodeFor(error)).toBe(1);
    expect(managed.calls).toEqual(['containment', 'probe']);
  });
});

describe('checkRoleModels', () => {
  it('passes when every role with write access has a priced model, falling back to MODEL_BUILDER', async () => {
    const db = new FakeDb();
    db.roles = [role(), role({ id: 'role-2', name: 'Builder B', model: '' }), role({ id: 'role-host', name: 'Host', model: 'host-only-model', write_access: false })];
    await expect(checkRoleModels(db, config)).resolves.toBeUndefined();
  });

  it('refuses to start, exit 78, naming every writing role whose model has no price', async () => {
    const db = new FakeDb();
    db.roles = [role({ model: 'mystery-model' }), role({ id: 'role-2', name: 'Game Director', model: 'other-model' })];
    const error = await checkRoleModels(db, config).catch((caught: unknown) => caught);
    expect(error).toEqual(new StartupError('no price in PRICE_TABLE_JSON for Builder A (mystery-model), Game Director (other-model)', true));
    expect(exitCodeFor(error)).toBe(78);
    const unpricedBuilder = await checkRoleModels(Object.assign(new FakeDb(), { roles: [role({ model: '' })] }), { ...config, modelBuilder: 'unpriced-builder' }).catch((caught: unknown) => caught);
    expect(unpricedBuilder).toEqual(new StartupError('no price in PRICE_TABLE_JSON for Builder A (unpriced-builder)', true));
  });
});
