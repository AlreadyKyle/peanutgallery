import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_SHA_SELECTOR, loadedBuildSha, RELOADED_KEY, reloadWhenStale, safeSessionStorage, servedBuildSha, VERSION_URL, watchForNewBuild } from './freshness';

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

/** A sessionStorage stand-in shared by every watcher in one test, as one tab's reloads share it. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

const blocked: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    const stale = await reloadWhenStale({ doc: docWith(sha, visibility), win: window, fetchFn: serving(served), reload, storage: memoryStorage() });
    return { stale, reload };
  };

  it('reloads a page running a build the site no longer serves, and notes the served build for the tab', async () => {
    const { stale, reload } = await run(LOADED, SERVED);
    expect(stale).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    const storage = memoryStorage();
    await reloadWhenStale({ doc: docWith(LOADED), win: window, fetchFn: serving(SERVED), reload: vi.fn(), storage });
    expect(storage.items.get(RELOADED_KEY)).toBe(SERVED);
  });

  it('leaves the page alone when storage is blocked or missing, and makes no read from a hidden tab', async () => {
    for (const storage of [blocked, null]) {
      const reload = vi.fn();
      expect(await reloadWhenStale({ doc: docWith(LOADED), win: window, fetchFn: serving(SERVED), reload, storage })).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    }
    const fetchFn = serving(SERVED);
    await reloadWhenStale({ doc: docWith(LOADED, 'hidden'), win: window, fetchFn, reload: vi.fn(), storage: memoryStorage() });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('finds sessionStorage, or null when the browser blocks it', () => {
    expect(safeSessionStorage(window)).toBe(window.sessionStorage);
    const throwing = Object.defineProperty({}, 'sessionStorage', {
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    }) as Window;
    expect(safeSessionStorage(throwing)).toBeNull();
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
    const { stop } = watchForNewBuild({ doc: docWith(LOADED), win: window, fetchFn, reload, storage: memoryStorage() });

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

describe('watchForNewBuild on a route change', () => {
  it('reads /version.json when check is called and reloads on a differing served build', async () => {
    const reload = vi.fn();
    const fetchFn = serving(SERVED);
    const watch = watchForNewBuild({ doc: docWith(LOADED), win: window, fetchFn, reload, storage: memoryStorage() });
    watch.check();
    await settle();
    expect(fetchFn).toHaveBeenCalledWith(VERSION_URL, { cache: 'no-store' });
    expect(reload).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it('reads and leaves the page alone when the served build matches', async () => {
    const reload = vi.fn();
    const fetchFn = serving(LOADED);
    const watch = watchForNewBuild({ doc: docWith(LOADED), win: window, fetchFn, reload, storage: memoryStorage() });
    watch.check();
    await settle();
    watch.check();
    await settle();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
    watch.stop();
  });

  it('reloads a tab at most once per served build across its reloads, and again for a newer one', async () => {
    // Each page load of the tab starts its own watcher; sessionStorage is the tab's and outlives them.
    const storage = memoryStorage();
    const reloads: number[] = [];
    for (const served of [SERVED, SERVED, SERVED, 'c0ffee0000000000000000000000000000000000']) {
      const reload = vi.fn();
      const watch = watchForNewBuild({ doc: docWith(LOADED), win: window, fetchFn: serving(served), reload, storage });
      watch.check();
      await settle();
      reloads.push(reload.mock.calls.length);
      watch.stop();
    }
    expect(reloads).toEqual([1, 0, 0, 1]);
  });

  it('makes no read from a hidden tab, and leaves the page alone when storage is blocked', async () => {
    const hiddenFetch = serving(SERVED);
    const hidden = watchForNewBuild({ doc: docWith(LOADED, 'hidden'), win: window, fetchFn: hiddenFetch, reload: vi.fn(), storage: memoryStorage() });
    hidden.check();
    await settle();
    expect(hiddenFetch).not.toHaveBeenCalled();
    hidden.stop();

    const reload = vi.fn();
    const watch = watchForNewBuild({ doc: docWith(LOADED), win: window, fetchFn: serving(SERVED), reload, storage: blocked });
    watch.check();
    await settle();
    expect(reload).not.toHaveBeenCalled();
    watch.stop();
  });

  it('runs one read at a time', async () => {
    let answer: (response: Response) => void = () => {};
    const fetchFn = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })) as unknown as typeof fetch;
    const watch = watchForNewBuild({ doc: docWith(LOADED), win: window, fetchFn, reload: vi.fn(), storage: memoryStorage() });
    watch.check();
    watch.check();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    answer(new Response(JSON.stringify({ sha: LOADED })));
    await settle();
    watch.check();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    watch.stop();
  });
});
