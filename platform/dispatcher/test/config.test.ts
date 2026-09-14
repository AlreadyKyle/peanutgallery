import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type Env } from '../src/config.js';

const REPO = '/repo';

const FULL: Env = {
  GITHUB_REPO: 'owner/repo',
  SUPABASE_URL: 'https://db.local',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  GITHUB_TOKEN: 'github-token',
  NETLIFY_AUTH_TOKEN: 'netlify-token',
  NETLIFY_SITE_ID_SEED: 'site-seed',
  NETLIFY_SITE_ID_PLATFORM: 'site-platform',
  MODEL_BUILDER: 'builder-class',
  PRICE_TABLE_JSON: JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }),
};

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig(FULL, REPO);
    expect(config).toMatchObject({
      repoRoot: REPO,
      agentMode: 'attended',
      githubRepo: 'owner/repo',
      poolDailyCapUsd: 100,
      cardMaxUsd: 25,
      sessionMaxTurns: 60,
      agentHourlyRateUsd: 5,
      tickMs: 60_000,
      worktreeRoot: path.join(REPO, '.worktrees'),
      maxConcurrency: 1,
      schedulerEnabled: true,
      claudeBin: 'claude',
      boardSessionTtlMin: 3,
      studioAnthropicApiKey: null,
    });
    expect(Object.keys(config.priceTable)).toEqual(['builder-class']);
  });

  it('reads every override', () => {
    const config = loadConfig(
      {
        ...FULL,
        AGENT_MODE: 'unattended',
        STUDIO_ANTHROPIC_API_KEY: 'studio-key',
        POOL_DAILY_CAP_USD: '40',
        CARD_MAX_USD: '10',
        SESSION_MAX_TURNS: '30',
        AGENT_HOURLY_RATE_USD: '4',
        DISPATCHER_TICK_MS: '5000',
        DISPATCHER_WORKTREE_ROOT: '/var/lib/backseat/worktrees',
        DISPATCHER_MAX_CONCURRENCY: '2',
        DISPATCHER_SCHEDULER: 'off',
        CLAUDE_BIN: '/opt/claude',
        BOARD_SESSION_TTL_MIN: '5',
      },
      REPO,
    );
    expect(config).toMatchObject({
      agentMode: 'unattended',
      poolDailyCapUsd: 40,
      cardMaxUsd: 10,
      sessionMaxTurns: 30,
      agentHourlyRateUsd: 4,
      tickMs: 5000,
      worktreeRoot: '/var/lib/backseat/worktrees',
      maxConcurrency: 2,
      schedulerEnabled: false,
      claudeBin: '/opt/claude',
      boardSessionTtlMin: 5,
      studioAnthropicApiKey: 'studio-key',
    });
  });

  it('names the missing or malformed value', () => {
    const without = (name: string): Env => ({ ...FULL, [name]: '' });
    for (const name of Object.keys(FULL)) {
      expect(() => loadConfig(without(name), REPO), name).toThrow(name);
    }
    expect(() => loadConfig({ ...FULL, GITHUB_REPO: 'not-a-repo' }, REPO)).toThrow(new ConfigError('GITHUB_REPO must be owner/repo'));
    expect(() => loadConfig({ ...FULL, AGENT_MODE: 'manual' }, REPO)).toThrow('AGENT_MODE must be attended or unattended');
    expect(() => loadConfig({ ...FULL, DISPATCHER_SCHEDULER: 'maybe' }, REPO)).toThrow('DISPATCHER_SCHEDULER must be on or off');
    expect(() => loadConfig({ ...FULL, CARD_MAX_USD: '-1' }, REPO)).toThrow('CARD_MAX_USD must be a non-negative number');
    expect(() => loadConfig({ ...FULL, CARD_MAX_USD: 'ten' }, REPO)).toThrow('CARD_MAX_USD must be a non-negative number');
    expect(() => loadConfig({ ...FULL, SESSION_MAX_TURNS: '0' }, REPO)).toThrow('SESSION_MAX_TURNS must be a positive integer');
    expect(() => loadConfig({ ...FULL, DISPATCHER_TICK_MS: '1.5' }, REPO)).toThrow('DISPATCHER_TICK_MS must be a positive integer');
    expect(() => loadConfig({ ...FULL, PRICE_TABLE_JSON: '{}' }, REPO)).toThrow('PRICE_TABLE_JSON lists no models');
  });
});

describe('the studio key', () => {
  it('is required in unattended mode', () => {
    expect(() => loadConfig({ ...FULL, AGENT_MODE: 'unattended' }, REPO)).toThrow(new ConfigError('STUDIO_ANTHROPIC_API_KEY is not set'));
    expect(() => loadConfig({ ...FULL, AGENT_MODE: 'unattended', STUDIO_ANTHROPIC_API_KEY: '   ' }, REPO)).toThrow('STUDIO_ANTHROPIC_API_KEY');
  });

  it('is read in unattended mode', () => {
    const config = loadConfig({ ...FULL, AGENT_MODE: 'unattended', STUDIO_ANTHROPIC_API_KEY: 'studio-key', ANTHROPIC_API_KEY: 'founder-key' }, REPO);
    expect(config.studioAnthropicApiKey).toBe('studio-key');
  });

  it('must differ from the founder key', () => {
    const env = { ...FULL, STUDIO_ANTHROPIC_API_KEY: 'same-key', ANTHROPIC_API_KEY: 'same-key' };
    expect(() => loadConfig({ ...env, AGENT_MODE: 'unattended' }, REPO)).toThrow(new ConfigError('STUDIO_ANTHROPIC_API_KEY must differ from ANTHROPIC_API_KEY'));
    expect(() => loadConfig(env, REPO)).toThrow('STUDIO_ANTHROPIC_API_KEY must differ from ANTHROPIC_API_KEY');
  });

  it('is null and ignored in attended mode', () => {
    expect(loadConfig({ ...FULL, STUDIO_ANTHROPIC_API_KEY: 'studio-key' }, REPO).studioAnthropicApiKey).toBeNull();
    expect(loadConfig({ ...FULL, AGENT_MODE: 'attended', STUDIO_ANTHROPIC_API_KEY: '' }, REPO).studioAnthropicApiKey).toBeNull();
  });
});
