import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalsDoc } from '../lib/community-types';
import { copy } from '../lib/copy';
import { Goals } from './Goals';

// /goals: the track measures lifetime funding against the milestones, so with none set it draws no
// bar at all; a full bar over "No milestones are set yet." would read as a goal reached.

function answer(doc: GoalsDoc) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      String(input) === '/api/community/goals'
        ? new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }),
    ),
  );
}

async function renderPage() {
  render(
    <MemoryRouter>
      <Goals />
    </MemoryRouter>,
  );
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/goals', () => {
  it('draws no track with no milestone set, only the total and the line that none is set', async () => {
    answer({ lifetimeCents: 600, goals: [] });
    await renderPage();
    expect(screen.getByText('$6.00')).toBeTruthy();
    expect(screen.getByText(copy.goals.none)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(document.querySelector('.funding-bar-fill')).toBeNull();
  });

  it('draws the track against the milestones once one is set', async () => {
    answer({
      lifetimeCents: 600,
      goals: [{ id: 'g1', amountCents: 2400, title: 'A second game', outcome: 'The studio starts a second game.', state: 'next', reachedAt: null, link: null }],
    });
    await renderPage();
    const track = screen.getByRole('progressbar', { name: copy.goals.trackLabel });
    expect(track.getAttribute('aria-valuemax')).toBe('24');
    expect(track.getAttribute('aria-valuenow')).toBe('6');
    expect(screen.queryByText(copy.goals.none)).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'A second game' })).toBeTruthy();
  });
});
