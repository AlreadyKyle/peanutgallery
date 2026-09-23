import { describe, expect, it } from 'vitest';
import { ConfigError, defaultWorktreeRoot, githubTokenProblem, loadConfig, type Env } from '../src/config.js';

const REPO = '/repo';

const FULL: Env = {
  GITHUB_REPO: 'owner/repo',
  SUPABASE_URL: 'https://db.local',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  // A fine-grained token's shape, too short to be one (secret-scan.sh).
  GITHUB_TOKEN: 'github_pat_fake-token',
  NETLIFY_AUTH_TOKEN: 'netlify-token',
  NETLIFY_SITE_ID_SEED: 'site-seed',
  NETLIFY_SITE_ID_PLATFORM: 'site-platform',
  MODEL_BUILDER: 'builder-class',
  PRICE_TABLE_JSON: JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } }),
};

// What unattended mode needs beyond FULL: the managed ids and the read-only token, with both GitHub
// tokens fine-grained.
const MANAGED: Env = {
  GITHUB_TOKEN: 'github_pat_-fixture-write',
  GITHUB_READ_TOKEN: 'github_pat_-fixture-read',
  MANAGED_AGENT_ID: 'agent_fixture',
  MANAGED_AGENT_VERSION: '3',
  MANAGED_ENVIRONMENT_ID: 'env_fixture',
};

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig(FULL, REPO);
    expect(config).toMatchObject({
      codeRoot: REPO,
      codeReadonly: false,
      repoRoot: REPO,
      agentMode: 'attended',
      githubRepo: 'owner/repo',
      poolDailyCapUsd: 100,
      cardMaxUsd: 25,
      sessionMaxTurns: 60,
      agentHourlyRateUsd: 5,
      tickMs: 60_000,
      worktreeRoot: '/repo-worktrees',
      maxConcurrency: 1,
      claudeBin: 'claude',
      boardSessionTtlMin: 3,
      sessionMaxMinutes: 60,
      modelDirector: null,
      modelHost: null,
      studioAnthropicApiKey: null,
      healthcheckUrl: null,
      ntfyTopicUrl: null,
    });
    expect(Object.keys(config.priceTable)).toEqual(['builder-class']);
  });

  it('reads every override', () => {
    const config = loadConfig(
      {
        ...FULL,
        ...MANAGED,
        AGENT_MODE: 'unattended',
        STUDIO_ANTHROPIC_API_KEY: 'studio-key',
        POOL_DAILY_CAP_USD: '40',
        CARD_MAX_USD: '10',
        SESSION_MAX_TURNS: '30',
        AGENT_HOURLY_RATE_USD: '4',
        DISPATCHER_TICK_MS: '5000',
        DISPATCHER_WORKTREE_ROOT: '/var/lib/backseat/worktrees',
        DISPATCHER_MAX_CONCURRENCY: '2',
        CLAUDE_BIN: '/opt/claude',
        BOARD_SESSION_TTL_MIN: '5',
        SESSION_MAX_MINUTES: '90',
        MODEL_DIRECTOR: 'builder-class',
        MODEL_HOST: 'builder-class',
        HEALTHCHECK_URL: 'https://hc-ping.com/check-id',
        NTFY_TOPIC_URL: 'https://ntfy.sh/topic-name',
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
      claudeBin: '/opt/claude',
      boardSessionTtlMin: 5,
      sessionMaxMinutes: 90,
      modelDirector: 'builder-class',
      modelHost: 'builder-class',
      studioAnthropicApiKey: 'studio-key',
      healthcheckUrl: 'https://hc-ping.com/check-id',
      ntfyTopicUrl: 'https://ntfy.sh/topic-name',
    });
  });

  it('names the missing or malformed value', () => {
    const without = (name: string): Env => ({ ...FULL, [name]: '' });
    for (const name of Object.keys(FULL)) {
      expect(() => loadConfig(without(name), REPO), name).toThrow(name);
    }
    expect(() => loadConfig({ ...FULL, GITHUB_REPO: 'not-a-repo' }, REPO)).toThrow(new ConfigError('GITHUB_REPO must be owner/repo'));
    expect(() => loadConfig({ ...FULL, AGENT_MODE: 'manual' }, REPO)).toThrow('AGENT_MODE must be attended or unattended');
    expect(() => loadConfig({ ...FULL, CARD_MAX_USD: '-1' }, REPO)).toThrow('CARD_MAX_USD must be a non-negative number');
    expect(() => loadConfig({ ...FULL, CARD_MAX_USD: 'ten' }, REPO)).toThrow('CARD_MAX_USD must be a non-negative number');
    expect(() => loadConfig({ ...FULL, SESSION_MAX_TURNS: '0' }, REPO)).toThrow('SESSION_MAX_TURNS must be a positive integer');
    expect(() => loadConfig({ ...FULL, DISPATCHER_TICK_MS: '1.5' }, REPO)).toThrow('DISPATCHER_TICK_MS must be a positive integer');
    expect(() => loadConfig({ ...FULL, PRICE_TABLE_JSON: '{}' }, REPO)).toThrow('PRICE_TABLE_JSON lists no models');
    expect(() => loadConfig({ ...FULL, HEALTHCHECK_URL: 'http://hc-ping.com/check-id' }, REPO)).toThrow('HEALTHCHECK_URL must be an https URL');
    expect(() => loadConfig({ ...FULL, NTFY_TOPIC_URL: 'ntfy topic' }, REPO)).toThrow('NTFY_TOPIC_URL must be an https URL');
    expect(() => loadConfig({ ...FULL, SESSION_MAX_MINUTES: '0' }, REPO)).toThrow('SESSION_MAX_MINUTES must be a positive integer');
  });

  it('refuses a model with no row in the price table', () => {
    for (const name of ['MODEL_BUILDER', 'MODEL_DIRECTOR', 'MODEL_HOST']) {
      expect(() => loadConfig({ ...FULL, [name]: 'unpriced-model' }, REPO), name).toThrow(new ConfigError(`${name} has no row in PRICE_TABLE_JSON`));
    }
    expect(loadConfig({ ...FULL, MODEL_DIRECTOR: '  ', MODEL_HOST: '' }, REPO)).toMatchObject({ modelDirector: null, modelHost: null });
  });
});

describe('the code, repository and worktree roots', () => {
  const VPS = {
    DISPATCHER_CODE_ROOT: '/opt/peanutgallery',
    DISPATCHER_REPO_ROOT: '/srv/peanutgallery',
    DISPATCHER_WORKTREE_ROOT: '/srv/peanutgallery-worktrees',
    DISPATCHER_CODE_READONLY: 'required',
  };

  it('reads the roots dispatcher.service sets', () => {
    expect(loadConfig({ ...FULL, ...VPS }, '/opt/peanutgallery')).toMatchObject({
      codeRoot: '/opt/peanutgallery',
      codeReadonly: true,
      repoRoot: '/srv/peanutgallery',
      worktreeRoot: '/srv/peanutgallery-worktrees',
    });
  });

  it('resolves a relative repository root against the code root and a relative worktree root against the repository', () => {
    expect(loadConfig({ ...FULL, DISPATCHER_REPO_ROOT: '../work', DISPATCHER_WORKTREE_ROOT: '../trees' }, REPO)).toMatchObject({
      codeRoot: REPO,
      repoRoot: '/work',
      worktreeRoot: '/trees',
    });
    expect(loadConfig({ ...FULL, DISPATCHER_CODE_READONLY: 'off' }, REPO).codeReadonly).toBe(false);
  });

  it('puts card worktrees beside the clone by default, outside it', () => {
    expect(defaultWorktreeRoot('/Users/board/peanutgallery')).toBe('/Users/board/peanutgallery-worktrees');
    expect(loadConfig(FULL, '/Users/board/peanutgallery').worktreeRoot).toBe('/Users/board/peanutgallery-worktrees');
    expect(loadConfig({ ...FULL, DISPATCHER_REPO_ROOT: '../work' }, REPO).worktreeRoot).toBe('/work-worktrees');
  });

  it('refuses a worktree root inside the clone, in every mode', () => {
    const refusal = new ConfigError('DISPATCHER_WORKTREE_ROOT must be outside the repository clone /repo; leave it unset for /repo-worktrees');
    expect(() => loadConfig({ ...FULL, DISPATCHER_WORKTREE_ROOT: '.worktrees' }, REPO)).toThrow(refusal);
    expect(() => loadConfig({ ...FULL, DISPATCHER_WORKTREE_ROOT: '/repo/.worktrees' }, REPO)).toThrow(refusal);
    expect(() => loadConfig({ ...FULL, DISPATCHER_WORKTREE_ROOT: '.' }, REPO)).toThrow(refusal);
    expect(() => loadConfig({ ...FULL, AGENT_MODE: 'unattended', STUDIO_ANTHROPIC_API_KEY: 'studio-key', DISPATCHER_WORKTREE_ROOT: '/repo/trees' }, REPO)).toThrow(refusal);
    expect(loadConfig({ ...FULL, DISPATCHER_WORKTREE_ROOT: '/repo-other/trees' }, REPO).worktreeRoot).toBe('/repo-other/trees');
  });

  it('refuses a code root other than the one the process runs from', () => {
    expect(() => loadConfig({ ...FULL, ...VPS }, '/srv/peanutgallery')).toThrow(
      new ConfigError('DISPATCHER_CODE_ROOT is /opt/peanutgallery but the dispatcher runs from /srv/peanutgallery'),
    );
  });

  it('refuses an unknown read-only setting', () => {
    expect(() => loadConfig({ ...FULL, DISPATCHER_CODE_READONLY: 'yes' }, REPO)).toThrow(new ConfigError('DISPATCHER_CODE_READONLY must be required or off'));
  });

  it('refuses a repository or worktree root inside a read-only code root', () => {
    expect(() => loadConfig({ ...FULL, DISPATCHER_CODE_READONLY: 'required' }, REPO)).toThrow(
      new ConfigError('DISPATCHER_REPO_ROOT must be outside the code root when DISPATCHER_CODE_READONLY is required'),
    );
    expect(() => loadConfig({ ...FULL, ...VPS, DISPATCHER_WORKTREE_ROOT: '/opt/peanutgallery/.worktrees' }, '/opt/peanutgallery')).toThrow(
      new ConfigError('DISPATCHER_WORKTREE_ROOT must be outside the code root when DISPATCHER_CODE_READONLY is required'),
    );
  });
});

describe('the GitHub token', () => {
  it('names a token that is not fine-grained', () => {
    expect(githubTokenProblem('github_pat_fake-token')).toBeNull();
    for (const token of ['gho_fake-token', 'ghp_fake-token', 'plain-token']) {
      expect(githubTokenProblem(token)).toBe('GITHUB_TOKEN is not a fine-grained token (github_pat_...); create one for this repository alone as docs/BOARD-SETUP.md describes');
    }
  });

  it('refuses a gh sign-in or classic token in unattended mode', () => {
    for (const token of ['gho_fake-token', 'ghp_fake-token']) {
      expect(() => loadConfig({ ...FULL, AGENT_MODE: 'unattended', STUDIO_ANTHROPIC_API_KEY: 'studio-key', GITHUB_TOKEN: token }, REPO)).toThrow(
        new ConfigError('GITHUB_TOKEN is not a fine-grained token (github_pat_...); create one for this repository alone as docs/BOARD-SETUP.md describes'),
      );
    }
    expect(loadConfig({ ...FULL, ...MANAGED, AGENT_MODE: 'unattended', STUDIO_ANTHROPIC_API_KEY: 'studio-key' }, REPO).githubToken).toBe('github_pat_-fixture-write');
  });

  it('accepts one in attended mode, where startup warns instead', () => {
    expect(loadConfig({ ...FULL, GITHUB_TOKEN: 'gho_fake-token' }, REPO).githubToken).toBe('gho_fake-token');
  });
});

describe('the studio key', () => {
  it('is required in unattended mode', () => {
    expect(() => loadConfig({ ...FULL, AGENT_MODE: 'unattended' }, REPO)).toThrow(new ConfigError('STUDIO_ANTHROPIC_API_KEY is not set'));
    expect(() => loadConfig({ ...FULL, AGENT_MODE: 'unattended', STUDIO_ANTHROPIC_API_KEY: '   ' }, REPO)).toThrow('STUDIO_ANTHROPIC_API_KEY');
  });

  it('is read in unattended mode', () => {
    const config = loadConfig({ ...FULL, ...MANAGED, AGENT_MODE: 'unattended', STUDIO_ANTHROPIC_API_KEY: 'studio-key', ANTHROPIC_API_KEY: 'founder-key' }, REPO);
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

describe('the managed agent settings', () => {
  const unattended: Env = { ...FULL, ...MANAGED, AGENT_MODE: 'unattended', STUDIO_ANTHROPIC_API_KEY: 'studio-key' };

  it('are read in unattended mode', () => {
    expect(loadConfig(unattended, REPO).managed).toEqual({ agentId: 'agent_fixture', agentVersion: 3, environmentId: 'env_fixture', readToken: 'github_pat_-fixture-read' });
  });

  it('are required in unattended mode, one by one', () => {
    for (const name of ['GITHUB_READ_TOKEN', 'MANAGED_AGENT_ID', 'MANAGED_AGENT_VERSION', 'MANAGED_ENVIRONMENT_ID']) {
      expect(() => loadConfig({ ...unattended, [name]: '' }, REPO), name).toThrow(new ConfigError(`${name} is not set`));
    }
    expect(() => loadConfig({ ...unattended, MANAGED_AGENT_VERSION: '2.5' }, REPO)).toThrow('MANAGED_AGENT_VERSION must be a positive integer');
  });

  it('refuse a read token equal to the write token, in either mode', () => {
    expect(() => loadConfig({ ...unattended, GITHUB_READ_TOKEN: MANAGED.GITHUB_TOKEN }, REPO)).toThrow(new ConfigError('GITHUB_READ_TOKEN must differ from GITHUB_TOKEN: sessions clone with a token that cannot write'));
    expect(() => loadConfig({ ...FULL, GITHUB_READ_TOKEN: FULL.GITHUB_TOKEN }, REPO)).toThrow('GITHUB_READ_TOKEN must differ from GITHUB_TOKEN');
  });

  it('refuse a GitHub token that is not fine-grained in unattended mode', () => {
    expect(() => loadConfig({ ...unattended, GITHUB_TOKEN: 'gho_oauth_fixture' }, REPO)).toThrow('GITHUB_TOKEN is not a fine-grained token (github_pat_...)');
    expect(() => loadConfig({ ...unattended, GITHUB_READ_TOKEN: 'ghp_classic_fixture' }, REPO)).toThrow('GITHUB_READ_TOKEN must be a fine-grained personal access token');
  });

  it('are null and not required in attended mode', () => {
    expect(loadConfig(FULL, REPO).managed).toBeNull();
  });
});
