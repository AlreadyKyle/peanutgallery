import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { formatDate } from '../lib/format';
import type { Card, Snapshot } from '../lib/source';
import { BuildingNow, CardFace, FundBoard, PHONE_CARDS, PlannedNext, QueuedList, ShippedList, ShippedRow } from './Cards';

const STRIPE = 'https://buy.stripe.com/test-link';

function card(overrides: Partial<Card> = {}): Card {
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
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: 10,
    funded_usd: 0,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

function snapshot(cards: Card[], funding: Snapshot['funding'] = {}): Snapshot {
  return {
    pool: null,
    cards,
    funding,
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

/** A paragraph whose whole text, across its inline elements, is exactly this. */
function paragraph(text: string): HTMLElement {
  return screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
}

function boxFor(title: string): HTMLElement {
  return screen.getByRole('heading', { level: 3, name: title }).closest('li')!;
}

/** A spec row's label and value, or null when the row is not drawn. */
function specRow(box: HTMLElement, row: 'funded' | 'contributors'): [string, string] | null {
  const div = box.querySelector(`.spec-rows [data-row="${row}"]`);
  if (div === null) return null;
  return [div.querySelector('dt')?.textContent ?? '', div.querySelector('dd')?.textContent ?? ''];
}

function stateOf(box: HTMLElement): string | null {
  return box.querySelector('.card-index [data-state]')?.getAttribute('data-state') ?? null;
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
  vi.stubEnv('VITE_PLAY_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('FundBoard states', () => {
  it('shows the empty line when nothing needs funding', () => {
    render(<FundBoard snapshot={snapshot([card({ stage: 'building' }), card({ id: 'q', stage: 'funded' })])} />);
    expect(screen.getByText(copy.fundEmpty)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('a card box', () => {
  it('shows the suit, the state, title, summary, bar, spec rows, a fund button and a closed brief', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const intent = 'Edit seed-1/config/unlocks.json. Run the bot; stop and report.';
    render(
      <FundBoard
        snapshot={snapshot(
          [
            card({
              id: 'n1',
              title: 'A fourteenth unlock',
              summary: 'Add one more unlock.',
              intent,
              stage: 'voted',
              funding_target_usd: 100,
              funded_usd: 25,
              source: 'community',
            }),
          ],
          { n1: { contributors: 3, credited_usd: 18.5 } },
        )}
      />,
    );
    const box = boxFor('A fourteenth unlock');
    expect(within(box).getByText(copy.categories.game)).toBeTruthy();
    expect(within(box).getByText(copy.statusPicked)).toBeTruthy();
    expect(stateOf(box)).toBe('picked');
    expect(box.getAttribute('data-face')).toBe('picked');
    expect(within(box).getByText('Add one more unlock.').classList.contains('card-summary')).toBe(true);

    const bar = within(box).getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('A fourteenth unlock');
    expect([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-valuenow')]).toEqual(['0', '100', '25']);
    expect(specRow(box, 'funded')).toEqual([legal.fundedLabel, '$25.00 of $100.00']);
    expect(specRow(box, 'contributors')).toEqual([legal.contributorsLabel, '3']);

    const link = within(box).getByRole('link', { name: legal.fundThis });
    expect(link.getAttribute('href')).toBe(`${STRIPE}?client_reference_id=n1`);
    expect(link.classList.contains('button')).toBe(true);
    expect(link.getAttribute('aria-describedby')).toBe(screen.getByRole('heading', { level: 3 }).id);

    const details = box.querySelector('details.brief') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe(copy.agentBrief);
    expect(link.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(details.querySelector('summary')!);
    expect(details.open).toBe(true);
    expect(within(details).getByText(intent)).toBeTruthy();
  });

  it('shows an open card with its state word and a single contributor', () => {
    render(<FundBoard snapshot={snapshot([card({ id: 'n2', title: 'Open one', funding_target_usd: 50 })], { n2: { contributors: 1, credited_usd: 5 } })} />);
    const box = boxFor('Open one');
    expect(within(box).getByText(copy.statusOpen)).toBeTruthy();
    expect(stateOf(box)).toBe('open');
    expect(specRow(box, 'funded')).toEqual([legal.fundedLabel, '$0.00 of $50.00']);
    expect(specRow(box, 'contributors')).toEqual([legal.contributorsLabel, '1']);
  });

  it('shows 0 contributors on a goal with no funding row, and no summary or brief when blank', () => {
    render(<FundBoard snapshot={snapshot([card({ id: 'new', title: 'New', summary: '  ', intent: null, funding_target_usd: 20 })])} />);
    expect(specRow(boxFor('New'), 'contributors')).toEqual([legal.contributorsLabel, '0']);
    expect(document.querySelectorAll('p.card-summary')).toHaveLength(0);
    expect(boxFor('New').querySelector('details.brief')).toBeNull();
  });

  it('leaves the contributor count out of the caption when the funding figures did not load', () => {
    render(<FundBoard snapshot={{ ...snapshot([card({ id: 'n2', funding_target_usd: 50, funded_usd: 5 })]), missing: ['funding'] }} />);
    const box = document.querySelector('li.card') as HTMLElement;
    expect(specRow(box, 'funded')).toEqual([legal.fundedLabel, '$5.00 of $50.00']);
    expect(specRow(box, 'contributors')).toBeNull();
  });

  it('omits the fund button for a full bar, a non-goal card and a missing payment link, and the bar at a zero target', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    render(
      <FundBoard
        snapshot={snapshot([
          card({ id: 'full', title: 'Full', stage: 'voted', funding_target_usd: 100, funded_usd: 100 }),
          card({ id: 'one', title: 'Oneoff', shape: 'oneoff', funding_target_usd: 100, funded_usd: 10 }),
          card({ id: 'zero', title: 'Zero', funding_target_usd: 0 }),
        ])}
      />,
    );
    expect(screen.queryByRole('link', { name: legal.fundThis })).toBeNull();
    expect(within(boxFor('Zero')).queryByRole('progressbar')).toBeNull();
    cleanup();
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
    render(<FundBoard snapshot={snapshot([card({ id: 'n3', funding_target_usd: 100, funded_usd: 10 })])} />);
    expect(screen.queryByRole('link', { name: legal.fundThis })).toBeNull();
  });
});

describe('the fund grid on a phone', () => {
  it('offers Show all n cards past the third, and moves focus to the fourth title when pressed', () => {
    const cards = Array.from({ length: 5 }, (_, i) => card({ id: `g${i}`, title: `Card ${i + 1}`, funding_target_usd: 10 }));
    render(<FundBoard snapshot={snapshot(cards)} />);
    const grid = document.querySelector('ul.fund-grid')!;
    expect(grid.hasAttribute('data-all')).toBe(false);
    const titles = screen.getAllByRole('heading', { level: 3 });
    expect(titles.map((h) => h.getAttribute('tabindex'))).toEqual([null, null, null, '-1', null]);
    fireEvent.click(screen.getByRole('button', { name: copy.showAllCards.replace('{n}', '5') }));
    expect(grid.getAttribute('data-all')).toBe('true');
    expect(document.activeElement).toBe(titles[PHONE_CARDS]);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('offers no Show all with three cards or fewer', () => {
    render(<FundBoard snapshot={snapshot([card({ id: 'a' }), card({ id: 'b' }), card({ id: 'c3' })])} />);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
});

describe('BuildingNow and QueuedList', () => {
  it('shows building cards with what they have spent, and nothing when none are building', () => {
    const building = [
      card({ id: 'a', title: 'Building one', stage: 'building', spent_usd: 0.42 }),
      card({ id: 'b', title: 'Gated one', stage: 'gated', source: 'agent' }),
    ];
    render(<BuildingNow cards={building} snapshot={snapshot(building)} />);
    expect(paragraph(`${copy.sources.board} · $0.42 ${legal.spentSoFar}`)).toBeTruthy();
    expect(within(boxFor('Gated one')).getByText(copy.statusGated)).toBeTruthy();
    // No studio-billed spend yet (or founder-billed work, which is never published): no cost shown.
    expect(within(boxFor('Gated one')).getByText(copy.sources.agent).textContent).toBe(copy.sources.agent);
    expect(within(boxFor('Gated one')).queryByText(new RegExp(legal.spentSoFar))).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    cleanup();
    const { container } = render(<BuildingNow cards={[]} snapshot={snapshot([card()])} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists funded cards as rail rows with the suit in the rail, and says when none are queued', () => {
    render(<QueuedList cards={[card({ id: 'q', title: 'Queued one', stage: 'funded', folder: 'platform' })]} />);
    const row = screen.getByText('Queued one').closest('li')!;
    expect(row.querySelector('.row-time')?.textContent).toBe(copy.categories.studio);
    expect(row.textContent).toBe(`${copy.categories.studio}Queued one`);
    cleanup();
    render(<QueuedList cards={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: copy.queued })).toBeTruthy();
    expect(screen.getByText(copy.queuedEmpty)).toBeTruthy();
  });
});

describe('ShippedList', () => {
  const shipped = [
    card({
      id: 'newer',
      title: 'A clearer ledger page',
      stage: 'live',
      shape: 'oneoff',
      folder: 'platform',
      bucket: 'platform',
      funding_target_usd: 0,
      spent_usd: 0.5,
      updated_at: '2026-09-16T18:30:00Z',
      live_at: null,
    }),
    card({
      id: 'older',
      title: 'Save and resume',
      stage: 'live',
      shape: 'goal',
      funding_target_usd: 3,
      funded_usd: 3,
      spent_usd: 1.234,
      updated_at: '2026-09-15T09:00:00Z',
      live_at: '2026-09-15T09:00:00Z',
    }),
  ];

  it('draws rail rows: the ship date in the rail, the Live tag and title, then cost and who funded it', () => {
    vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
    render(<MemoryRouter><ShippedList cards={shipped} snapshot={snapshot(shipped, { older: { contributors: 3, credited_usd: 3 } })} /></MemoryRouter>);
    const section = screen.getByRole('region', { name: copy.shipped });
    const rows = within(section).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.row-time')?.textContent)).toEqual([formatDate('2026-09-16T18:30:00Z'), formatDate('2026-09-15T09:00:00Z')]);
    expect(rows.map((row) => within(row).getByRole('heading', { level: 3 }).textContent)).toEqual([
      `${copy.statusLive} A clearer ledger page`,
      `${copy.statusLive} Save and resume`,
    ]);
    // A card nobody funded names who asked for it instead of a contributor count.
    expect(within(rows[0]!).getByText(`$0.50 ${legal.spent} · ${copy.sources.board}`)).toBeTruthy();
    expect(within(rows[1]!).getByText(`$1.23 ${legal.spent} · ${legal.contributorsMany.replace('{n}', '3')}`)).toBeTruthy();
    expect(within(section).queryByRole('progressbar')).toBeNull();
    expect(within(section).queryByRole('link', { name: copy.playTheGame })).toBeNull();
    expect(within(section).getByRole('link', { name: copy.roadmapLink }).getAttribute('href')).toBe('/roadmap');
  });

  it('shows no cost for founder-billed work, no count when the funding figures did not load, and nothing without a shipped card', () => {
    const founder = card({ id: 'f', title: 'Founder built', stage: 'live', shape: 'oneoff', spent_usd: 0 });
    render(<MemoryRouter><ShippedList cards={[founder]} snapshot={snapshot([founder])} /></MemoryRouter>);
    expect(screen.getByText(copy.sources.board)).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
    cleanup();
    render(<MemoryRouter><ShippedList cards={shipped} snapshot={{ ...snapshot(shipped), missing: ['funding'] }} /></MemoryRouter>);
    expect(screen.getByText(`$1.23 ${legal.spent}`)).toBeTruthy();
    expect(screen.queryByText(/contributor/)).toBeNull();
    cleanup();
    const { container } = render(<MemoryRouter><ShippedList cards={[]} snapshot={snapshot([])} /></MemoryRouter>);
    expect(container.innerHTML).toBe('');
  });
});

describe('PlannedNext', () => {
  it('lists planned titles as rows with the suit in the rail, and nothing when none are planned', () => {
    render(<MemoryRouter><PlannedNext cards={[card({ id: 'p', title: 'A planned change', folder: 'platform', horizon: 'next' })]} /></MemoryRouter>);
    const section = screen.getByRole('region', { name: copy.plannedNext });
    const row = within(section).getByRole('listitem');
    expect(row.querySelector('.row-time')?.textContent).toBe(copy.categories.studio);
    expect(within(row).getByRole('heading', { level: 3 }).textContent).toBe('A planned change');
    expect(within(section).queryByRole('progressbar')).toBeNull();
    cleanup();
    const { container } = render(<MemoryRouter><PlannedNext cards={[]} /></MemoryRouter>);
    expect(container.innerHTML).toBe('');
  });
});

describe('example mode', () => {
  it('renders a fundable card with no link, button or disclosure even with a Payment Link set', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const open = card({ id: 'e1', title: 'Fundable', intent: 'Do the thing.', funding_target_usd: 10, funded_usd: 2 });
    const { container } = render(
      <ul>
        <CardFace card={open} snapshot={snapshot([open])} mode="example" />
      </ul>,
    );
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.innerHTML).not.toContain('client_reference_id');
    expect(container.innerHTML).not.toContain(STRIPE);
  });

  it('renders a shipped row with no link', () => {
    vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
    const live = card({ id: 'l1', title: 'Shipped one', stage: 'live' });
    render(
      <ul>
        <ShippedRow card={live} snapshot={snapshot([live])} example />
      </ul>,
    );
    expect(screen.getByRole('heading', { level: 3, name: `${copy.statusLive} Shipped one` })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

