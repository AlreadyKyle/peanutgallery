import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseChecks } from '../src/acceptance.js';
import { childEnv } from '../src/adapters/claude-cli.js';
import { runSmoke, servedPath, type BotExec, type BotExecOptions } from '../src/smoke.js';
import { hangingFetch, mockFetch, type Reply } from './helpers/mock-fetch.js';

const BASE = 'https://site.local';
const SHA = 'merge-sha-0123456789';
const PAGE = '<!doctype html><meta name="build-sha" content="merge-sha-0123456789">';

type Pages = Record<string, Reply>;

function fetchFor(pages: Pages) {
  return mockFetch((_method, url) => pages[url.slice(BASE.length)]);
}

const GOOD: Pages = {
  '/': { status: 200, text: PAGE },
  '/version.json': { status: 200, json: { sha: SHA, builtAt: '2026-09-14T15:00:00.000Z' } },
  '/config/spawn-table.json': { status: 200, json: { rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 11, rate: 0.2 }] } },
};

describe('servedPath', () => {
  it('maps seed-1 config and content files to their served routes and nothing else', () => {
    expect(servedPath('seed-1', 'seed-1/config/spawn-table.json')).toBe('/config/spawn-table.json');
    expect(servedPath('seed-1', 'seed-1/content/strings.json')).toBe('/content/strings.json');
    expect(servedPath('seed-1', 'seed-1/sim/index.ts')).toBeNull();
    expect(servedPath('platform', 'seed-1/config/spawn-table.json')).toBeNull();
  });
});

describe('runSmoke build check', () => {
  const base = { sha: SHA, folder: 'platform' as const, checks: [], botRoot: '/unused', botSeconds: 60 };

  it('passes for a platform deploy that serves the merge sha', async () => {
    const { fetchFn, calls } = fetchFor(GOOD);
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn })).toEqual({ ok: true, summary: 'pass: build merge-sh served' });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/`, `${BASE}/version.json`]);
  });

  it('fails when the page is missing, lacks the build-sha meta, or version.json differs', async () => {
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn: fetchFor({ ...GOOD, '/': { status: 500, text: '' } }).fetchFn })).toEqual({ ok: false, summary: 'fail: GET / returned 500' });
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn: fetchFor({ ...GOOD, '/': { status: 200, text: '<html></html>' } }).fetchFn })).toEqual({ ok: false, summary: 'fail: GET / has no build-sha meta' });
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn: fetchFor({ ...GOOD, '/version.json': { status: 200, json: { sha: 'older' } } }).fetchFn })).toEqual({
      ok: false,
      summary: `fail: version.json sha older differs from merge sha ${SHA}`,
    });
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn: fetchFor({ ...GOOD, '/version.json': { status: 200, text: 'not json' } }).fetchFn })).toEqual({ ok: false, summary: 'fail: GET /version.json is not JSON' });
  });

  it('throws when a page never answers, once the request times out', async () => {
    const { fetchFn, signals } = hangingFetch();
    await expect(runSmoke({ ...base, baseUrl: BASE, fetchFn, timeoutMs: 20 })).rejects.toThrow(/timeout|abort/i);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('runSmoke config check', () => {
  const checks = parseChecks('check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11');
  const base = { sha: SHA, folder: 'seed-1' as const, checks, botRoot: '/unused', botSeconds: 60 };

  it('fails before the bot runs when the served config does not satisfy the check', async () => {
    const pages: Pages = { ...GOOD, '/config/spawn-table.json': { status: 200, json: { rows: [{ id: 'gatherer', baseCost: 10 }] } } };
    const { fetchFn, calls } = fetchFor(pages);
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn })).toEqual({
      ok: false,
      summary: 'fail: served /config/spawn-table.json does not satisfy check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11',
    });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/`, `${BASE}/version.json`, `${BASE}/config/spawn-table.json`]);
  });

  it('fails when the checked route is missing or not JSON', async () => {
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn: fetchFor({ ...GOOD, '/config/spawn-table.json': { status: 404, text: '' } }).fetchFn })).toEqual({
      ok: false,
      summary: 'fail: GET /config/spawn-table.json returned 404',
    });
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn: fetchFor({ ...GOOD, '/config/spawn-table.json': { status: 200, text: '{' } }).fetchFn })).toEqual({
      ok: false,
      summary: 'fail: GET /config/spawn-table.json is not JSON',
    });
  });

  it('stops at the build check for a seed deploy whose sha differs, before any config or bot request', async () => {
    const { fetchFn, calls } = fetchFor({ ...GOOD, '/version.json': { status: 200, json: { sha: 'older' } } });
    expect((await runSmoke({ ...base, baseUrl: BASE, fetchFn })).ok).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe('runSmoke headless bot', () => {
  const checks = parseChecks('check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11');
  const pages: Pages = { ...GOOD, '/config/unlocks.json': { status: 200, json: { unlocks: [] } } };
  // The dispatcher's own environment on the VPS: the secrets its env file carries.
  const SECRETS: Record<string, string> = {
    GITHUB_TOKEN: 'secret-github-token',
    SUPABASE_SERVICE_ROLE_KEY: 'secret-service-role',
    SUPABASE_SECRET_KEY: 'secret-supabase-key',
    STUDIO_ANTHROPIC_API_KEY: 'secret-studio-key',
    NETLIFY_AUTH_TOKEN: 'secret-netlify-token',
    NTFY_TOPIC_URL: 'https://ntfy.sh/secret-topic',
  };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [name, value] of Object.entries(SECRETS)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("runs the bot with the agent session's allowlisted environment and none of the dispatcher's secrets", async () => {
    const runs: Array<{ file: string; args: string[]; options: BotExecOptions }> = [];
    const exec: BotExec = async (file, args, options) => {
      runs.push({ file, args, options });
      return { stdout: 'PASS: headless-bot simulatedSeconds=36000 unlocks=12\n' };
    };
    const result = await runSmoke({ sha: SHA, folder: 'seed-1', checks, botRoot: '/repo', botSeconds: 60, baseUrl: BASE, fetchFn: fetchFor(pages).fetchFn, exec });
    expect(result).toEqual({ ok: true, summary: 'pass: build merge-sh served; 1 config check(s) hold; bot: 36000 simulated seconds, 12 unlocks, budget 60 s' });
    expect(runs).toHaveLength(1);
    const { file, args, options } = runs[0]!;
    expect(file).toBe('node');
    expect(args.slice(0, 2)).toEqual(['platform/gate/headless-bot/run.mjs', '--config-dir']);
    expect(args.slice(-2)).toEqual(['--repo-root', '/repo']);
    expect(options.cwd).toBe('/repo');
    expect(options.env).toEqual(childEnv(process.env));
    expect(options.env.PATH).toBe(process.env.PATH);
    for (const [name, value] of Object.entries(SECRETS)) {
      expect(options.env, name).not.toHaveProperty(name);
      expect(Object.values(options.env)).not.toContain(value);
    }
  });

  it('fails the smoke when the bot exits non-zero', async () => {
    const exec: BotExec = async () => {
      throw new Error('Command failed: node platform/gate/headless-bot/run.mjs\nFAIL: headless-bot');
    };
    const result = await runSmoke({ sha: SHA, folder: 'seed-1', checks, botRoot: '/repo', botSeconds: 60, baseUrl: BASE, fetchFn: fetchFor(pages).fetchFn, exec });
    expect(result).toEqual({ ok: false, summary: 'fail: headless bot failed on the served config: Command failed: node platform/gate/headless-bot/run.mjs' });
  });
});
