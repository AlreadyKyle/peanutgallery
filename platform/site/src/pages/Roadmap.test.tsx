import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import type { Card, Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Roadmap, roadmapGroup } from './Roadmap';

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
  card({ id: 'nb', title: 'Voter identity', folder: 'platform', bucket: 'platform', rank: 4, board_work: true }),
  card({ id: 'nq', title: 'A bug button', folder: 'seed-1', bucket: 'qa', rank: 5, board_work: true }),
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
    expect(bylines[0]!.closest('li')!.querySelector('h4')!.textContent).toBe('Gatherers cost 11');
  });

  it('groups each horizon by folder and the board-work marker, never by bucket (docs/specs/copy-pass.md)', () => {
    expect(roadmapGroup(card({ folder: 'seed-1', bucket: 'platform' }))).toBe('players');
    expect(roadmapGroup(card({ folder: 'platform', bucket: 'game' }))).toBe('studio');
    expect(roadmapGroup(card({ folder: 'seed-1', board_work: true }))).toBe('board');
    expect(roadmapGroup(card({ folder: 'platform', board_work: true }))).toBe('board');
    expect(roadmapGroup(card({ folder: 'platform', board_work: false }))).toBe('studio');
  });

  it('lists each horizon as For players, The studio and a closed board-work disclosure, in rank order as rail rows with the suit in the rail', async () => {
    const { container } = renderRoadmap(sourceOf(cards));
    const next = await screen.findByRole('region', { name: roadmap.horizons.next });
    expect(within(next).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      roadmap.groups.players.heading,
      roadmap.groups.studio.heading,
      roadmap.groups.board.heading,
    ]);
    const players = within(next).getByRole('region', { name: roadmap.groups.players.heading });
    expect(within(players).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Card drafting', 'Free picks']);
    const studio = within(next).getByRole('region', { name: roadmap.groups.studio.heading });
    expect(within(studio).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Board on its own site']);
    // Board work, whatever its folder, sits in a native disclosure that starts closed.
    const board = next.querySelector('details[data-group="board"]') as HTMLDetailsElement;
    expect(board.open).toBe(false);
    expect(board.querySelector('summary')!.textContent).toBe(roadmap.groups.board.heading);
    expect([...board.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['Voter identity', 'A bug button']);
    expect([...next.querySelectorAll('li .row-rail [data-suit]')].map((tag) => tag.textContent)).toEqual([
      copy.categories.game,
      copy.categories.game,
      copy.categories.studio,
      copy.categories.studio,
      copy.categories.game,
    ]);
    expect(within(next).getByText('Choose the next card without paying.')).toBeTruthy();
    // Later has only a card for players, so it draws no studio group and no disclosure.
    const later = screen.getByRole('region', { name: roadmap.horizons.later });
    expect(within(later).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([roadmap.groups.players.heading]);
    expect(within(later).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Seasons']);
    expect(later.querySelector('details')).toBeNull();
    expect(container.querySelectorAll('.roadmap-group')).toHaveLength(4);
  });

  it('draws board work open, under a line that says so, when it is all a horizon holds (production at launch)', async () => {
    // Every BACKLOG entry is board: yes, so each band once held only a closed summary and read as empty.
    const boardOnly = [
      card({ id: 'b1', title: 'Voter identity', folder: 'platform', bucket: 'platform', rank: 1, board_work: true }),
      card({ id: 'b2', title: 'A bug button', folder: 'seed-1', bucket: 'qa', rank: 2, board_work: true }),
      card({ id: 'b3', title: 'Seasons', horizon: 'later', board_work: true }),
    ];
    const { container } = renderRoadmap(sourceOf(boardOnly));
    for (const [name, titles] of [
      [roadmap.horizons.next, ['Voter identity', 'A bug button']],
      [roadmap.horizons.later, ['Seasons']],
    ] as const) {
      const horizon = await screen.findByRole('region', { name });
      expect(horizon.querySelector('details')).toBeNull();
      expect(within(horizon).getByText(roadmap.boardOnly)).toBeTruthy();
      const board = within(horizon).getByRole('region', { name: roadmap.groups.board.heading });
      expect(board.getAttribute('data-group')).toBe('board');
      expect(within(board).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(titles);
      expect(within(horizon).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([roadmap.groups.board.heading]);
    }
    // Still said once per band, and only of board work.
    expect((container.querySelector('main')!.textContent!.match(/not funded by cards/g) ?? []).length).toBe(2);
  });

  it('says no card for players or the studio only when board work is all a horizon holds', async () => {
    renderRoadmap(sourceOf(cards));
    const next = await screen.findByRole('region', { name: roadmap.horizons.next });
    expect(within(next).queryByText(roadmap.boardOnly)).toBeNull();
    const later = screen.getByRole('region', { name: roadmap.horizons.later });
    expect(within(later).queryByText(roadmap.boardOnly)).toBeNull();
    expect(roadmap.boardOnly).not.toMatch(/planned|fund/i);
  });

  it('says planned once per group and not funded by cards only of board work', async () => {
    const { container } = renderRoadmap(sourceOf(cards));
    await screen.findByRole('region', { name: roadmap.horizons.next });
    for (const group of container.querySelectorAll('.roadmap-group')) {
      expect(group.textContent!.match(/planned/gi) ?? []).toHaveLength(1);
      const isBoard = group.getAttribute('data-group') === 'board';
      expect(/not funded by cards/.test(group.textContent!)).toBe(isBoard);
    }
    // The row labels are gone; the page says planned only in the group lines.
    expect(screen.queryByText(roadmap.planned)).toBeNull();
    const main = container.querySelector('main')!;
    expect((main.textContent!.match(/not funded by cards/g) ?? []).length).toBe(1);
    for (const band of container.querySelectorAll('main > .band:not(:first-child)')) {
      const outsideGroups = [...band.querySelectorAll('.section > p')].map((p) => p.textContent).join(' ');
      expect(outsideGroups).not.toMatch(/planned/i);
    }
  });

  it("keeps supporter-pages' opens-soon and held labels on the cards they apply to", async () => {
    const soon = card({ id: 's1', title: 'Soon', source: 'agent', opens_at: '2026-09-27T00:00:00Z', rank: 6 });
    const held = card({ id: 'h1', title: 'Held', rank: 7, board_vetoed: true, board_veto_reason: 'Not now.' });
    renderRoadmap(sourceOf([...cards, soon, held]));
    const next = await screen.findByRole('region', { name: roadmap.horizons.next });
    const row = (id: string) => next.querySelector(`li[data-card="${id}"]`)!;
    expect(row('s1').textContent).toContain(roadmap.opensSoon);
    expect(row('h1').textContent).toContain(legal.heldByBoard);
    expect(row('h1').textContent).toContain('Not now.');
    expect(row('n1').textContent).not.toContain(roadmap.opensSoon);
    expect(row('n1').textContent).not.toContain(legal.heldByBoard);
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
