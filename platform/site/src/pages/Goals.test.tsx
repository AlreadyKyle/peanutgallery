import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalsDoc, StudioDoc } from '../lib/community-types';
import { copy } from '../lib/copy';
import { Goals } from './Goals';

// /goals: the track measures lifetime funding against the milestones, so with none set it draws no
// bar at all; a full bar over "No milestones are set yet." would read as a goal reached.

function answer(doc: GoalsDoc, studio: StudioDoc | null = null) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      String(input) === '/api/community/goals' ? json(doc) : String(input) === '/api/community/studio' && studio !== null ? json(studio) : json({}, 404),
    ),
  );
}

const era = (index: number, name: string, unlockedBy: string, reachedAt: string | null) => ({
  id: name.toLowerCase(),
  index,
  name,
  unlockedBy,
  reachedAt,
  stations: [],
  decor: [],
});
const garage = era(0, 'Garage', 'Where the studio starts.', '2026-10-17T18:19:20Z');
const STUDIO: StudioDoc = {
  era: garage,
  eras: [era(2, 'Studio', 'Reached when the studio has raised $10,000 in all.', null), garage, era(1, 'Workshop', 'Reached when the studio has raised $1,000 in all.', null)],
};

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

  // No empty rooms (QUEUE Q-012): with no milestone the page says what the money grows next, from the
  // studio's own eras, and leads to a card to fund; it names no milestone of its own.
  it('names the next era from the studio document and leads to a card to fund while no milestone is set', async () => {
    answer({ lifetimeCents: 500, goals: [] }, STUDIO);
    await renderPage();
    expect(screen.getByText(`${copy.goals.nextEra.replace('{era}', 'Workshop')} Reached when the studio has raised $1,000 in all.`)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.goals.erasLink }).getAttribute('href')).toBe('/studio/history');
    expect(screen.getByText(copy.goals.none).closest('.empty-state')).not.toBeNull();
    expect(screen.getByRole('link', { name: copy.goals.fundLink }).getAttribute('href')).toBe('/contribute');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('draws no era line when the studio document does not answer, and invents none', async () => {
    answer({ lifetimeCents: 500, goals: [] });
    await renderPage();
    expect(screen.getByText(copy.goals.none)).toBeTruthy();
    expect(document.querySelector('.goals-era')).toBeNull();
  });

  it('draws no era line once every era is reached', async () => {
    answer({ lifetimeCents: 500, goals: [] }, { era: garage, eras: [garage] });
    await renderPage();
    expect(document.querySelector('.goals-era')).toBeNull();
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
    expect(document.querySelector('.goals-era')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'A second game' })).toBeTruthy();
  });
});
