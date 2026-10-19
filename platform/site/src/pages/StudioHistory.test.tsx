import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioDoc, StudioEra } from '../lib/community-types';
import { copy } from '../lib/copy';
import { StudioHistory } from './StudioHistory';

// /studio/history writes an era's stations and decor in words, never the database's ids.

const garage: StudioEra = {
  id: 'garage',
  index: 0,
  name: 'Garage',
  reachedAt: '2026-10-01T00:00:00Z',
  unlockedBy: 'Where the studio starts.',
  stations: ['desks', 'whiteboard', 'test_bench', 'gate', 'shipping_dock'],
  decor: ['trophy_shelf', 'new_thing'],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/studio/history', () => {
  it('names the stations and decor in words, and an id it has no words for with spaces', async () => {
    const doc: StudioDoc = { era: garage, eras: [garage] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    render(
      <MemoryRouter>
        <StudioHistory />
      </MemoryRouter>,
    );
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText(copy.history.stations).nextElementSibling?.textContent).toBe('desks, whiteboard, test bench, gate, shipping dock');
    expect(screen.getByText(copy.history.decor).nextElementSibling?.textContent).toBe('trophy shelf, new thing');
    expect(document.querySelector('.blueprint-facts')?.textContent).not.toMatch(/_/);
  });
});
