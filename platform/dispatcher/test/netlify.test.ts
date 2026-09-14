import { describe, expect, it } from 'vitest';
import { findDeploy, restoreDeploy, siteUrl, waitForDeploy, type NetlifyOptions } from '../src/netlify.js';
import { mockFetch, type Reply } from './helpers/mock-fetch.js';

const SITE = 'site-seed';
const SHA = 'merge-sha';

function deploysReply(list: unknown[]): Reply {
  return { status: 200, json: list };
}

function opts(reply: Reply | ((method: string, url: string) => Reply | undefined)): NetlifyOptions & { calls: ReturnType<typeof mockFetch>['calls'] } {
  const route = typeof reply === 'function' ? reply : () => reply;
  const { fetchFn, calls } = mockFetch(route);
  return { token: 'nf-token', fetchFn, calls };
}

describe('findDeploy', () => {
  it('matches on commit_ref and production context only', async () => {
    const o = opts(
      deploysReply([
        { id: 'preview', state: 'ready', commit_ref: SHA, context: 'deploy-preview' },
        { id: 'other', state: 'ready', commit_ref: 'other-sha', context: 'production' },
        { id: 'prod', state: 'building', commit_ref: SHA, context: 'production', skipped: false },
      ]),
    );
    expect(await findDeploy(o, SITE, SHA)).toEqual({ id: 'prod', state: 'building', commitRef: SHA, context: 'production', skipped: false, errorMessage: null });
    expect(o.calls[0]?.url).toBe(`https://api.netlify.com/api/v1/sites/${SITE}/deploys?per_page=20`);
    expect(await findDeploy(o, SITE, 'absent')).toBeNull();
  });

  it('throws on a non-200 answer', async () => {
    await expect(findDeploy(opts({ status: 401, json: { code: 401 } }), SITE, SHA)).rejects.toThrow('netlify deploys: http 401');
  });
});

describe('waitForDeploy', () => {
  it('returns the deploy once it is ready', async () => {
    const o = opts(deploysReply([{ id: 'd1', state: 'ready', commit_ref: SHA, context: 'production' }]));
    const wait = await waitForDeploy(o, SITE, SHA, { timeoutMs: 1000, intervalMs: 1 });
    expect(wait.ok).toBe(true);
    if (wait.ok) expect(wait.deploy.id).toBe('d1');
  });

  it('fails at once on a failed state, with the error message', async () => {
    const o = opts(deploysReply([{ id: 'd1', state: 'error', commit_ref: SHA, context: 'production', error_message: 'Canceled build' }]));
    expect(await waitForDeploy(o, SITE, SHA, { timeoutMs: 1000, intervalMs: 1 })).toMatchObject({ ok: false, reason: 'deploy d1 ended in state error: Canceled build' });
  });

  it('fails at once when the build ignore rule skipped the deploy', async () => {
    const o = opts(deploysReply([{ id: 'd1', state: 'ready', commit_ref: SHA, context: 'production', skipped: true }]));
    const wait = await waitForDeploy(o, SITE, SHA, { timeoutMs: 1000, intervalMs: 1 });
    expect(wait).toMatchObject({ ok: false, reason: 'deploy d1 was skipped by the build ignore rule (state ready)' });
  });

  it('times out with a reason naming the last state seen', async () => {
    const building = opts(deploysReply([{ id: 'd1', state: 'building', commit_ref: SHA, context: 'production' }]));
    expect(await waitForDeploy(building, SITE, SHA, { timeoutMs: 0, intervalMs: 1 })).toMatchObject({ ok: false, reason: 'deploy d1 still building after 0 s' });
    const none = opts(deploysReply([]));
    expect(await waitForDeploy(none, SITE, SHA, { timeoutMs: 0, intervalMs: 1 })).toMatchObject({ ok: false, reason: `no production deploy for ${SHA} after 0 s`, deploy: null });
  });

  it('returns early when the signal aborts', async () => {
    const controller = new AbortController();
    const o = opts(() => {
      controller.abort('dispatcher stopping');
      return deploysReply([{ id: 'd1', state: 'building', commit_ref: SHA, context: 'production' }]);
    });
    const wait = await waitForDeploy(o, SITE, SHA, { timeoutMs: 60_000, intervalMs: 1, signal: controller.signal });
    expect(wait).toMatchObject({ ok: false, reason: 'dispatcher stopping' });
    expect(o.calls).toHaveLength(1);
  });
});

describe('restoreDeploy and siteUrl', () => {
  it('posts the restore route and throws on failure', async () => {
    const ok = opts({ status: 200, json: { id: 'd0' } });
    await restoreDeploy(ok, SITE, 'd0');
    expect(ok.calls[0]).toMatchObject({ method: 'POST', url: `https://api.netlify.com/api/v1/sites/${SITE}/deploys/d0/restore` });
    await expect(restoreDeploy(opts({ status: 404, json: {} }), SITE, 'd0')).rejects.toThrow('netlify restore d0: http 404');
  });

  it('prefers ssl_url and strips a trailing slash', async () => {
    expect(await siteUrl(opts({ status: 200, json: { ssl_url: 'https://seed.local/', url: 'http://seed.local' } }), SITE)).toBe('https://seed.local');
    expect(await siteUrl(opts({ status: 200, json: { url: 'http://seed.local' } }), SITE)).toBe('http://seed.local');
    await expect(siteUrl(opts({ status: 200, json: {} }), SITE)).rejects.toThrow('no url');
  });
});
