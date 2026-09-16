import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_SHA_SELECTOR, loadedBuildSha, reloadWhenStale, servedBuildSha, VERSION_URL, watchForNewBuild } from './freshness';

const LOADED = '1b4105137ab24f1acebcd01b3341a351c409f972';
const SERVED = 'bdb367edc997e6adb38d3a741b0f41a842d7fc9c';

function docWith(sha: string | null, visibility: DocumentVisibilityState = 'visible'): Document {
  document.head.querySelector(BUILD_SHA_SELECTOR)?.remove();
  if (sha !== null) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'build-sha');
    meta.setAttribute('content', sha);
    document.head.append(meta);
  }
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visibility);
  return document;
}

function serving(sha: unknown, ok = true): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({ sha, builtAt: '2026-09-16T01:55:35.627Z' }), { status: ok ? 200 : 503 })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelector(BUILD_SHA_SELECTOR)?.remove();
});

describe('loadedBuildSha and servedBuildSha', () => {
  it('read the stamped build and the served build', async () => {
    expect(loadedBuildSha(docWith(` ${LOADED} `))).toBe(LOADED);
    expect(loadedBuildSha(docWith(null))).toBe('');
    const fetchFn = serving(SERVED);
    expect(await servedBuildSha(fetchFn)).toBe(SERVED);
    expect(fetchFn).toHaveBeenCalledWith(VERSION_URL, { cache: 'no-store' });
  });

  it('give up quietly when the read fails, is not JSON or carries no sha', async () => {
    expect(await servedBuildSha(serving(SERVED, false))).toBeNull();
    expect(await servedBuildSha(serving(null))).toBeNull();
    expect(await servedBuildSha(vi.fn(async () => new Response('not json')) as unknown as typeof fetch)).toBeNull();
    expect(await servedBuildSha(vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe('reloadWhenStale', () => {
  const run = async (sha: string | null, served: unknown, visibility: DocumentVisibilityState = 'visible') => {
    const reload = vi.fn();
    const stale = await reloadWhenStale({ doc: docWith(sha, visibility), win: window, fetchFn: serving(served), reload });
    return { stale, reload };
  };

  it('reloads a page running a build the site no longer serves', async () => {
    const { stale, reload } = await run(LOADED, SERVED);
    expect(stale).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves the page alone when the build matches, is unstamped, unreadable or the tab is hidden', async () => {
    for (const [sha, served, visibility] of [
      [LOADED, LOADED, 'visible'],
      [null, SERVED, 'visible'],
      [LOADED, null, 'visible'],
      [LOADED, SERVED, 'hidden'],
    ] as const) {
      const { stale, reload } = await run(sha, served, visibility);
      expect(stale, `${String(sha)} ${String(served)} ${visibility}`).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    }
  });
});

describe('watchForNewBuild', () => {
  it('checks on a back/forward restore and on a return to the tab, reloads once, and stops when told', async () => {
    const reload = vi.fn();
    const fetchFn = serving(SERVED);
    const stop = watchForNewBuild({ doc: docWith(LOADED), win: window, fetchFn, reload });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    await settle();
    expect(fetchFn).not.toHaveBeenCalled();

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);

    stop();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
