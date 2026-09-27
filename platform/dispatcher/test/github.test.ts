import { describe, expect, it } from 'vitest';
import {
  closePullRequest,
  compareRange,
  findPullForBranch,
  gateStatus,
  mainHead,
  mergePullRequest,
  openPullRequest,
  revertMerge,
  treeModes,
  waitForPullHead,
  type GitHubOptions,
} from '../src/github.js';
import { hangingFetch, mockFetch as routeFetch } from './helpers/mock-fetch.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(status: number, json: unknown, calls: Call[] = []): { fetchFn: typeof fetch; calls: Call[] } {
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const base = { token: 'token', repo: 'owner/repo' };

describe('closePullRequest', () => {
  it('patches the pull request closed, and throws on a refusal', async () => {
    const { fetchFn, calls } = mockFetch(200, { number: 7, state: 'closed' });
    await closePullRequest({ ...base, fetchFn }, 7);
    expect(calls).toEqual([{ url: 'https://api.github.com/repos/owner/repo/pulls/7', method: 'PATCH', body: { state: 'closed' } }]);
    const refused = mockFetch(422, { message: 'Validation Failed' });
    await expect(closePullRequest({ ...base, fetchFn: refused.fetchFn }, 7)).rejects.toThrow('github close pull request 7: http 422 Validation Failed');
  });
});

describe('mergePullRequest', () => {
  it('squash-merges with the head sha guard', async () => {
    const { fetchFn, calls } = mockFetch(200, { sha: 'merge-sha', merged: true, message: 'Pull Request successfully merged' });
    const opts: GitHubOptions = { ...base, fetchFn };
    const result = await mergePullRequest(opts, 7, 'head-sha', { title: 'card 0a1b2c3d: gatherer cost', message: 'Card-Id: x' });
    expect(result).toEqual({ ok: true, sha: 'merge-sha' });
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/owner/repo/pulls/7/merge');
    expect(calls[0]?.body).toEqual({ sha: 'head-sha', merge_method: 'squash', commit_title: 'card 0a1b2c3d: gatherer cost', commit_message: 'Card-Id: x' });
  });

  it('is rejected when the head sha no longer matches (409)', async () => {
    const { fetchFn } = mockFetch(409, { message: 'Head branch was modified. Review and try the merge again.' });
    const result = await mergePullRequest({ ...base, fetchFn }, 7, 'head-sha', { title: 't', message: 'm' });
    expect(result).toEqual({ ok: false, status: 409, reason: 'head sha head-sha no longer matches the pull request' });
  });

  it('is rejected when the pull request is not mergeable (405)', async () => {
    const { fetchFn } = mockFetch(405, { message: 'Pull Request is not mergeable' });
    const result = await mergePullRequest({ ...base, fetchFn }, 7, 'head-sha', { title: 't', message: 'm' });
    expect(result).toEqual({ ok: false, status: 405, reason: 'Pull Request is not mergeable' });
  });

  const API = 'https://api.github.com/repos/owner/repo';
  const afterLostPut = (pull: { status: number; json: unknown }) =>
    routeFetch((method, url) => {
      if (method === 'PUT') throw new Error('The operation was aborted due to timeout');
      if (method === 'GET' && url === `${API}/pulls/7`) return pull;
      return undefined;
    });

  it('reads the pull request when the merge request throws, and takes its merge commit when it merged', async () => {
    const { fetchFn, calls } = afterLostPut({ status: 200, json: { number: 7, merged: true, merge_commit_sha: 'merge-sha', head: { sha: 'head-sha' } } });
    expect(await mergePullRequest({ ...base, fetchFn }, 7, 'head-sha', { title: 't', message: 'm' }, { timeoutMs: 1000, intervalMs: 1 })).toEqual({ ok: true, sha: 'merge-sha' });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`PUT ${API}/pulls/7/merge`, `GET ${API}/pulls/7`]);
  });

  it('polls the pull request after a lost merge request until it shows merged', async () => {
    let reads = 0;
    const { fetchFn } = routeFetch((method, url) => {
      if (method === 'PUT') throw new Error('fetch failed');
      if (method !== 'GET' || url !== `${API}/pulls/7`) return undefined;
      reads += 1;
      if (reads === 1) throw new Error('fetch failed');
      return { status: 200, json: { number: 7, merged: reads >= 3, merge_commit_sha: reads >= 3 ? 'merge-sha' : null, head: { sha: 'head-sha' } } };
    });
    expect(await mergePullRequest({ ...base, fetchFn }, 7, 'head-sha', { title: 't', message: 'm' }, { timeoutMs: 1000, intervalMs: 1 })).toEqual({ ok: true, sha: 'merge-sha' });
    expect(reads).toBe(3);
  });

  it('reports the merge as unknown, not refused, when the pull request never shows merged', async () => {
    const { fetchFn, calls } = afterLostPut({ status: 200, json: { number: 7, merged: false, merge_commit_sha: null, head: { sha: 'head-sha' } } });
    expect(await mergePullRequest({ ...base, fetchFn }, 7, 'head-sha', { title: 't', message: 'm' }, { timeoutMs: 200, intervalMs: 5 })).toEqual({
      ok: false,
      status: 0,
      unknown: true,
      reason: 'the merge request failed (The operation was aborted due to timeout) and pull request 7 did not show merged within 0.2 s',
    });
    expect(calls.filter((call) => call.method === 'GET').length).toBeGreaterThan(1);
  });
});

describe('reading the range, trees, pull requests and main', () => {
  const API = 'https://api.github.com/repos/owner/repo';

  it('reads a compare into its commits, merge base and files, renames with their old names', async () => {
    const { fetchFn, calls } = mockFetch(200, {
      ahead_by: 1,
      behind_by: 0,
      merge_base_commit: { sha: 'base-sha' },
      commits: [{ sha: 'head-sha' }],
      files: [
        { filename: 'seed-1/content/x.json', status: 'renamed', previous_filename: 'seed-1/sim/invariants.ts' },
        { filename: 'seed-1/config/a.json', status: 'modified' },
      ],
    });
    expect(await compareRange({ ...base, fetchFn }, 'base-sha', 'head-sha')).toEqual({
      aheadBy: 1,
      behindBy: 0,
      mergeBaseSha: 'base-sha',
      commits: ['head-sha'],
      files: [
        { path: 'seed-1/content/x.json', status: 'renamed', previousPath: 'seed-1/sim/invariants.ts' },
        { path: 'seed-1/config/a.json', status: 'modified', previousPath: null },
      ],
    });
    expect(calls[0]?.url).toBe(`${API}/compare/base-sha...head-sha`);
  });

  it('reads a commit tree into modes by path, and refuses a truncated tree', async () => {
    const tree = [
      { path: 'seed-1', mode: '040000', type: 'tree' },
      { path: 'seed-1/content/gh', mode: '120000', type: 'blob' },
    ];
    const { fetchFn, calls } = mockFetch(200, { tree, truncated: false });
    expect(await treeModes({ ...base, fetchFn }, 'head-sha')).toEqual(new Map([['seed-1', '040000'], ['seed-1/content/gh', '120000']]));
    expect(calls[0]?.url).toBe(`${API}/git/trees/head-sha?recursive=1`);
    await expect(treeModes({ ...base, fetchFn: mockFetch(200, { tree, truncated: true }).fetchFn }, 'head-sha')).rejects.toThrow('github tree head-sha: truncated');
  });

  it('finds the newest pull request for a branch and whether it merged', async () => {
    const { fetchFn, calls } = mockFetch(200, [{ number: 9, merged_at: '2026-09-16T12:00:00Z', merge_commit_sha: 'merge-sha', state: 'closed', head: { sha: 'head-sha' } }]);
    expect(await findPullForBranch({ ...base, fetchFn }, 'card/4c2f5a1e-code')).toEqual({ number: 9, merged: true, mergeCommitSha: 'merge-sha', open: false });
    expect(calls[0]?.url).toBe(`${API}/pulls?state=all&head=owner%3Acard%2F4c2f5a1e-code&sort=created&direction=desc&per_page=1`);
    expect(await findPullForBranch({ ...base, fetchFn: mockFetch(200, []).fetchFn }, 'card/x')).toBeNull();
  });

  it("reads main's head", async () => {
    const { fetchFn, calls } = mockFetch(200, { ref: 'refs/heads/main', object: { sha: 'main-sha' } });
    expect(await mainHead({ ...base, fetchFn })).toBe('main-sha');
    expect(calls[0]?.url).toBe(`${API}/git/ref/heads/main`);
  });
});

describe('waitForPullHead', () => {
  const API = 'https://api.github.com/repos/owner/repo';

  it('polls until the pull request head is the pushed sha', async () => {
    let reads = 0;
    const { fetchFn } = routeFetch((method, url) => {
      if (method !== 'GET' || url !== `${API}/pulls/7`) return undefined;
      reads += 1;
      return { status: 200, json: { number: 7, head: { sha: reads < 3 ? 'stale-sha' : 'pushed-sha' } } };
    });
    expect(await waitForPullHead({ ...base, fetchFn }, 7, 'pushed-sha', { timeoutMs: 1000, intervalMs: 1 })).toBe(true);
    expect(reads).toBe(3);
  });

  it('gives up when the head never moves', async () => {
    const { fetchFn, calls } = routeFetch(() => ({ status: 200, json: { number: 7, head: { sha: 'stale-sha' } } }));
    expect(await waitForPullHead({ ...base, fetchFn }, 7, 'pushed-sha', { timeoutMs: 200, intervalMs: 5 })).toBe(false);
    expect(calls.length).toBeGreaterThan(1);
  });
});

describe('request timeout', () => {
  it('aborts a GitHub request that never answers', async () => {
    const { fetchFn, signals } = hangingFetch();
    await expect(gateStatus({ ...base, fetchFn, timeoutMs: 20 }, 'sha')).rejects.toThrow(/timeout|abort/i);
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe('gateStatus', () => {
  const GATE = '.github/workflows/gate.yml';
  const gate = (status: string, conclusion: string | null, path: unknown = GATE) => ({ name: 'gate', path, status, conclusion });
  const status = async (...runs: unknown[]) => gateStatus({ ...base, fetchFn: mockFetch(200, { workflow_runs: runs }).fetchFn }, 'sha');

  it('maps the gate workflow run to pass, fail, pending and missing', async () => {
    const run = (status: string, conclusion: string | null) => ({ workflow_runs: [gate(status, conclusion), { name: 'other', path: '.github/workflows/other.yml', status: 'completed', conclusion: 'failure' }] });
    expect(await gateStatus({ ...base, fetchFn: mockFetch(200, run('completed', 'success')).fetchFn }, 'sha')).toEqual({ state: 'pass' });
    expect(await gateStatus({ ...base, fetchFn: mockFetch(200, run('completed', 'failure')).fetchFn }, 'sha')).toEqual({ state: 'fail', conclusion: 'failure' });
    expect(await gateStatus({ ...base, fetchFn: mockFetch(200, run('in_progress', null)).fetchFn }, 'sha')).toEqual({ state: 'pending' });
    expect(await gateStatus({ ...base, fetchFn: mockFetch(200, { workflow_runs: [] }).fetchFn }, 'sha')).toEqual({ state: 'missing' });
  });

  it('counts only runs of the gate workflow file', async () => {
    expect(await status(gate('completed', 'success', '.github/workflows/other.yml'))).toEqual({ state: 'missing' });
    expect(await status(gate('completed', 'success', null))).toEqual({ state: 'missing' });
    expect(await status({ name: 'gate', status: 'completed', conclusion: 'success' })).toEqual({ state: 'missing' });
    expect(await status(gate('completed', 'success', '.github/workflows/other.yml'), gate('completed', 'failure'))).toEqual({ state: 'fail', conclusion: 'failure' });
  });

  it('treats a workflow that never started as a failure with its conclusion', async () => {
    expect(await status(gate('completed', 'startup_failure'))).toEqual({ state: 'fail', conclusion: 'startup_failure' });
  });

  it('throws on a refused read, as a token without Actions read gets', async () => {
    await expect(gateStatus({ ...base, fetchFn: mockFetch(403, { message: 'Resource not accessible by personal access token' }).fetchFn }, 'sha')).rejects.toThrow(/workflow runs: http 403/);
  });

  it('fails when one gate run on the sha failed, whatever the others say', async () => {
    expect(await status(gate('completed', 'success'), gate('completed', 'failure'))).toEqual({ state: 'fail', conclusion: 'failure' });
    expect(await status(gate('completed', 'failure'), gate('completed', 'success'))).toEqual({ state: 'fail', conclusion: 'failure' });
    expect(await status(gate('completed', 'success'), gate('completed', 'cancelled'))).toEqual({ state: 'fail', conclusion: 'cancelled' });
    expect(await status(gate('in_progress', null), gate('completed', 'failure'))).toEqual({ state: 'fail', conclusion: 'failure' });
  });

  it('passes only when every gate workflow run completed with success', async () => {
    expect(await status(gate('completed', 'success'), gate('completed', 'success'))).toEqual({ state: 'pass' });
    expect(await status(gate('completed', 'success'), gate('queued', null))).toEqual({ state: 'pending' });
  });

  it('queries the workflow runs for the exact sha', async () => {
    const { fetchFn, calls } = mockFetch(200, { workflow_runs: [] });
    await gateStatus({ ...base, fetchFn }, 'abc123');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/owner/repo/actions/runs?head_sha=abc123&per_page=50');
  });
});

describe('openPullRequest', () => {
  it('returns the number and head sha of a created pull request', async () => {
    const { fetchFn, calls } = mockFetch(201, { number: 12, head: { sha: 'head-sha' } });
    const pr = await openPullRequest({ ...base, fetchFn }, { head: 'card/0a1b2c3d-config', title: 't', body: 'b' });
    expect(pr).toEqual({ number: 12, headSha: 'head-sha' });
    expect(calls[0]?.body).toEqual({ title: 't', head: 'card/0a1b2c3d-config', base: 'main', body: 'b' });
  });

  it('throws on any other failure', async () => {
    const { fetchFn } = mockFetch(403, { message: 'Resource not accessible by integration' });
    await expect(openPullRequest({ ...base, fetchFn }, { head: 'h', title: 't', body: 'b' })).rejects.toThrow('http 403 Resource not accessible by integration');
  });
});

describe('revertMerge', () => {
  const API = 'https://api.github.com/repos/owner/repo';
  const routes = (ref: { status: number; json: unknown }, parents: unknown[] = [{ sha: 'parent-sha' }]) =>
    routeFetch((method, url) => {
      if (method === 'GET' && url === `${API}/git/commits/merge-sha`) return { status: 200, json: { sha: 'merge-sha', parents } };
      if (method === 'GET' && url === `${API}/git/commits/parent-sha`) return { status: 200, json: { sha: 'parent-sha', tree: { sha: 'parent-tree' } } };
      if (method === 'POST' && url === `${API}/git/commits`) return { status: 201, json: { sha: 'revert-sha' } };
      if (method === 'PATCH' && url === `${API}/git/refs/heads/main`) return ref;
      return undefined;
    });

  it('commits the parent tree on top of the merge and fast-forwards main to it', async () => {
    const { fetchFn, calls } = routes({ status: 200, json: { object: { sha: 'revert-sha' } } });
    expect(await revertMerge({ ...base, fetchFn }, 'merge-sha', 'Revert card x')).toEqual({ ok: true, sha: 'revert-sha' });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET', 'POST', 'PATCH']);
    expect(calls[2]?.body).toEqual({ message: 'Revert card x', tree: 'parent-tree', parents: ['merge-sha'] });
    expect(calls[3]?.body).toEqual({ sha: 'revert-sha', force: false });
  });

  it('refuses when main has moved past the merge', async () => {
    const { fetchFn } = routes({ status: 422, json: { message: 'Update is not a fast forward' } });
    expect(await revertMerge({ ...base, fetchFn }, 'merge-sha', 'Revert card x')).toEqual({
      ok: false,
      reason: 'main was not moved to the revert commit revert-sha: http 422 Update is not a fast forward',
    });
  });

  it('refuses a commit that is not a single-parent squash merge, before writing anything', async () => {
    const { fetchFn, calls } = routes({ status: 200, json: {} }, [{ sha: 'a' }, { sha: 'b' }]);
    expect(await revertMerge({ ...base, fetchFn }, 'merge-sha', 'Revert card x')).toEqual({
      ok: false,
      reason: 'merge commit merge-sha has 2 parents; only a squash merge is reverted',
    });
    expect(calls).toHaveLength(1);
  });
});
