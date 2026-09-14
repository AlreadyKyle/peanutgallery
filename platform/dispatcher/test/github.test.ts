import { describe, expect, it } from 'vitest';
import { gateStatus, mergePullRequest, openPullRequest, type GitHubOptions } from '../src/github.js';

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
});

describe('gateStatus', () => {
  it('maps the gate check-run to pass, fail, pending and missing', async () => {
    const run = (status: string, conclusion: string | null) => ({ check_runs: [{ name: 'gate', status, conclusion }, { name: 'detect', status: 'completed', conclusion: 'success' }] });
    expect(await gateStatus({ ...base, fetchFn: mockFetch(200, run('completed', 'success')).fetchFn }, 'sha')).toEqual({ state: 'pass' });
    expect(await gateStatus({ ...base, fetchFn: mockFetch(200, run('completed', 'failure')).fetchFn }, 'sha')).toEqual({ state: 'fail', conclusion: 'failure' });
    expect(await gateStatus({ ...base, fetchFn: mockFetch(200, run('in_progress', null)).fetchFn }, 'sha')).toEqual({ state: 'pending' });
    expect(await gateStatus({ ...base, fetchFn: mockFetch(200, { check_runs: [] }).fetchFn }, 'sha')).toEqual({ state: 'missing' });
  });

  it('queries check-runs for the exact sha filtered by name', async () => {
    const { fetchFn, calls } = mockFetch(200, { check_runs: [] });
    await gateStatus({ ...base, fetchFn }, 'abc123');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/owner/repo/commits/abc123/check-runs?check_name=gate&per_page=50');
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
