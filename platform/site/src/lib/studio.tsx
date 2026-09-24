import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Snapshot, StudioSource } from './source';
import { errorMessage } from './supabase';
import { legal } from './legal';

// Kernel (docs/specs/board-site.md): the one load and poll of the snapshot every figure on the site
// comes through. It reads the site's own /api documents (docs/specs/site-snapshot.md) once a minute,
// only while the tab is visible: a hidden tab makes no request, and a return to the tab loads at once.
// A failed load is retried after a minute, the wait doubling to at most ten minutes, and a success
// resets it.
export const POLL_MS = 60_000;
export const BACKOFF_MAX_MS = 600_000;

export type StudioState =
  | { state: 'unconfigured' }
  | { state: 'loading' }
  /** stale: the last refresh failed, so the snapshot on screen may be out of date. */
  | { state: 'ready'; snapshot: Snapshot; stale: boolean }
  | { state: 'error'; message: string };

/** The line shown when figures are missing: not set up yet, or failed to load right now. */
export function unavailableLine(studio: StudioState): string {
  return studio.state === 'error' ? legal.partUnavailable : legal.meterUnavailable;
}

const SourceContext = createContext<StudioSource | null>(null);

export function SourceProvider({
  source,
  children,
}: {
  source: StudioSource | null;
  children: ReactNode;
}) {
  return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>;
}

const StudioContext = createContext<StudioState | null>(null);

/**
 * Loads the snapshot once for everything beneath it. A component under this provider that calls
 * useStudio() reads the shared state instead of starting its own load and poll.
 */
export function StudioProvider({ children }: { children: ReactNode }) {
  const state = useStudioLoad(true);
  return <StudioContext.Provider value={state}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioState {
  const shared = useContext(StudioContext);
  const own = useStudioLoad(shared === null);
  return shared ?? own;
}

function useStudioLoad(active: boolean): StudioState {
  const provided = useContext(SourceContext);
  const source = active ? provided : null;
  const [state, setState] = useState<StudioState>(
    source === null ? { state: 'unconfigured' } : { state: 'loading' },
  );

  useEffect(() => {
    if (source === null) return;
    let live = true;
    let latest = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retryMs = POLL_MS;
    const visible = () => document.visibilityState === 'visible';
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const schedule = (ms: number) => {
      clear();
      if (live && visible()) timer = setTimeout(load, ms);
    };
    function load() {
      clear();
      latest += 1;
      const request = latest;
      const current = () => live && request === latest;
      source!
        .load()
        .then((snapshot) => {
          if (!current()) return;
          setState({ state: 'ready', snapshot, stale: false });
          retryMs = POLL_MS;
          schedule(POLL_MS);
        })
        .catch((error: unknown) => {
          if (!current()) return;
          // Once figures are on screen, a failed refresh keeps them and marks them stale rather
          // than blanking the page; the next successful load clears the mark.
          setState((previous) => {
            if (previous.state !== 'ready') return { state: 'error', message: errorMessage(error) };
            return previous.stale ? previous : { ...previous, stale: true };
          });
          schedule(retryMs);
          retryMs = Math.min(retryMs * 2, BACKOFF_MAX_MS);
        });
    }
    const onVisibility = () => {
      if (visible()) load();
      else clear();
    };
    if (visible()) load();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [source]);

  return state;
}
