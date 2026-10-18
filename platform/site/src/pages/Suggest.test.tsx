import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SuggestionSummary } from '../lib/community-types';
import { copy } from '../lib/copy';
import { Suggest, totalFrom } from './Suggest';

// /suggest: an upvote shows the total the RPC answered with (the cached list cannot say whether this
// player already upvoted), a title of only spaces says so, and Show more reads the next page.

type Sent = { url: string; body: unknown };
let sent: Sent[] = [];
let total = 5;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function item(id: string, upvotes: number): SuggestionSummary {
  return { id, area: 'dust', title: `Idea ${id}`, summary: null, state: 'received', declineReason: null, upvotes, clusterId: null, cardId: null, author: null, createdAt: '2026-10-01T00:00:00Z' };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  sent = [];
  total = 5;
  window.localStorage.setItem('mm:player-session', JSON.stringify({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresAt: Date.now() + 3_600_000 }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/community/rpc/vote_suggestion') return json(200, { votes: total });
      if (url === '/api/community/suggestions?sort=top') return json(200, { items: [item('a', 5)], next: 'c1' });
      if (url === '/api/community/suggestions?sort=top&cursor=c1') return json(200, { items: [item('b', 2)], next: null });
      return json(404, { error: 'unknown' });
    }),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <Suggest />
    </MemoryRouter>,
  );
}

describe('/suggest', () => {
  it('reads the total from the answer', () => {
    expect(totalFrom({ votes: 7 })).toBe(7);
    expect(totalFrom(null)).toBeNull();
    expect(totalFrom({})).toBeNull();
  });

  it('shows the total the RPC answered with after an upvote, never the list count plus one', async () => {
    renderPage();
    await settle();
    const button = screen.getByRole('button', { name: copy.suggest.backIdea.replace('{title}', 'Idea a') });
    expect(within(button).getByText('5')).toBeTruthy();
    // The cached list already counted this player: the server's total stays 5.
    fireEvent.click(button);
    await settle();
    expect(sent.find((s) => s.url.endsWith('vote_suggestion'))?.body).toEqual({ id: 'a', value: 1 });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(within(button).getByText('5')).toBeTruthy();
    total = 4;
    fireEvent.click(button);
    await settle();
    expect(sent.filter((s) => s.url.endsWith('vote_suggestion')).at(-1)?.body).toEqual({ id: 'a', value: 0 });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(within(button).getByText('4')).toBeTruthy();
  });

  it('says a title of only spaces does not count, and sends nothing', async () => {
    renderPage();
    await settle();
    fireEvent.change(screen.getByLabelText(copy.suggest.titleLabel), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText(copy.suggest.bodyLabel), { target: { value: 'A real description' } });
    fireEvent.click(screen.getByRole('button', { name: copy.suggest.send }));
    await settle();
    expect(screen.getByText(copy.suggest.blank)).toBeTruthy();
    expect(screen.getByLabelText(copy.suggest.titleLabel).getAttribute('aria-invalid')).toBe('true');
    expect(sent.filter((s) => s.url.includes('submit_suggestion'))).toEqual([]);
  });

  it('shows more with the cursor and appends the next page', async () => {
    renderPage();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: copy.suggest.more }));
    await settle();
    expect(sent.some((s) => s.url === '/api/community/suggestions?sort=top&cursor=c1')).toBe(true);
    expect(screen.getByText('Idea a')).toBeTruthy();
    expect(screen.getByText('Idea b')).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.suggest.more })).toBeNull();
  });
});
