// A tab can outlive the build it loaded. Chrome and Safari keep the whole page in the
// back/forward cache, so a visitor who follows the Play link and presses Back comes back to the
// code that tab started with, which may be weeks old: an older design, older copy, older figures.
// Nothing on the server is stale; the page in the tab is. On a restore, whenever the tab becomes
// visible again, and on every move to another page inside the site (docs/specs/site-snapshot.md),
// the page asks which build the site serves now and reloads when it is no longer running that one,
// so the reader lands on the page they chose, in the new build. Nothing reloads a page someone is
// reading without their navigating or returning, and a tab reloads at most once for each served
// build, so a CDN still serving the old index.html cannot cause a loop.

export const BUILD_SHA_SELECTOR = 'meta[name="build-sha"]';
export const VERSION_URL = '/version.json';
/** The sessionStorage key holding the served build this tab last reloaded for. */
export const RELOADED_KEY = 'pg:reloaded-for';

export interface FreshnessDeps {
  doc: Document;
  win: Window;
  fetchFn: typeof fetch;
  reload: () => void;
  /** The tab's sessionStorage, or null when the browser blocks it; then the page is never reloaded. */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** The tab's sessionStorage, or null when reading it throws (storage blocked by the browser). */
export function safeSessionStorage(win: Window = window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

/** The build this page is running, stamped into the HTML at build time; empty when it is missing. */
export function loadedBuildSha(doc: Document): string {
  return doc.querySelector(BUILD_SHA_SELECTOR)?.getAttribute('content')?.trim() ?? '';
}

/** The build the site serves now, or null when it cannot be read; never from the cache. */
export async function servedBuildSha(fetchFn: typeof fetch, url = VERSION_URL): Promise<string | null> {
  try {
    const response = await fetchFn(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const sha = typeof body === 'object' && body !== null ? (body as { sha?: unknown }).sha : null;
    return typeof sha === 'string' && sha !== '' ? sha : null;
  } catch {
    // Offline, or the file is not JSON: the page stays as it is and the next check tries again.
    return null;
  }
}

/**
 * Reloads when the page is running a build the site no longer serves and this tab has not already
 * reloaded for that build. A hidden tab, a page with no stamped build, a failed read, a matching
 * build and blocked storage all leave the page alone.
 */
export async function reloadWhenStale(deps: FreshnessDeps): Promise<boolean> {
  if (deps.doc.visibilityState !== 'visible') return false;
  const loaded = loadedBuildSha(deps.doc);
  if (loaded === '') return false;
  const served = await servedBuildSha(deps.fetchFn);
  if (served === null || served === loaded) return false;
  try {
    if (deps.storage === null || deps.storage.getItem(RELOADED_KEY) === served) return false;
    deps.storage.setItem(RELOADED_KEY, served);
  } catch {
    return false;
  }
  deps.reload();
  return true;
}

export type BuildWatch = {
  /** Checks now; App.tsx calls it on every route change after the first render. */
  check: () => void;
  /** Stops watching. */
  stop: () => void;
};

/**
 * Watches for a page that has fallen behind: a back/forward restore (`pageshow` with `persisted`),
 * every return to the tab, and every call to `check` (a route change). One read runs at a time, and
 * once a reload has started no other check runs, so a reload that is slow to start cannot stack up.
 */
export function watchForNewBuild(deps: FreshnessDeps): BuildWatch {
  let reloading = false;
  let reading = false;
  const check = () => {
    if (reloading || reading) return;
    reading = true;
    void reloadWhenStale(deps)
      .then((stale) => {
        reloading = reloading || stale;
      })
      .finally(() => {
        reading = false;
      });
  };
  const onPageShow = (event: Event) => {
    if ('persisted' in event && (event as PageTransitionEvent).persisted) check();
  };
  deps.win.addEventListener('pageshow', onPageShow);
  deps.doc.addEventListener('visibilitychange', check);
  return {
    check,
    stop: () => {
      deps.win.removeEventListener('pageshow', onPageShow);
      deps.doc.removeEventListener('visibilitychange', check);
    },
  };
}
