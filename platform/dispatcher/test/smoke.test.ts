import { describe, expect, it } from 'vitest';
import { parseChecks } from '../src/acceptance.js';
import { runSmoke, servedPath } from '../src/smoke.js';
import { mockFetch, type Reply } from './helpers/mock-fetch.js';

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
  const base = { sha: SHA, folder: 'platform' as const, checks: [], repoRoot: '/unused', botSeconds: 60 };

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
});

describe('runSmoke config check', () => {
  const checks = parseChecks('check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11');
  const base = { sha: SHA, folder: 'seed-1' as const, checks, repoRoot: '/unused', botSeconds: 60 };

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
