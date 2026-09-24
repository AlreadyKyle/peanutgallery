import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot, StudioSource } from './source';
import { BACKOFF_MAX_MS, POLL_MS, SourceProvider, useStudio } from './studio';

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

let visibility: DocumentVisibilityState = 'visible';

/** Sets the tab's visibility and tells the page, as the browser does. */
function setVisibility(value: DocumentVisibilityState) {
  visibility = value;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function controlledSource() {
  const loads: Pending[] = [];
  const source: StudioSource = {
    load: () =>
      new Promise<Snapshot>((resolve, reject) => {
        loads.push({ resolve, reject });
      }),
  };
  // A return to the tab loads at once, which the tests use to ask for the next load.
  return { source, loads, notify: () => setVisibility('visible') };
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
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
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
    await act(async () => loads[1]?.reject(new Error('network down')));
    expect(balanceOf(result)).toBe(10);
  });

  it('marks the kept snapshot stale after a failed refresh and clears it on the next successful load', async () => {
    const { source, loads, notify } = controlledSource();
    const { result } = renderStudio(source);
    await act(async () => loads[0]?.resolve(snapshotWithBalance(10)));
    expect(staleOf(result)).toBe(false);

    notify();
    await act(async () => loads[1]?.reject(new Error('network down')));
    expect(staleOf(result)).toBe(true);
    expect(balanceOf(result)).toBe(10);

    notify();
    await act(async () => loads[2]?.reject(new Error('still down')));
    expect(staleOf(result)).toBe(true);

    notify();
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
    expect(loads).toHaveLength(2);

    await act(async () => loads[1]?.resolve(snapshotWithBalance(20)));
    expect(balanceOf(result)).toBe(20);

    await act(async () => loads[0]?.resolve(snapshotWithBalance(10)));
    expect(balanceOf(result)).toBe(20);
  });

  it('reads every 60 seconds while visible, counting from the end of each load', async () => {
    const { source, loads } = controlledSource();
    renderStudio(source);
    expect(POLL_MS).toBe(60_000);
    expect(loads).toHaveLength(1);
    await flush(POLL_MS * 2);
    expect(loads).toHaveLength(1);
    await act(async () => loads[0]?.resolve(snapshotWithBalance(1)));
    await flush(POLL_MS - 1);
    expect(loads).toHaveLength(1);
    await flush(1);
    expect(loads).toHaveLength(2);
    await act(async () => loads[1]?.resolve(snapshotWithBalance(2)));
    await flush(POLL_MS);
    expect(loads).toHaveLength(3);
  });

  it('makes no load while the tab is hidden, and loads at once on a return', async () => {
    const { source, loads } = controlledSource();
    const { result } = renderStudio(source);
    await act(async () => loads[0]?.resolve(snapshotWithBalance(1)));
    setVisibility('hidden');
    await flush(3 * 60_000);
    expect(loads).toHaveLength(1);
    setVisibility('visible');
    expect(loads).toHaveLength(2);
    await act(async () => loads[1]?.resolve(snapshotWithBalance(2)));
    expect(balanceOf(result)).toBe(2);
  });

  it('makes no load from a tab opened hidden until it is shown', async () => {
    visibility = 'hidden';
    const { source, loads } = controlledSource();
    const { result } = renderStudio(source);
    await flush(3 * 60_000);
    expect(loads).toHaveLength(0);
    expect(result.current.state).toBe('loading');
    setVisibility('visible');
    expect(loads).toHaveLength(1);
  });

  it('retries a failed load after 60 seconds, doubling to 10 minutes, and a success resets the wait', async () => {
    const { source, loads } = controlledSource();
    renderStudio(source);
    await act(async () => loads[0]?.resolve(snapshotWithBalance(1)));
    await flush(POLL_MS);
    expect(loads).toHaveLength(2);
    /** How long until the next load starts, in 5-second steps. */
    const waitForNext = async () => {
      const before = loads.length;
      let waited = 0;
      while (loads.length === before && waited <= BACKOFF_MAX_MS) {
        await flush(5_000);
        waited += 5_000;
      }
      return waited;
    };
    const waits: number[] = [];
    for (let n = 0; n < 6; n += 1) {
      await act(async () => loads[loads.length - 1]?.reject(new Error('down')));
      waits.push(await waitForNext());
    }
    expect(BACKOFF_MAX_MS).toBe(600_000);
    expect(waits).toEqual([60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
    await act(async () => loads[loads.length - 1]?.resolve(snapshotWithBalance(2)));
    expect(await waitForNext()).toBe(60_000);
    await act(async () => loads[loads.length - 1]?.reject(new Error('down')));
    expect(await waitForNext()).toBe(60_000);
  });

  it('stops loading after unmount', async () => {
    const { source, loads } = controlledSource();
    const { unmount } = renderStudio(source);
    await act(async () => loads[0]?.resolve(snapshotWithBalance(1)));
    unmount();
    await flush(POLL_MS * 2);
    setVisibility('visible');
    expect(loads).toHaveLength(1);
  });
});
