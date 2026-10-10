import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DispatcherConfig } from '../src/config.js';
import { StartupError } from '../src/exit-code.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { checkRoleModels, startupChecks } from '../src/startup.js';
import { resolveRoleModel, roleModelTokens } from '../src/role-model.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { FakeDb, role } from './helpers/fake-db.js';

// The checkout these tests run from, whose platform/agents specs the dispatcher reads.
const CODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const RATES = { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 };
const PRICE_TABLE = parsePriceTable(JSON.stringify({ 'builder-class': RATES, 'director-class': RATES }));

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-role-model-'));
  await mkdir(path.join(dir, 'platform', 'agents'), { recursive: true });
  await writeFile(path.join(dir, 'platform', 'agents', 'builder.json'), JSON.stringify({ name: 'Builder A', model: 'MODEL_BUILDER' }), 'utf8');
  await writeFile(path.join(dir, 'platform', 'agents', 'director.json'), JSON.stringify({ name: 'Studio Head', model: 'MODEL_DIRECTOR' }), 'utf8');
  await writeFile(path.join(dir, 'platform', 'agents', 'broken.json'), '{ not json', 'utf8');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function config(overrides: Partial<DispatcherConfig> = {}): DispatcherConfig {
  return {
    codeRoot: dir,
    codeReadonly: false,
    repoRoot: dir,
    agentMode: 'attended',
    supabaseUrl: 'https://db.local',
    supabaseServiceRoleKey: 'service-role',
    githubToken: 'github_pat_fake-token',
    githubRepo: 'owner/repo',
    netlifyAuthToken: 'netlify-token',
    netlifySiteIdSeed: 'site-seed',
    netlifySiteIdPlatform: 'site-platform',
    modelBuilder: 'builder-class',
    modelDirector: 'director-class',
    modelHost: null,
    priceTable: PRICE_TABLE,
    poolDailyCapUsd: 100,
    cardMaxUsd: 25,
    visualReviewMaxUsd: 1,
    sessionMaxTurns: 60,
    sessionMaxMinutes: 60,
    agentHourlyRateUsd: 5,
    tickMs: 60_000,
    worktreeRoot: `${dir}-worktrees`,
    maxConcurrency: 1,
    claudeBin: 'claude',
    boardSessionTtlMin: 3,
    studioAnthropicApiKey: null,
    healthcheckUrl: null,
    ntfyTopicUrl: null,
    discordWebhookShips: null,
    discordWebhookWeekly: null,
    publicSiteUrl: 'https://site.test',
    ...overrides,
  };
}

function capture(): { log: ReturnType<typeof createLogger>; lines: () => Array<Record<string, unknown>> } {
  const out: string[] = [];
  const log = createLogger(new Writable({ write: (chunk, _enc, cb) => (out.push(String(chunk)), cb()) }));
  return { log, lines: () => out.join('').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('roleModelTokens', () => {
  it("reads every role's token from this repository's agent specs", () => {
    const tokens = roleModelTokens(CODE_ROOT);
    expect(tokens.size).toBe(16);
    expect(tokens.get('Builder A')).toBe('MODEL_BUILDER');
    expect(tokens.get('Biz Dev')).toBe('MODEL_BUILDER');
    expect(tokens.get('Game Designer')).toBe('MODEL_DIRECTOR');
    expect(tokens.get('Studio Head')).toBe('MODEL_DIRECTOR');
    expect(tokens.get('Game Director')).toBe('MODEL_DIRECTOR');
    expect(tokens.get('Host')).toBe('MODEL_HOST');
  });

  it('skips a file that is not a spec, and gives nothing for a folder that is not there', () => {
    expect([...roleModelTokens(dir).keys()].sort()).toEqual(['Builder A', 'Studio Head']);
    expect(roleModelTokens(path.join(dir, 'nowhere')).size).toBe(0);
  });
});

describe('resolveRoleModel', () => {
  it("takes the model from the env value of the role's token, over a stale roles.model", () => {
    expect(resolveRoleModel({ name: 'Studio Head', model: 'claude-sonnet-5' }, config())).toEqual({ model: 'director-class', source: 'env', token: 'MODEL_DIRECTOR' });
    expect(resolveRoleModel({ name: 'Builder A', model: '' }, config())).toEqual({ model: 'builder-class', source: 'env', token: 'MODEL_BUILDER' });
  });

  it('falls back to roles.model when the env leaves the token unset, then to MODEL_BUILDER', () => {
    expect(resolveRoleModel({ name: 'Studio Head', model: 'seeded-model' }, config({ modelDirector: null }))).toEqual({ model: 'seeded-model', source: 'role', token: 'MODEL_DIRECTOR' });
    expect(resolveRoleModel({ name: 'Unknown', model: '' }, config())).toEqual({ model: 'builder-class', source: 'builder', token: null });
  });

  it('resolves a roles.model that is itself a token', () => {
    expect(resolveRoleModel({ name: 'Unknown', model: 'MODEL_DIRECTOR' }, config())).toEqual({ model: 'director-class', source: 'env', token: 'MODEL_DIRECTOR' });
    expect(resolveRoleModel({ name: 'Unknown', model: 'MODEL_HOST' }, config())).toEqual({ model: 'builder-class', source: 'builder', token: 'MODEL_HOST' });
  });
});

describe('checkRoleModels', () => {
  it('checks the price of the model each writing role resolves to, and logs a roles.model that /team shows wrongly', async () => {
    const db = new FakeDb();
    db.roles = [role({ name: 'Studio Head', model: 'claude-sonnet-5' }), role({ id: 'b', name: 'Builder A', model: 'builder-class' }), role({ id: 'h', name: 'Host', model: 'unpriced', write_access: false })];
    const { log, lines } = capture();
    await checkRoleModels(db, config(), log);
    expect(lines().map((line) => line.msg)).toEqual(['Studio Head runs on director-class from MODEL_DIRECTOR, but roles.model is claude-sonnet-5; re-seed the roles so /team shows it']);
  });

  it('refuses a role a role job runs whose resolved model has no price, the Game Director without write access included', async () => {
    const db = new FakeDb();
    db.roles = [role({ id: 'd', name: 'Game Director', model: 'MODEL_DIRECTOR', write_access: false }), role({ id: 'h', name: 'Host', model: 'MODEL_DIRECTOR', write_access: false })];
    await expect(checkRoleModels(db, config({ modelDirector: 'unpriced-director' }))).rejects.toThrow(new StartupError('no price in PRICE_TABLE_JSON for Game Director (unpriced-director)', true));
  });

  it('refuses a writing role whose resolved model has no price', async () => {
    const db = new FakeDb();
    db.roles = [role({ name: 'Studio Head', model: 'claude-sonnet-5' })];
    await expect(checkRoleModels(db, config({ modelDirector: 'unpriced-director' }))).rejects.toThrow(new StartupError('no price in PRICE_TABLE_JSON for Studio Head (unpriced-director)', true));
  });
});

describe('startupChecks in attended mode', () => {
  it('warns about a GITHUB_TOKEN that is not fine-grained, and runs no probe', async () => {
    const db = new FakeDb();
    db.roles = [role({ name: 'Builder A' })];
    const { log, lines } = capture();
    await startupChecks({
      db,
      adapter: new FakeAdapter(async () => undefined),
      config: config({ githubToken: 'gho_fake-token' }),
      log,
    });
    expect(lines()).toEqual([
      expect.objectContaining({ level: 'warn', msg: 'GITHUB_TOKEN is not a fine-grained token (github_pat_...); create one for this repository alone as BOARD-SETUP.md describes', mode: 'attended' }),
    ]);
  });
});
