import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkErrorFromHash } from './account';
import { useCommunity, usePagedCommunity, withCursor } from './community';
import { labelOrder, visibleLabels } from './ticks';

// useCommunity holds one path's document; usePagedCommunity appends the next pages with the cursor.

type Answer = { status: number; body: unknown };
let answers: Record<string, Answer> = {};
let asked: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  answers = {};
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      asked.push(url);
      const answer = answers[url] ?? { status: 503, body: { error: 'down' } };
      return json(answer.status, answer.body);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useCommunity', () => {
  it('shows a new path that fails as unavailable, never the previous path list', async () => {
    answers['/api/community/seeds?sort=trending'] = { status: 200, body: { items: [{ id: 'a' }], next: null } };
    const { result, rerender } = renderHook(({ path }) => useCommunity<{ items: { id: string }[] }>(path), { initialProps: { path: '/seeds?sort=trending' } });
    await settle();
    expect(result.current.state).toBe('ready');
    rerender({ path: '/seeds?sort=new' });
    expect(result.current.state).toBe('loading');
    await settle();
    expect(result.current.state).toBe('unavailable');
  });

  it('keeps the list when a refresh of the same path fails, and reads again on reload', async () => {
    answers['/api/community/goals'] = { status: 200, body: { lifetimeCents: 1, goals: [] } };
    const { result } = renderHook(() => useCommunity<{ lifetimeCents: number }>('/goals'));
    await settle();
    expect(result.current.state).toBe('ready');
    delete answers['/api/community/goals'];
    act(() => result.current.reload());
    await settle();
    expect(result.current.state).toBe('ready');
  });

  it('tries again from unavailable: loading, then the document', async () => {
    const { result } = renderHook(() => useCommunity<{ lifetimeCents: number }>('/goals'));
    await settle();
    expect(result.current.state).toBe('unavailable');
    answers['/api/community/goals'] = { status: 200, body: { lifetimeCents: 1, goals: [] } };
    act(() => result.current.reload());
    expect(result.current.state).toBe('loading');
    await settle();
    expect(result.current.state).toBe('ready');
  });
});

describe('usePagedCommunity', () => {
  it('adds the cursor to the query', () => {
    expect(withCursor('/seeds?sort=new', 'abc=')).toBe('/seeds?sort=new&cursor=abc%3D');
    expect(withCursor('/feed', 'x')).toBe('/feed?cursor=x');
  });

  it('appends the next page, stops at the last, and starts again on a new path', async () => {
    answers['/api/community/seeds?sort=new'] = { status: 200, body: { items: [{ id: '1' }, { id: '2' }], next: 'c1' } };
    answers['/api/community/seeds?sort=new&cursor=c1'] = { status: 200, body: { items: [{ id: '2' }, { id: '3' }], next: null } };
    answers['/api/community/seeds?sort=top_all'] = { status: 200, body: { items: [{ id: '9' }], next: 'c9' } };
    const { result, rerender } = renderHook(({ path }) => usePagedCommunity<{ id: string }>(path), { initialProps: { path: '/seeds?sort=new' } });
    await settle();
    expect(result.current.items.map((item) => item.id)).toEqual(['1', '2']);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    expect(result.current.loadingMore).toBe(true);
    await settle();
    expect(result.current.items.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(result.current.hasMore).toBe(false);
    rerender({ path: '/seeds?sort=top_all' });
    await settle();
    expect(result.current.items.map((item) => item.id)).toEqual(['9']);
    expect(result.current.hasMore).toBe(true);
  });

  it('says when the next page did not load and keeps the button', async () => {
    answers['/api/community/suggestions?sort=top'] = { status: 200, body: { items: [{ id: '1' }], next: 'c1' } };
    const { result } = renderHook(() => usePagedCommunity<{ id: string }>('/suggestions?sort=top'));
    await settle();
    act(() => result.current.loadMore());
    await settle();
    expect(result.current.moreFailed).toBe(true);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.items.map((item) => item.id)).toEqual(['1']);
  });
});

describe('a failed magic link', () => {
  it('reads an expired or used link as expired, any other error as failed, and a session as neither', () => {
    expect(linkErrorFromHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toBe('expired');
    expect(linkErrorFromHash('#error=server_error&error_description=x')).toBe('failed');
    expect(linkErrorFromHash('#access_token=a&refresh_token=b')).toBeNull();
    expect(linkErrorFromHash('')).toBeNull();
  });
});

describe('goal labels', () => {
  it('keeps the next goal and the end first, then hides labels that would touch', () => {
    // $50, $100, $500 (next), $5,000 on a 358px track: the first two overlap.
    const boxes = [
      { left: 0, right: 48 },
      { left: 6, right: 61 },
      { left: 30, right: 85 },
      { left: 300, right: 358 },
    ];
    expect(labelOrder(['reached', 'reached', 'next', 'later'])).toEqual([2, 3, 0, 1]);
    expect(visibleLabels(boxes, labelOrder(['reached', 'reached', 'next', 'later']))).toEqual([false, false, true, true]);
    expect(visibleLabels(boxes, [0, 1, 2, 3])).toEqual([true, false, false, true]);
  });

  it('shows every label it could not measure', () => {
    expect(visibleLabels([{ left: 0, right: 0 }, { left: 0, right: 0 }], [0, 1])).toEqual([true, true]);
  });
});
