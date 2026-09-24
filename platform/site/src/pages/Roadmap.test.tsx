import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import type { Card, Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Roadmap } from './Roadmap';

const roadmap = copy.roadmap;

function card(overrides: Partial<Card>): Card {
  return {
    id: 'c',
    title: 'A card',
    summary: null,
    intent: null,
    source: 'board',
    stage: 'proposed',
    shape: 'goal',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'next',
    rank: null,
    executor_role_id: null,
    funding_target_usd: 0,
    funded_usd: 0,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

const cards = [
  card({ id: 'n2', title: 'Free picks', summary: 'Choose the next card without paying.', rank: 2 }),
  card({ id: 'n1', title: 'Card drafting', rank: 1 }),
  card({ id: 'ns', title: 'Board on its own site', folder: 'platform', bucket: 'studio', rank: 3 }),
  card({ id: 'l1', title: 'Seasons', horizon: 'later' }),
  card({ id: 'now1', title: 'Open now', horizon: 'now', funding_target_usd: 3 }),
];

function snapshot(list: Card[]): Snapshot {
  return {
    pool: null,
    cards: list,
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

function renderRoadmap(source: StudioSource | null) {
  return render(
    <SourceProvider source={source}>
      <MemoryRouter>
        <Roadmap />
      </MemoryRouter>
    </SourceProvider>,
  );
}

function sourceOf(list: Card[]): StudioSource {
  return { load: () => Promise.resolve(snapshot(list)) };
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Roadmap', () => {
  it('says both ways a planned card opens for funding: the board moves it, or an approved agent card moves by itself', () => {
    // An approved agent card sits on next until the tick deals it to now after the cooling window.
    expect(roadmap.lede).toContain('the board moves its own cards there');
    expect(roadmap.lede).toContain('a card an agent drafted moves there by itself once it is approved');
    expect(roadmap.lede).not.toContain('until the board moves them');
  });

  it('says which role wrote an approved agent card waiting on next, and nothing on the cards the board filed', async () => {
    const drafted = card({ id: 'd1', title: 'Gatherers cost 11', summary: 'The gatherer costs one more.', source: 'agent', drafter_role_id: 'r-designer', rank: 4 });
    const source: StudioSource = {
      load: () =>
        Promise.resolve({
          ...snapshot([...cards, drafted]),
          roles: [{ id: 'r-designer', name: 'Game Designer', title: 'Game Designer', description: null, species_note: 'A small red creature.', model: 'claude-opus-5-5', write_access: true, state: 'active', hired_at: '2026-09-14T00:00:00Z' }],
        }),
    };
    renderRoadmap(source);
    const next = await screen.findByRole('region', { name: roadmap.horizons.next });
    const bylines = next.querySelectorAll('.card-byline');
    expect([...bylines].map((b) => b.textContent)).toEqual(['Written by the Game Designer, an AI agent']);
    expect(bylines[0]!.closest('li')!.querySelector('h3')!.textContent).toBe('Gatherers cost 11');
  });

  it('lists next and later cards by horizon in rank order as rail rows, the suit in the rail, each labelled planned', async () => {
    renderRoadmap(sourceOf(cards));
    const next = await screen.findByRole('region', { name: roadmap.horizons.next });
    expect(within(next).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Card drafting',
      'Free picks',
      'Board on its own site',
    ]);
    expect([...next.querySelectorAll('li .row-rail [data-suit]')].map((tag) => tag.textContent)).toEqual([
      copy.categories.game,
      copy.categories.game,
      copy.categories.studio,
    ]);
    expect(within(next).getByText('Choose the next card without paying.')).toBeTruthy();
    expect(within(next).getAllByText(roadmap.planned)).toHaveLength(3);
    const later = screen.getByRole('region', { name: roadmap.horizons.later });
    expect(within(later).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Seasons']);
  });

  it('never shows a card on horizon now, a bar, a status or a fund link', async () => {
    const { container } = renderRoadmap(sourceOf(cards));
    await screen.findByRole('region', { name: roadmap.horizons.next });
    expect(screen.queryByText('Open now')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(copy.statusOpen)).toBeNull();
    expect(screen.queryByText(legal.fundThis)).toBeNull();
    expect(container.innerHTML).not.toContain('buy.stripe.com');
  });

  it('says when a horizon has nothing planned', async () => {
    renderRoadmap(sourceOf([card({ id: 'n', title: 'Only next' })]));
    const later = await screen.findByRole('region', { name: roadmap.horizons.later });
    expect(within(later).getByText(roadmap.empty)).toBeTruthy();
  });

  it('shows the loading and unavailable lines', () => {
    renderRoadmap(null);
    expect(screen.getByText(legal.meterUnavailable)).toBeTruthy();
  });
});
