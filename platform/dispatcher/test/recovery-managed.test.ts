// Recovery with Managed Agents sessions left open by a previous process: they are closed, and metered,
// before any building card is paused.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClosedSessions } from '../src/adapters/types.js';
import type { DispatcherConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { recoverOrphans, type RecoveryDeps } from '../src/recovery.js';
import { AGENT_EMAIL, git } from '../src/worktree.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb, NOW, card } from './helpers/fake-db.js';

const silent = createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() }));
let dir: string;
let config: DispatcherConfig;
const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-recovery-managed-'));
  process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
  const repo = path.join(dir, 'repo');
  await git(['init', '-q', '--initial-branch=main', repo], dir);
  await writeFile(path.join(repo, 'README.md'), 'x\n', 'utf8');
  await git(['add', '-A'], repo);
  await git(['-c', 'user.name=Dispatcher test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'initial'], repo);
  config = {
    codeRoot: repo,
    codeReadonly: false,
    repoRoot: repo,
    agentMode: 'unattended',
    supabaseUrl: 'https://db.local',
    supabaseServiceRoleKey: 'service-role',
    githubToken: 'github_pat_-write',
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
    worktreeRoot: path.join(dir, 'worktrees'),
    maxConcurrency: 1,
    claudeBin: 'claude',
    boardSessionTtlMin: 3,
    studioAnthropicApiKey: 'studio-key',
    healthcheckUrl: null,
    ntfyTopicUrl: null,
    discordWebhookShips: null,
    discordWebhookWeekly: null,
    publicSiteUrl: 'https://site.test',
  };
});

afterAll(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(dir, { recursive: true, force: true });
});

const settledCard = card({ id: 'aaaaaaaa-0000-4000-8000-000000000001', stage: 'building', branch: 'card/aaaaaaaa-config' });
const unsettledCard = card({ id: 'bbbbbbbb-0000-4000-8000-000000000002', stage: 'building', branch: null });

function deps(db: FakeDb, alert: RecordingAlerter, closeSessions: RecoveryDeps['closeSessions']): RecoveryDeps {
  return {
    db,
    config,
    log: silent,
    alert,
    running: new Map(),
    now: () => NOW,
    resume: async () => undefined,
    lookupMerge: async () => null,
    closeSessions,
  };
}

describe('recoverOrphans with managed sessions', () => {
  it('closes and meters the sessions before pausing, so actual_usd includes them, and names a stored patch', async () => {
    const db = new FakeDb();
    db.cards = [{ ...settledCard }, { ...unsettledCard }];
    const alert = new RecordingAlerter();
    const order: string[] = [];
    const closeSessions = async () => {
      order.push('close');
      // What the adapter's settle writes for the card's orphan session.
      await db.recordUsage({ billed_to: 'studio', card_id: settledCard.id, role_id: 'role-builder-a', model: 'builder-class', input_tokens: 1000, cached_tokens: 0, output_tokens: 100, usd: 0.0045, request_id: 'sevt_orphan_1' });
      return new Map<string, ClosedSessions>([
        [settledCard.id, { sessionIds: ['sesn_1'], patchStored: true, unsettled: [] }],
        [unsettledCard.id, { sessionIds: ['sesn_2'], patchStored: false, unsettled: ['sesn_2: session sesn_2 was still running; it is left for recovery to settle'] }],
      ]);
    };
    const updateCardIf = db.updateCardIf.bind(db);
    db.updateCardIf = async (id, stages, patch) => {
      order.push(`pause ${id.slice(0, 8)}`);
      return updateCardIf(id, stages, patch);
    };
    await recoverOrphans(deps(db, alert, closeSessions));
    expect(order).toEqual(['close', 'pause aaaaaaaa', 'pause bbbbbbbb']);
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'dispatcher_restart', actual_usd: 0.0045 });
    expect(db.cards[1]).toMatchObject({ stage: 'paused', failing_check: 'session_unsettled' });
    expect(db.events[0]!.payload.message).toMatch(/its session had submitted a patch, which is stored; resuming the card re-gates it with no new session/);
    expect(db.events[1]!.payload).toMatchObject({ step: 'session_unsettled' });
    expect(alert.messages[1]).toMatch(/^Card bbbbbbbb was building when the dispatcher restarted and is paused as session_unsettled\./);
  });

  it('pauses every building card as session_unsettled, and alerts, when the sessions cannot be listed', async () => {
    const db = new FakeDb();
    db.cards = [{ ...settledCard }];
    const alert = new RecordingAlerter();
    await recoverOrphans(
      deps(db, alert, async () => {
        throw new Error('api.anthropic.com unreachable');
      }),
    );
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'session_unsettled' });
    expect(alert.messages[0]).toBe('The dispatcher could not list the Managed Agents sessions left open at startup (api.anthropic.com unreachable). Every building card is paused as session_unsettled.');
  });

  it('pauses a building card with no session as a plain restart', async () => {
    const db = new FakeDb();
    db.cards = [{ ...settledCard }];
    const alert = new RecordingAlerter();
    await recoverOrphans(deps(db, alert, async () => new Map()));
    expect(db.cards[0]).toMatchObject({ stage: 'paused', failing_check: 'dispatcher_restart' });
    expect(alert.messages).toEqual(['Card aaaaaaaa was building when the dispatcher restarted and is paused. Branch card/aaaaaaaa-config and any pull request are left open.']);
  });
});
