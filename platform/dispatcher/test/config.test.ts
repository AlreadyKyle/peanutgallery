import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError, DRAFT_SESSION_MIN_USD, agentModeWarning, defaultWorktreeRoot, githubTokenProblem, loadConfig, loadHandRunConfig, type Env } from '../src/config.js';

const REPO = '/repo';

// What a hand-run tool's configuration needs (loadHandRunConfig): no studio key and no managed ids.
const BASE: Env = {
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

// What the dispatcher needs beyond BASE: the studio key, the managed ids and the read-only token, with
// both GitHub tokens fine-grained. The dispatcher runs unattended only (PLAN.md §10 decision 66).
const MANAGED: Env = {
  GITHUB_TOKEN: 'github_pat_-fixture-write',
  GITHUB_READ_TOKEN: 'github_pat_-fixture-read',
  MANAGED_AGENT_ID: 'agent_fixture',
  MANAGED_AGENT_VERSION: '3',
  MANAGED_ENVIRONMENT_ID: 'env_fixture',
  STUDIO_ANTHROPIC_API_KEY: 'studio-key',
};

const FULL: Env = { ...BASE, ...MANAGED };

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig(FULL, REPO);
    expect(config).toMatchObject({
      codeRoot: REPO,
      codeReadonly: false,
      repoRoot: REPO,
      githubRepo: 'owner/repo',
      poolDailyCapUsd: 100,
      cardMaxUsd: 25,
      visualReviewMaxUsd: 1,
      draftSessionMaxUsd: 0.75,
      sessionMaxTurns: 60,
      agentHourlyRateUsd: 5,
      tickMs: 60_000,
      worktreeRoot: '/repo-worktrees',
      maxConcurrency: 1,
      claudeBin: 'claude',
      sessionMaxMinutes: 60,
      modelDirector: null,
      modelHost: null,
      studioAnthropicApiKey: 'studio-key',
      healthcheckUrl: null,
      ntfyTopicUrl: null,
      discordWebhookShips: null,
      discordWebhookWeekly: null,
      publicSiteUrl: 'https://mobmachine.games',
    });
    expect(Object.keys(config.priceTable)).toEqual(['builder-class']);
  });

  it('reads every override', () => {
    const config = loadConfig(
      {
        ...FULL,
        POOL_DAILY_CAP_USD: '40',
        CARD_MAX_USD: '10',
        VISUAL_REVIEW_MAX_USD: '0.5',
        DRAFT_SESSION_MAX_USD: '0.5',
        SESSION_MAX_TURNS: '30',
        AGENT_HOURLY_RATE_USD: '4',
        DISPATCHER_TICK_MS: '5000',
        DISPATCHER_WORKTREE_ROOT: '/var/lib/backseat/worktrees',
        DISPATCHER_MAX_CONCURRENCY: '2',
        CLAUDE_BIN: '/opt/claude',
        SESSION_MAX_MINUTES: '90',
        MODEL_DIRECTOR: 'builder-class',
        MODEL_HOST: 'builder-class',
        HEALTHCHECK_URL: 'https://hc-ping.com/check-id',
        NTFY_TOPIC_URL: 'https://ntfy.sh/topic-name',
      },
      REPO,
    );
    expect(config).toMatchObject({
      poolDailyCapUsd: 40,
      cardMaxUsd: 10,
      visualReviewMaxUsd: 0.5,
      draftSessionMaxUsd: 0.5,
      sessionMaxTurns: 30,
      agentHourlyRateUsd: 4,
      tickMs: 5000,
      worktreeRoot: '/var/lib/backseat/worktrees',
      maxConcurrency: 2,
      claudeBin: '/opt/claude',
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

    expect(() => loadConfig({ ...FULL, CARD_MAX_USD: '-1' }, REPO)).toThrow('CARD_MAX_USD must be a non-negative number');
    expect(() => loadConfig({ ...FULL, CARD_MAX_USD: 'ten' }, REPO)).toThrow('CARD_MAX_USD must be a non-negative number');
    expect(() => loadConfig({ ...FULL, SESSION_MAX_TURNS: '0' }, REPO)).toThrow('SESSION_MAX_TURNS must be a positive integer');
    expect(() => loadConfig({ ...FULL, DISPATCHER_TICK_MS: '1.5' }, REPO)).toThrow('DISPATCHER_TICK_MS must be a positive integer');
    expect(() => loadConfig({ ...FULL, PRICE_TABLE_JSON: '{}' }, REPO)).toThrow('PRICE_TABLE_JSON lists no models');
    expect(() => loadConfig({ ...FULL, HEALTHCHECK_URL: 'http://hc-ping.com/check-id' }, REPO)).toThrow('HEALTHCHECK_URL must be an https URL');
    expect(() => loadConfig({ ...FULL, NTFY_TOPIC_URL: 'ntfy topic' }, REPO)).toThrow('NTFY_TOPIC_URL must be an https URL');
    expect(() => loadConfig({ ...FULL, SESSION_MAX_MINUTES: '0' }, REPO)).toThrow('SESSION_MAX_MINUTES must be a positive integer');
    expect(() => loadConfig({ ...FULL, VISUAL_REVIEW_MAX_USD: '0.05' }, REPO)).toThrow('VISUAL_REVIEW_MAX_USD must be at least 0.35');
    expect(() => loadConfig({ ...FULL, VISUAL_REVIEW_MAX_USD: 'one' }, REPO)).toThrow('VISUAL_REVIEW_MAX_USD must be a non-negative number');
    expect(() => loadConfig({ ...FULL, DRAFT_SESSION_MAX_USD: '0.2' }, REPO)).toThrow('DRAFT_SESSION_MAX_USD must be at least 0.35');
  });

  it('refuses a model with no row in the price table', () => {
    for (const name of ['MODEL_BUILDER', 'MODEL_DIRECTOR', 'MODEL_HOST']) {
      expect(() => loadConfig({ ...FULL, [name]: 'unpriced-model' }, REPO), name).toThrow(new ConfigError(`${name} has no row in PRICE_TABLE_JSON`));
    }
    expect(loadConfig({ ...FULL, MODEL_DIRECTOR: '  ', MODEL_HOST: '' }, REPO)).toMatchObject({ modelDirector: null, modelHost: null });
  });
});

// docs/specs/unattended-roles.md, PR5: the dispatcher has one mode. AGENT_MODE=attended, as an old
// .env still says, is warned about and otherwise ignored, so it never stops the process.
describe('AGENT_MODE, retired', () => {
  it('warns on AGENT_MODE=attended and otherwise ignores it: the configuration is the one without it', () => {
    const warned: string[] = [];
    const config = loadConfig({ ...FULL, AGENT_MODE: 'attended' }, REPO, (message) => warned.push(message));
    expect(warned).toEqual([
      'AGENT_MODE=attended is ignored: attended mode is retired and the dispatcher runs unattended only (PLAN.md §10 decision 66); remove AGENT_MODE from .env',
    ]);
    const quiet: string[] = [];
    expect(config).toEqual(loadConfig(FULL, REPO, (message) => quiet.push(message)));
    expect(quiet).toEqual([]);
    expect(config.studioAnthropicApiKey).toBe('studio-key');
    expect(config.managed).toMatchObject({ agentId: 'agent_fixture' });
  });

  it('still requires everything the dispatcher runs on, whatever AGENT_MODE says', () => {
    expect(() => loadConfig({ ...BASE, AGENT_MODE: 'attended' }, REPO, () => undefined)).toThrow(new ConfigError('STUDIO_ANTHROPIC_API_KEY is not set'));
    expect(() => loadConfig({ ...FULL, AGENT_MODE: 'attended', GITHUB_TOKEN: 'gho_fake-token' }, REPO, () => undefined)).toThrow('GITHUB_TOKEN is not a fine-grained token');
  });

  it('warns on any other value too, and says nothing for unattended or none', () => {
    expect(agentModeWarning({ AGENT_MODE: 'manual' })).toBe('AGENT_MODE=manual is ignored: the dispatcher runs unattended only (PLAN.md §10 decision 66); remove AGENT_MODE from .env');
    for (const value of [undefined, '', '  ', 'unattended', ' unattended ']) expect(agentModeWarning({ AGENT_MODE: value }), String(value)).toBeNull();
  });

  it('writes the warning to stderr when no warn is given', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      loadConfig({ ...FULL, AGENT_MODE: 'attended' }, REPO);
      expect(write).toHaveBeenCalledWith(expect.stringContaining('AGENT_MODE=attended is ignored'));
    } finally {
      write.mockRestore();
    }
  });
});

// The hand-run tools that still run attended on the founder's login (the replay eval, the probe's
// --attended run) load the same values with no studio key and no managed ids.
describe('loadHandRunConfig', () => {
  it('needs no studio key, managed ids or read token, and holds none', () => {
    const config = loadHandRunConfig(BASE, REPO);
    expect(config).toMatchObject({ studioAnthropicApiKey: null, managed: null, githubToken: 'github_pat_fake-token', claudeBin: 'claude' });
    expect(loadHandRunConfig({ ...FULL, AGENT_MODE: 'attended' }, REPO)).toMatchObject({ studioAnthropicApiKey: null, managed: null });
  });

  it('takes a GitHub token that is not fine-grained, since a person is running it', () => {
    expect(loadHandRunConfig({ ...BASE, GITHUB_TOKEN: 'gho_fake-token' }, REPO).githubToken).toBe('gho_fake-token');
  });

  it('still refuses a studio key equal to the founder key, a read token equal to the write token and a missing value', () => {
    expect(() => loadHandRunConfig({ ...BASE, STUDIO_ANTHROPIC_API_KEY: 'same-key', ANTHROPIC_API_KEY: 'same-key' }, REPO)).toThrow('STUDIO_ANTHROPIC_API_KEY must differ from ANTHROPIC_API_KEY');
    expect(() => loadHandRunConfig({ ...BASE, GITHUB_READ_TOKEN: BASE.GITHUB_TOKEN }, REPO)).toThrow('GITHUB_READ_TOKEN must differ from GITHUB_TOKEN');
    expect(() => loadHandRunConfig({ ...BASE, MODEL_BUILDER: '' }, REPO)).toThrow('MODEL_BUILDER is not set');
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

  it('refuses a worktree root inside the clone, for the dispatcher and a hand-run tool alike', () => {
    const refusal = new ConfigError('DISPATCHER_WORKTREE_ROOT must be outside the repository clone /repo; leave it unset for /repo-worktrees');
    expect(() => loadConfig({ ...FULL, DISPATCHER_WORKTREE_ROOT: '.worktrees' }, REPO)).toThrow(refusal);
    expect(() => loadConfig({ ...FULL, DISPATCHER_WORKTREE_ROOT: '/repo/.worktrees' }, REPO)).toThrow(refusal);
    expect(() => loadConfig({ ...FULL, DISPATCHER_WORKTREE_ROOT: '.' }, REPO)).toThrow(refusal);
    expect(() => loadHandRunConfig({ ...BASE, DISPATCHER_WORKTREE_ROOT: '/repo/trees' }, REPO)).toThrow(refusal);
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
      expect(githubTokenProblem(token)).toBe('GITHUB_TOKEN is not a fine-grained token (github_pat_...); create one for this repository alone as BOARD-SETUP.md describes');
    }
  });

  it('refuses a gh sign-in or classic token', () => {
    for (const token of ['gho_fake-token', 'ghp_fake-token']) {
      expect(() => loadConfig({ ...FULL, GITHUB_TOKEN: token }, REPO)).toThrow(
        new ConfigError('GITHUB_TOKEN is not a fine-grained token (github_pat_...); create one for this repository alone as BOARD-SETUP.md describes'),
      );
    }
    expect(loadConfig(FULL, REPO).githubToken).toBe('github_pat_-fixture-write');
  });
});

describe('the studio key', () => {
  it('is required', () => {
    expect(() => loadConfig({ ...FULL, STUDIO_ANTHROPIC_API_KEY: '' }, REPO)).toThrow(new ConfigError('STUDIO_ANTHROPIC_API_KEY is not set'));
    expect(() => loadConfig({ ...FULL, STUDIO_ANTHROPIC_API_KEY: '   ' }, REPO)).toThrow('STUDIO_ANTHROPIC_API_KEY');
  });

  it('is read', () => {
    const config = loadConfig({ ...FULL, ANTHROPIC_API_KEY: 'founder-key' }, REPO);
    expect(config.studioAnthropicApiKey).toBe('studio-key');
  });

  it('must differ from the founder key', () => {
    const env = { ...FULL, STUDIO_ANTHROPIC_API_KEY: 'same-key', ANTHROPIC_API_KEY: 'same-key' };
    expect(() => loadConfig(env, REPO)).toThrow(new ConfigError('STUDIO_ANTHROPIC_API_KEY must differ from ANTHROPIC_API_KEY'));
  });
});

describe('the managed agent settings', () => {
  const unattended: Env = FULL;

  it('are read', () => {
    expect(loadConfig(unattended, REPO).managed).toEqual({ agentId: 'agent_fixture', agentVersion: 3, environmentId: 'env_fixture', readToken: 'github_pat_-fixture-read' });
  });

  it('are required, one by one', () => {
    for (const name of ['GITHUB_READ_TOKEN', 'MANAGED_AGENT_ID', 'MANAGED_AGENT_VERSION', 'MANAGED_ENVIRONMENT_ID']) {
      expect(() => loadConfig({ ...unattended, [name]: '' }, REPO), name).toThrow(new ConfigError(`${name} is not set`));
    }
    expect(() => loadConfig({ ...unattended, MANAGED_AGENT_VERSION: '2.5' }, REPO)).toThrow('MANAGED_AGENT_VERSION must be a positive integer');
  });

  it('refuse a read token equal to the write token', () => {
    expect(() => loadConfig({ ...unattended, GITHUB_READ_TOKEN: MANAGED.GITHUB_TOKEN }, REPO)).toThrow(new ConfigError('GITHUB_READ_TOKEN must differ from GITHUB_TOKEN: sessions clone with a token that cannot write'));
  });

  it('refuse a GitHub token that is not fine-grained', () => {
    expect(() => loadConfig({ ...unattended, GITHUB_TOKEN: 'gho_oauth_fixture' }, REPO)).toThrow('GITHUB_TOKEN is not a fine-grained token (github_pat_...)');
    expect(() => loadConfig({ ...unattended, GITHUB_READ_TOKEN: 'ghp_classic_fixture' }, REPO)).toThrow('GITHUB_READ_TOKEN must be a fine-grained personal access token');
  });
});

// docs/specs/studio-reports.md: the two Discord webhooks, optional and checked, and the site's origin.
describe('the Discord webhooks and the public site', () => {
  const TOKEN = 'tok-FIXTURE_SecretPart-0123';
  const good = [
    `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`,
    `https://discordapp.com/api/webhooks/123456789012345678/${TOKEN}`,
    `https://ptb.discord.com/api/webhooks/1/${TOKEN}`,
    `https://canary.discord.com/api/webhooks/42/${TOKEN}`,
    `https://canary.discordapp.com/api/webhooks/42/${TOKEN}`,
  ];
  const bad = [
    `http://discord.com/api/webhooks/1/${TOKEN}`,
    `https://discord.com.evil.test/api/webhooks/1/${TOKEN}`,
    `https://evil.test/https://discord.com/api/webhooks/1/${TOKEN}`,
    `https://beta.discord.com/api/webhooks/1/${TOKEN}`,
    `https://discord.com/api/webhooks/abc/${TOKEN}`,
    `https://discord.com/api/webhooks/1/${TOKEN}?wait=true`,
    `https://discord.com/api/webhooks/1/${TOKEN}/slack`,
    `https://discord.com/api/webhooks/1/`,
    `https://discord.com/api/webhooks/1/${TOKEN} extra`,
  ];

  for (const key of ['DISCORD_WEBHOOK_SHIPS', 'DISCORD_WEBHOOK_WEEKLY'] as const) {
    const field = key === 'DISCORD_WEBHOOK_SHIPS' ? 'discordWebhookShips' : 'discordWebhookWeekly';

    it(`${key} is null when unset or blank, and read in each Discord form`, () => {
      expect(loadConfig(FULL, REPO)[field]).toBeNull();
      expect(loadConfig({ ...FULL, [key]: '  ' }, REPO)[field]).toBeNull();
      for (const url of good) expect(loadConfig({ ...FULL, [key]: url }, REPO)[field], url).toBe(url);
    });

    it(`${key} that is not a Discord webhook address stops the process, naming the key and never the value`, () => {
      for (const url of bad) {
        let error: unknown = null;
        try {
          loadConfig({ ...FULL, [key]: url }, REPO);
        } catch (caught) {
          error = caught;
        }
        expect(error, url).toBeInstanceOf(ConfigError);
        const message = (error as Error).message;
        expect(message).toBe(`${key} must be a Discord webhook address (https://discord.com/api/webhooks/<id>/<token>)`);
        expect(message).not.toContain(TOKEN);
        expect(message).not.toContain('evil');
      }
    });
  }

  it('PUBLIC_SITE_URL defaults to the domain, takes an https origin, and refuses anything else', () => {
    expect(loadConfig(FULL, REPO).publicSiteUrl).toBe('https://mobmachine.games');
    expect(loadConfig({ ...FULL, PUBLIC_SITE_URL: 'https://preview.site.test/' }, REPO).publicSiteUrl).toBe('https://preview.site.test');
    for (const value of ['http://site.test', 'https://site.test/reports', 'https://site.test/?x=1', 'not a url', 'https://user:pw@site.test']) {
      expect(() => loadConfig({ ...FULL, PUBLIC_SITE_URL: value }, REPO), value).toThrow(new ConfigError('PUBLIC_SITE_URL must be an https origin'));
    }
  });
});

// docs/specs/actions-host.md: a host with a bounded run sets the time the dispatcher drains from.
describe('the drain time', () => {
  it('is null when unset or blank', () => {
    expect(loadConfig(FULL, REPO).drainAt).toBeNull();
    expect(loadConfig({ ...FULL, DISPATCHER_DRAIN_AT: '  ' }, REPO).drainAt).toBeNull();
  });

  it('reads an ISO 8601 time in UTC or with an offset', () => {
    expect(loadConfig({ ...FULL, DISPATCHER_DRAIN_AT: '2026-10-06T17:00:00Z' }, REPO).drainAt?.toISOString()).toBe('2026-10-06T17:00:00.000Z');
    expect(loadConfig({ ...FULL, DISPATCHER_DRAIN_AT: '2026-10-06T13:00:00-04:00' }, REPO).drainAt?.toISOString()).toBe('2026-10-06T17:00:00.000Z');
  });

  it('refuses a time with no zone, a bare number or nonsense, fatally', () => {
    for (const value of ['2026-10-06T17:00:00', '1791306000', 'soon', '2026-13-45T99:00:00Z']) {
      expect(() => loadConfig({ ...FULL, DISPATCHER_DRAIN_AT: value }, REPO), value).toThrow(ConfigError);
    }
  });
});

// docs/specs/unattended-roles.md: the supply gives a card up once its spend leaves less than one draft
// session under the per-card maximum, in SQL (draft_target_exhausted) and in the handler alike.
describe('DRAFT_SESSION_MIN_USD', () => {
  it('is the figure the supply-refill migration gives draft_session_min_usd()', () => {
    const file = path.resolve(import.meta.dirname, '..', '..', 'supabase', 'migrations', '20261010200000_supply_refill.sql');
    const body = /function public\.draft_session_min_usd\(\)[\s\S]*?select ([0-9.]+)::numeric/.exec(readFileSync(file, 'utf8'));
    expect(body?.[1]).toBeDefined();
    expect(Number(body![1])).toBe(DRAFT_SESSION_MIN_USD);
  });
});
