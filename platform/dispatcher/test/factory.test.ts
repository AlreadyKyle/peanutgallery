import { describe, expect, it } from 'vitest';
import { AttendedAdapter } from '../src/adapters/attended.js';
import { createAdapter } from '../src/adapters/factory.js';
import { UnattendedAdapter } from '../src/adapters/unattended.js';
import type { DispatcherConfig } from '../src/config.js';
import { parsePriceTable } from '../src/pricing.js';

const base: DispatcherConfig = {
  repoRoot: '/repo',
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
  worktreeRoot: '/repo/.worktrees',
  maxConcurrency: 1,
  schedulerEnabled: true,
  claudeBin: 'claude',
  boardSessionTtlMin: 3,
  studioAnthropicApiKey: null,
  healthcheckUrl: null,
  ntfyTopicUrl: null,
};

describe('createAdapter', () => {
  it('builds the attended adapter for attended mode', () => {
    const adapter = createAdapter(base);
    expect(adapter).toBeInstanceOf(AttendedAdapter);
    expect(adapter.mode).toBe('attended');
  });

  it('builds the unattended adapter for unattended mode when the studio key is set', () => {
    const adapter = createAdapter({ ...base, agentMode: 'unattended', studioAnthropicApiKey: 'studio-key' });
    expect(adapter).toBeInstanceOf(UnattendedAdapter);
    expect(adapter.mode).toBe('unattended');
  });

  it('refuses unattended mode without the studio key', () => {
    expect(() => createAdapter({ ...base, agentMode: 'unattended' })).toThrow('STUDIO_ANTHROPIC_API_KEY is required in unattended mode');
  });
});
