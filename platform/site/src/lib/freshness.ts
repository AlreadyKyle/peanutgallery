// A tab can outlive the build it loaded. Chrome and Safari keep the whole page in the
// back/forward cache, so a visitor who follows the Play link and presses Back comes back to the
// code that tab started with, which may be weeks old: an older design, older copy, older figures.
// Nothing on the server is stale; the page in the tab is. On a restore, and whenever the tab
// becomes visible again, the page asks which build the site serves now and reloads when it is no
// longer running that one.

export const BUILD_SHA_SELECTOR = 'meta[name="build-sha"]';
export const VERSION_URL = '/version.json';

export interface FreshnessDeps {
  doc: Document;
  win: Window;
  fetchFn: typeof fetch;
  reload: () => void;
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
 * Reloads once when the page is running a build the site no longer serves. A page with no
 * stamped build, a failed read and a matching build all leave the page alone.
 */
export async function reloadWhenStale(deps: FreshnessDeps): Promise<boolean> {
  if (deps.doc.visibilityState !== 'visible') return false;
  const loaded = loadedBuildSha(deps.doc);
  if (loaded === '') return false;
  const served = await servedBuildSha(deps.fetchFn);
  if (served === null || served === loaded) return false;
  deps.reload();
  return true;
}

/**
 * Watches for a page that has fallen behind: a back/forward restore (`pageshow` with `persisted`)
 * and every return to the tab. Returns a function that stops watching. It reloads at most once,
 * so a reload that is slow to start cannot stack up.
 */
export function watchForNewBuild(deps: FreshnessDeps): () => void {
  let reloading = false;
  const check = () => {
    if (reloading) return;
    void reloadWhenStale(deps).then((stale) => {
      reloading = reloading || stale;
    });
  };
  const onPageShow = (event: Event) => {
    if ('persisted' in event && (event as PageTransitionEvent).persisted) check();
  };
  deps.win.addEventListener('pageshow', onPageShow);
  deps.doc.addEventListener('visibilitychange', check);
  return () => {
    deps.win.removeEventListener('pageshow', onPageShow);
    deps.doc.removeEventListener('visibilitychange', check);
  };
}
