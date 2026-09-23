import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot, StudioSource } from './source';
import { POLL_MS, REFRESH_DEBOUNCE_MS, SourceProvider, useStudio } from './studio';

function snapshotWithBalance(balance: number): Snapshot {
  return {
    pool: {
      balance_usd: balance,
      reserve_usd: 0,
      incident_reserve_usd: 0,
      held_usd: 0,
      daily_spent_usd: 0,
      day: '2026-09-14',
    },
    cards: [],
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    missing: [],
  };
}

type Pending = { resolve: (snapshot: Snapshot) => void; reject: (error: Error) => void };

function controlledSource() {
  const loads: Pending[] = [];
  let onChange: () => void = () => {};
  const source: StudioSource = {
    load: () =>
      new Promise<Snapshot>((resolve, reject) => {
        loads.push({ resolve, reject });
      }),
    subscribe: (callback) => {
      onChange = callback;
      return () => {};
    },
  };
  return { source, loads, notify: () => onChange() };
}

function renderStudio(source: StudioSource | null) {
  return renderHook(() => useStudio(), {
    wrapper: ({ children }) => <SourceProvider source={source}>{children}</SourceProvider>,
  });
}

function staleOf(result: { current: ReturnType<typeof useStudio> }): boolean | null {
  const state = result.current;
  return state.state === 'ready' ? state.stale : null;
}

function balanceOf(result: { current: ReturnType<typeof useStudio> }): number | null {
  const state = result.current;
  return state.state === 'ready' ? (state.snapshot.pool?.balance_usd ?? null) : null;
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useStudio', () => {
  it('is unconfigured without a source', () => {
    const { result } = renderStudio(null);
    expect(result.current).toEqual({ state: 'unconfigured' });
  });

  it('keeps the last snapshot when a later load fails', async () => {
    const { source, loads, notify } = controlledSource();
    const { result } = renderStudio(source);
    expect(result.current.state).toBe('loading');

    await act(async () => loads[0]?.resolve(snapshotWithBalance(10)));
    expect(balanceOf(result)).toBe(10);
    expect(staleOf(result)).toBe(false);

    notify();
    await flush(REFRESH_DEBOUNCE_MS);
    await act(async () => loads[1]?.reject(new Error('network down')));
    expect(balanceOf(result)).toBe(10);
  });

  it('marks the kept snapshot stale after a failed refresh and clears it on the next successful load', async () => {
    const { source, loads, notify } = controlledSource();
    const { result } = renderStudio(source);
    await act(async () => loads[0]?.resolve(snapshotWithBalance(10)));
    expect(staleOf(result)).toBe(false);

    notify();
    await flush(REFRESH_DEBOUNCE_MS);
    await act(async () => loads[1]?.reject(new Error('network down')));
    expect(staleOf(result)).toBe(true);
    expect(balanceOf(result)).toBe(10);

    notify();
    await flush(REFRESH_DEBOUNCE_MS);
    await act(async () => loads[2]?.reject(new Error('still down')));
    expect(staleOf(result)).toBe(true);

    notify();
    await flush(REFRESH_DEBOUNCE_MS);
    await act(async () => loads[3]?.resolve(snapshotWithBalance(12)));
    expect(staleOf(result)).toBe(false);
    expect(balanceOf(result)).toBe(12);
  });

  it('reports the error when no snapshot has loaded yet', async () => {
    const { source, loads } = controlledSource();
    const { result } = renderStudio(source);
    await act(async () => loads[0]?.reject(new Error('network down')));
    expect(result.current).toEqual({ state: 'error', message: 'network down' });
  });

  it('ignores an older load that resolves after a newer one', async () => {
    const { source, loads, notify } = controlledSource();
    const { result } = renderStudio(source);

    notify();
    await flush(REFRESH_DEBOUNCE_MS);
    expect(loads).toHaveLength(2);

    await act(async () => loads[1]?.resolve(snapshotWithBalance(20)));
    expect(balanceOf(result)).toBe(20);

    await act(async () => loads[0]?.resolve(snapshotWithBalance(10)));
    expect(balanceOf(result)).toBe(20);
  });

  it('collapses rapid change notices into one load', async () => {
    const { source, loads, notify } = controlledSource();
    renderStudio(source);
    expect(loads).toHaveLength(1);

    notify();
    await flush(REFRESH_DEBOUNCE_MS - 100);
    notify();
    await flush(REFRESH_DEBOUNCE_MS - 100);
    expect(loads).toHaveLength(1);

    await flush(100);
    expect(loads).toHaveLength(2);
  });

  it('polls on the fixed interval', async () => {
    const { source, loads } = controlledSource();
    renderStudio(source);
    expect(loads).toHaveLength(1);

    await flush(POLL_MS - 1);
    expect(loads).toHaveLength(1);
    await flush(1 + REFRESH_DEBOUNCE_MS);
    expect(loads).toHaveLength(2);
    await flush(POLL_MS + REFRESH_DEBOUNCE_MS);
    expect(loads).toHaveLength(3);
  });

  it('stops loading after unmount', async () => {
    const { source, loads } = controlledSource();
    const { unmount } = renderStudio(source);
    unmount();
    await flush(POLL_MS + REFRESH_DEBOUNCE_MS);
    expect(loads).toHaveLength(1);
  });
});
