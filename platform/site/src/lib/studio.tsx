import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Snapshot, StudioSource } from './source';
import { errorMessage } from './supabase';

export const POLL_MS = 15_000;
export const REFRESH_DEBOUNCE_MS = 500;

export type StudioState =
  | { state: 'unconfigured' }
  | { state: 'loading' }
  | { state: 'ready'; snapshot: Snapshot }
  | { state: 'error'; message: string };

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

export function useStudio(): StudioState {
  const source = useContext(SourceContext);
  const [state, setState] = useState<StudioState>(
    source === null ? { state: 'unconfigured' } : { state: 'loading' },
  );

  useEffect(() => {
    if (source === null) return;
    let live = true;
    let latest = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      latest += 1;
      const request = latest;
      const current = () => live && request === latest;
      source
        .load()
        .then((snapshot) => {
          if (current()) setState({ state: 'ready', snapshot });
        })
        .catch((error: unknown) => {
          if (!current()) return;
          setState((previous) =>
            previous.state === 'ready' ? previous : { state: 'error', message: errorMessage(error) },
          );
        });
    };
    // Every change notice and poll tick goes through one trailing debounce so a burst of
    // realtime events produces a single reload.
    const refresh = () => {
      if (pending !== null) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        load();
      }, REFRESH_DEBOUNCE_MS);
    };
    load();
    const unsubscribe = source.subscribe(refresh);
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      live = false;
      if (pending !== null) clearTimeout(pending);
      unsubscribe();
      clearInterval(timer);
    };
  }, [source]);

  return state;
}
