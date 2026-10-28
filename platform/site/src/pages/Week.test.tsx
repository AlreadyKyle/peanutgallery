import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedDoc } from '../lib/community-types';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { Week } from './Week';

// /week (QUEUE Q-053): the week's figures and its funded and shipped cards from the public feed, or
// the unavailable line and no figure when the feed does not answer.

function answer(feed: FeedDoc | null) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => (String(input) === '/api/community/feed' && feed !== null ? json(feed) : json({}, 503))),
  );
}

async function renderPage() {
  render(
    <MemoryRouter>
      <Week />
    </MemoryRouter>,
  );
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function figure(label: string): string | null {
  const row = screen.getByText(label).closest('.stat');
  return row?.querySelector('dd')?.textContent ?? null;
}

describe('/week', () => {
  it("draws the week's figures and links its shipped and funded cards", async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-28T15:00:00Z') });
    answer({
      events: [
        { id: '1', at: '2026-10-28T10:00:00Z', kind: 'contribution', text: 'Someone put $2.00 on Faster gatherers', cardId: 'c1', amountCents: 200 },
        { id: '2', at: '2026-10-27T09:00:00Z', kind: 'stage', text: 'Faster gatherers is funded', cardId: 'c1' },
        { id: '3', at: '2026-10-27T11:00:00Z', kind: 'shipped', text: 'Brighter dust shipped', cardId: 'c2' },
        { id: '4', at: '2026-10-20T11:00:00Z', kind: 'shipped', text: 'Last week shipped', cardId: 'c9' },
      ],
      next: null,
    });
    await renderPage();
    const words = copy.week.figures;
    expect(figure(words.contributions.label)).toBe('1');
    expect(figure(words.funded.label)).toBe('1');
    expect(figure(words.shipped.label)).toBe('1');
    expect(figure(words.opened.label)).toBe('0');
    expect(figure(words.players.label)).toBe('0');
    expect(screen.getByText(copy.week.since.replace('{date}', '26 Oct 2026'))).toBeTruthy();
    const shipped = screen.getByRole('region', { name: copy.week.shippedTitle });
    expect(within(shipped).getByRole('link', { name: 'Brighter dust' }).getAttribute('href')).toBe('/card/c2');
    expect(within(shipped).queryByText('Last week')).toBeNull();
    const funded = screen.getByRole('region', { name: copy.week.fundedTitle });
    expect(within(funded).getByRole('link', { name: 'Faster gatherers' }).getAttribute('href')).toBe('/card/c1');
    // The page states no money: the amounts stay on the feed's own lines and the ledger.
    expect(document.querySelector('main')?.textContent).not.toContain('$');
  });

  it('says when nothing was funded or shipped yet, and points to a card to fund', async () => {
    answer({ events: [], next: null });
    await renderPage();
    expect(screen.getByText(copy.week.noneShipped)).toBeTruthy();
    expect(screen.getByText(copy.week.noneFunded)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.week.fundLink }).getAttribute('href')).toBe('/contribute');
  });

  it('shows no figure when the feed does not answer', async () => {
    answer(null);
    await renderPage();
    expect(screen.getByText(legal.partUnavailable)).toBeTruthy();
    expect(screen.queryByText(copy.week.figures.contributions.label)).toBeNull();
    expect(screen.queryByRole('region', { name: copy.week.shippedTitle })).toBeNull();
  });
});
