import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters/factory.js';
import { ManagedAdapter } from '../src/adapters/managed.js';
import { UnattendedAdapter } from '../src/adapters/unattended.js';
import type { DispatcherConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb } from './helpers/fake-db.js';
import { AGENT_ID, CODE_ROOT, ENVIRONMENT_ID, FakeManagedClient } from './helpers/fake-managed.js';

const base: DispatcherConfig = {
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
  priceTable: parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } })),
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
  studioAnthropicApiKey: null,
  healthcheckUrl: null,
  ntfyTopicUrl: null,
  discordWebhookShips: null,
  discordWebhookWeekly: null,
  publicSiteUrl: 'https://site.test',
};

describe('createAdapter', () => {
  const managed = { agentId: AGENT_ID, agentVersion: 3, environmentId: ENVIRONMENT_ID, readToken: 'github_pat_-fixture-read' };
  const unattended: DispatcherConfig = { ...base, codeRoot: CODE_ROOT, studioAnthropicApiKey: 'studio-key', managed };
  const adapterDeps = () => ({ db: new FakeDb(), alert: new RecordingAlerter(), log: createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() })), patches: null, client: new FakeManagedClient() });

  // docs/specs/unattended-roles.md, PR5: the dispatcher has one mode; only the hand-run tools build the
  // attended adapter.
  it('builds the managed adapter, reading the agent and environment files from the code root, whatever CLAUDE_BIN says', () => {
    const adapter = createAdapter({ ...unattended, claudeBin: '/nowhere/claude' }, adapterDeps());
    expect(adapter).toBeInstanceOf(UnattendedAdapter);
    expect(adapter).toBeInstanceOf(ManagedAdapter);
    expect(adapter.mode).toBe('unattended');
    expect(adapter.managed).toBe(adapter);
  });

  it('refuses a configuration without the studio key or the managed ids, as a hand-run tool loads one, rather than build an attended adapter', () => {
    expect(() => createAdapter({ ...unattended, studioAnthropicApiKey: null }, adapterDeps())).toThrow('STUDIO_ANTHROPIC_API_KEY is required: the dispatcher runs unattended only');
    expect(() => createAdapter({ ...unattended, managed: null }, adapterDeps())).toThrow('GITHUB_READ_TOKEN and the managed agent and environment ids are required: the dispatcher runs unattended only');
    expect(() => createAdapter(base, adapterDeps())).toThrow('STUDIO_ANTHROPIC_API_KEY is required');
  });
});
