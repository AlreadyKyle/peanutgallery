import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseChecks } from '../src/acceptance.js';
import type { GateStatus } from '../src/github.js';
import { gitBlobId, mergedServedFiles, parseLsTree, runSmoke, servedPath, type MergedFile } from '../src/smoke.js';
import { AGENT_EMAIL, git } from '../src/worktree.js';
import { hangingFetch, mockFetch, type Reply } from './helpers/mock-fetch.js';

const BASE = 'https://site.local';
const SHA = 'merge-sha-0123456789';
const PAGE = '<!doctype html><meta name="build-sha" content="merge-sha-0123456789">';
const SPAWN = `${JSON.stringify({ rows: [{ id: 'gatherer', name: 'Gatherer', baseCost: 11, rate: 0.2 }] }, null, 2)}\n`;
const STRINGS = '{"title":"Dust"}\n';

type Pages = Record<string, Reply>;

function fetchFor(pages: Pages) {
  return mockFetch((_method, url) => pages[url.slice(BASE.length)]);
}

const GOOD: Pages = {
  '/': { status: 200, text: PAGE },
  '/version.json': { status: 200, json: { sha: SHA, builtAt: 'build time' } },
  '/config/spawn-table.json': { status: 200, text: SPAWN },
  '/content/strings.json': { status: 200, text: STRINGS },
};

const MERGED: MergedFile[] = [
  { path: 'seed-1/config/spawn-table.json', route: '/config/spawn-table.json', mode: '100644', blob: gitBlobId(Buffer.from(SPAWN)) },
  { path: 'seed-1/content/strings.json', route: '/content/strings.json', mode: '100644', blob: gitBlobId(Buffer.from(STRINGS)) },
];

const PASS: GateStatus = { state: 'pass' };
const gateIs = (status: GateStatus) => async () => status;
const noFiles = async (): Promise<MergedFile[]> => {
  throw new Error('a platform card lists no served files');
};

describe('servedPath', () => {
  it('maps seed-1 config and content files to their served routes and nothing else', () => {
    expect(servedPath('seed-1', 'seed-1/config/spawn-table.json')).toBe('/config/spawn-table.json');
    expect(servedPath('seed-1', 'seed-1/content/strings.json')).toBe('/content/strings.json');
    expect(servedPath('seed-1', 'seed-1/sim/index.ts')).toBeNull();
    expect(servedPath('platform', 'seed-1/config/spawn-table.json')).toBeNull();
  });
});

describe('gitBlobId', () => {
  it('is the id git gives the same bytes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-blob-'));
    try {
      const file = path.join(dir, 'x.json');
      await writeFile(file, SPAWN, 'utf8');
      const id = execFileSync('git', ['hash-object', file], { stdio: 'pipe' }).toString().trim();
      expect(gitBlobId(Buffer.from(SPAWN))).toBe(id);
      expect(gitBlobId(Buffer.from(`${SPAWN} `))).not.toBe(id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('runSmoke build check', () => {
  const base = { sha: SHA, folder: 'platform' as const, checks: [], mergedFiles: noFiles, gate: gateIs(PASS), retryDelayMs: 1 };

  it('passes for a platform deploy that serves the merge sha with the gate green there', async () => {
    const { fetchFn, calls } = fetchFor(GOOD);
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn })).toEqual({ ok: true, summary: 'pass: build merge-sh served; gate green at the merge sha' });
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

  it('tries a page again after a server error or a network error, three times in all', async () => {
    let pageReads = 0;
    const { fetchFn } = mockFetch((_method, url) => {
      const route = url.slice(BASE.length);
      if (route !== '/') return GOOD[route];
      pageReads += 1;
      if (pageReads === 1) return { status: 502, text: 'Bad gateway' };
      if (pageReads === 2) throw new TypeError('fetch failed');
      return GOOD['/'];
    });
    expect((await runSmoke({ ...base, baseUrl: BASE, fetchFn })).ok).toBe(true);
    expect(pageReads).toBe(3);
    const failing = fetchFor({ ...GOOD, '/': { status: 503, text: '' } });
    expect(await runSmoke({ ...base, baseUrl: BASE, fetchFn: failing.fetchFn })).toEqual({ ok: false, summary: 'fail: GET / returned 503' });
    expect(failing.calls).toHaveLength(3);
  });

  it('throws when a page never answers, once the request times out', async () => {
    const { fetchFn, signals } = hangingFetch();
    await expect(runSmoke({ ...base, baseUrl: BASE, fetchFn, timeoutMs: 20 })).rejects.toThrow(/timeout|abort/i);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('runSmoke gate at the merge sha', () => {
  const base = { sha: SHA, folder: 'platform' as const, checks: [], mergedFiles: noFiles, retryDelayMs: 1, baseUrl: BASE };

  it('fails when the gate concluded anything but success', async () => {
    expect(await runSmoke({ ...base, fetchFn: fetchFor(GOOD).fetchFn, gate: gateIs({ state: 'fail', conclusion: 'failure' }) })).toEqual({
      ok: false,
      summary: 'fail: the gate at the merge sha concluded failure',
    });
  });

  it('is no verdict, and throws, when the gate is still running or missing when the wait ends', async () => {
    await expect(runSmoke({ ...base, fetchFn: fetchFor(GOOD).fetchFn, gate: gateIs({ state: 'pending' }) })).rejects.toThrow('the gate at the merge sha merge-sh was still pending when the smoke wait ended');
    await expect(runSmoke({ ...base, fetchFn: fetchFor(GOOD).fetchFn, gate: gateIs({ state: 'missing' }) })).rejects.toThrow('still missing');
  });

  it('is no verdict, and throws, when the gate run there was cancelled, failed to start or went stale (docs/specs/money-safety.md)', async () => {
    for (const conclusion of ['cancelled', 'startup_failure', 'stale']) {
      await expect(runSmoke({ ...base, fetchFn: fetchFor(GOOD).fetchFn, gate: gateIs({ state: 'fail', conclusion }) })).rejects.toThrow(
        `the gate run at the merge sha merge-sh concluded ${conclusion} without judging the change`,
      );
    }
  });

  it('checks the gate only after the served build passes', async () => {
    let asked = 0;
    const result = await runSmoke({
      ...base,
      fetchFn: fetchFor({ ...GOOD, '/': { status: 404, text: '' } }).fetchFn,
      gate: async () => {
        asked += 1;
        return PASS;
      },
    });
    expect(result.ok).toBe(false);
    expect(asked).toBe(0);
  });
});

describe('runSmoke seed config', () => {
  const checks = parseChecks('check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11');
  const base = { sha: SHA, folder: 'seed-1' as const, checks, mergedFiles: async () => MERGED, gate: gateIs(PASS), retryDelayMs: 1, baseUrl: BASE };

  it('passes when the checks hold and every served file equals the merge commit, byte for byte, and runs no card code', async () => {
    const { fetchFn, calls } = fetchFor(GOOD);
    expect(await runSmoke({ ...base, fetchFn })).toEqual({
      ok: true,
      summary: 'pass: build merge-sh served; 1 config check(s) hold; 2 served file(s) match the merge commit; gate green at the merge sha',
    });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/`, `${BASE}/version.json`, `${BASE}/config/spawn-table.json`, `${BASE}/config/spawn-table.json`, `${BASE}/content/strings.json`]);
  });

  it('fails before the byte check when the served config does not satisfy the check', async () => {
    const pages: Pages = { ...GOOD, '/config/spawn-table.json': { status: 200, json: { rows: [{ id: 'gatherer', baseCost: 10 }] } } };
    expect(await runSmoke({ ...base, fetchFn: fetchFor(pages).fetchFn })).toEqual({
      ok: false,
      summary: 'fail: served /config/spawn-table.json does not satisfy check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11',
    });
  });

  it('fails when one served byte differs from the merge commit, even where the checked value holds', async () => {
    const pages: Pages = { ...GOOD, '/config/spawn-table.json': { status: 200, text: SPAWN.replace('\n}', '}') } };
    expect(await runSmoke({ ...base, fetchFn: fetchFor(pages).fetchFn })).toEqual({ ok: false, summary: 'fail: served /config/spawn-table.json differs from seed-1/config/spawn-table.json at the merge commit merge-sh' });
    expect(await runSmoke({ ...base, fetchFn: fetchFor({ ...GOOD, '/content/strings.json': { status: 404, text: '' } }).fetchFn })).toEqual({ ok: false, summary: 'fail: GET /content/strings.json returned 404' });
  });

  it('fails on a served folder entry that is not a regular file at the merge commit', async () => {
    const symlink: MergedFile = { path: 'seed-1/config/link.json', route: '/config/link.json', mode: '120000', blob: gitBlobId(Buffer.from('/etc/passwd')) };
    expect(await runSmoke({ ...base, mergedFiles: async () => [...MERGED, symlink], fetchFn: fetchFor(GOOD).fetchFn })).toEqual({
      ok: false,
      summary: 'fail: seed-1/config/link.json at the merge commit is not a regular file (mode 120000)',
    });
  });

  it('stops at the build check for a seed deploy whose sha differs, before any config request', async () => {
    const { fetchFn, calls } = fetchFor({ ...GOOD, '/version.json': { status: 200, json: { sha: 'older' } } });
    expect((await runSmoke({ ...base, fetchFn })).ok).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe('mergedServedFiles', () => {
  let dir: string;
  let origin: string;
  let repo: string;
  let sha: string;
  const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'backseat-smoke-'));
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    await writeFile(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
    origin = path.join(dir, 'origin.git');
    await git(['init', '-q', '--bare', '--initial-branch=main', origin], dir);
    const work = path.join(dir, 'work');
    await git(['init', '-q', '--initial-branch=main', work], dir);
    await mkdir(path.join(work, 'seed-1', 'config'), { recursive: true });
    await mkdir(path.join(work, 'seed-1', 'content'), { recursive: true });
    await mkdir(path.join(work, 'seed-1', 'sim'), { recursive: true });
    await writeFile(path.join(work, 'seed-1', 'config', 'spawn-table.json'), SPAWN, 'utf8');
    await writeFile(path.join(work, 'seed-1', 'content', 'strings.json'), STRINGS, 'utf8');
    await writeFile(path.join(work, 'seed-1', 'sim', 'index.ts'), 'export {};\n', 'utf8');
    await git(['add', '-A'], work);
    await git(['-c', 'user.name=Dispatcher test', '-c', `user.email=${AGENT_EMAIL}`, 'commit', '-q', '-m', 'merge'], work);
    await git(['push', '-q', origin, 'main'], work);
    sha = await git(['rev-parse', 'HEAD'], work);
    repo = path.join(dir, 'repo');
    await git(['init', '-q', '--initial-branch=main', repo], dir);
    await git(['remote', 'add', 'origin', origin], repo);
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('fetches main and lists the served folders at the merge commit with their blob ids', async () => {
    expect(await mergedServedFiles(repo, sha, {})).toEqual(MERGED);
  });

  it('parses ls-tree output, paths with spaces included', () => {
    expect(parseLsTree('100644 blob abc\tseed-1/config/a b.json\u0000120000 blob def\tseed-1/config/l\u0000')).toEqual([
      { mode: '100644', type: 'blob', object: 'abc', path: 'seed-1/config/a b.json' },
      { mode: '120000', type: 'blob', object: 'def', path: 'seed-1/config/l' },
    ]);
  });
});
