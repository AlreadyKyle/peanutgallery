import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { formatDate } from '../lib/format';
import { books } from '../lib/books.test-fixture';
import { canFund } from '../lib/payment';
import { fundingPlace, groupCards } from '../lib/cards';
import type { Card, Snapshot } from '../lib/source';
import { CardFace, PlannedRow, plannedState, ShippedRow } from './Cards';
import { MachineFlow } from './Flow';

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

/** The cards a goal bar still has room on stand in for the waterfall's order, unless a test names the order. */
function snapshot(cards: Card[], funding: Snapshot['funding'] = {}, order: string[] = cards.filter(canFund).map((c) => c.id)): Snapshot {
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
    money: books(order),
    missing: [],
  };
}

/** A paragraph whose whole text, across its inline elements, is exactly this. */
function paragraph(text: string): HTMLElement {
  return screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
}

/** A card's face, by its title: an h3 on a full face, an h4 on home's compact one. */
function boxFor(title: string, level: 3 | 4 = 3): HTMLElement {
  return screen.getByRole('heading', { level, name: title }).closest('li')!;
}

/** Full faces, as a card's own page and the guide draw them. */
function faces(cards: Card[], snap: Snapshot) {
  return render(
    <MemoryRouter>
      <ul>
        {cards.map((c) => (
          <CardFace key={c.id} card={c} snapshot={snap} />
        ))}
      </ul>
    </MemoryRouter>,
  );
}

/** Home's flow, from a snapshot grouped the way lib/live.ts groups it. */
function flow(snap: Snapshot) {
  return render(
    <MemoryRouter>
      <MachineFlow snapshot={snap} groups={groupCards(snap.cards, fundingPlace(snap))} />
    </MemoryRouter>,
  );
}

function lane(name: 'next' | 'fund' | 'building' | 'shipped'): HTMLElement {
  return document.querySelector(`li.flow-lane[data-lane="${name}"]`) as HTMLElement;
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

describe('a card box', () => {
  it('shows the suit, the state, title, summary, bar, spec rows and a fund button, and no brief', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const intent = 'Edit seed-1/config/unlocks.json. Run the bot; stop and report.';
    const picked = card({
      id: 'n1',
      title: 'A fourteenth unlock',
      summary: 'Add one more unlock.',
      intent,
      stage: 'voted',
      funding_target_usd: 100,
      funded_usd: 25,
      source: 'community',
    });
    faces([picked], snapshot([picked], { n1: { contributors: 3, credited_usd: 18.5 } }));
    const box = boxFor('A fourteenth unlock');
    expect(within(box).getByText(copy.categories.game)).toBeTruthy();
    expect(within(box).getByText(copy.statusPicked)).toBeTruthy();
    expect(stateOf(box)).toBe('picked');
    expect(box.getAttribute('data-face')).toBe('picked');
    expect(box.hasAttribute('data-compact')).toBe(false);
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

    // The brief is on the card's own page only, and the face itself carries no agreement.
    expect(box.querySelector('details')).toBeNull();
    expect(box.textContent).not.toContain(intent);
    expect(box.textContent).not.toContain(copy.agentBrief);
    expect(box.querySelector('p.fund-agreement')).toBeNull();
  });

  it("keeps the money on home's compact face: an h4 title and no summary, the same bar, spec rows and fund button, and one agreement under the lane", () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const picked = card({ id: 'n1', title: 'A fourteenth unlock', summary: 'Add one more unlock.', stage: 'voted', funding_target_usd: 100, funded_usd: 25 });
    const other = card({ id: 'n2', title: 'Another unlock', funding_target_usd: 10 });
    flow(snapshot([picked, other], { n1: { contributors: 3, credited_usd: 18.5 } }));
    const box = boxFor('A fourteenth unlock', 4);
    expect(box.getAttribute('data-compact')).toBe('true');
    expect(box.getAttribute('data-face')).toBe('picked');
    expect(box.querySelector('p.card-summary')).toBeNull();
    expect(within(box).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    expect(specRow(box, 'funded')).toEqual([legal.fundedLabel, '$25.00 of $100.00']);
    expect(specRow(box, 'contributors')).toEqual([legal.contributorsLabel, '3']);
    const link = within(box).getByRole('link', { name: legal.fundThis });
    expect(link.getAttribute('href')).toBe(`${STRIPE}?client_reference_id=n1`);
    expect(link.getAttribute('aria-describedby')).toBe(within(box).getByRole('heading', { level: 4 }).id);
    const agreement = document.querySelectorAll('p.fund-agreement');
    expect(agreement).toHaveLength(1);
    expect(lane('fund').contains(agreement[0]!)).toBe(true);
    for (const face of lane('fund').querySelectorAll('li.card')) expect(face.contains(agreement[0]!)).toBe(false);
  });

  it('shows an open card with its state word and a single contributor', () => {
    const open = card({ id: 'n2', title: 'Open one', funding_target_usd: 50 });
    faces([open], snapshot([open], { n2: { contributors: 1, credited_usd: 5 } }));
    const box = boxFor('Open one');
    expect(within(box).getByText(copy.statusOpen)).toBeTruthy();
    expect(stateOf(box)).toBe('open');
    expect(specRow(box, 'funded')).toEqual([legal.fundedLabel, '$0.00 of $50.00']);
    expect(specRow(box, 'contributors')).toEqual([legal.contributorsLabel, '1']);
  });

  it('shows 0 contributors on a goal with no funding row, and no summary when blank', () => {
    const fresh = card({ id: 'new', title: 'New', summary: '  ', intent: null, funding_target_usd: 20 });
    faces([fresh], snapshot([fresh]));
    expect(specRow(boxFor('New'), 'contributors')).toEqual([legal.contributorsLabel, '0']);
    expect(document.querySelectorAll('p.card-summary')).toHaveLength(0);
  });

  it('leaves the contributor count out when the funding figures did not load', () => {
    const open = card({ id: 'n2', funding_target_usd: 50, funded_usd: 5 });
    faces([open], { ...snapshot([open]), missing: ['funding'] });
    const box = document.querySelector('li.card') as HTMLElement;
    expect(specRow(box, 'funded')).toEqual([legal.fundedLabel, '$5.00 of $50.00']);
    expect(specRow(box, 'contributors')).toBeNull();
  });

  it("draws in the Fund now lane only the cards in the waterfall's order, each with its live Fund this card, and every open card with none when public_money did not load", () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const cards = [
      card({ id: 'in', title: 'In the order', funding_target_usd: 10, funded_usd: 1 }),
      card({ id: 'out', title: 'Vetoed, so not in the order', funding_target_usd: 10, funded_usd: 1 }),
    ];
    flow(snapshot(cards, {}, ['in']));
    expect(within(boxFor('In the order', 4)).getByRole('link', { name: legal.fundThis }).getAttribute('href')).toBe(`${STRIPE}?client_reference_id=in`);
    // A card the order leaves out is not open for funding: it is not drawn among cards that carry
    // Fund this card, where its missing button would misalign the row's bars.
    expect(screen.queryByRole('heading', { name: 'Vetoed, so not in the order' })).toBeNull();
    cleanup();
    // Drawn anyway (a frozen layout from an older snapshot), it still draws no button.
    faces(cards, snapshot(cards, {}, ['in']));
    expect(within(boxFor('Vetoed, so not in the order')).queryByRole('link', { name: legal.fundThis })).toBeNull();
    cleanup();
    flow({ ...snapshot(cards, {}, ['in', 'out']), money: null, missing: ['money'] });
    expect(within(lane('fund')).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['In the order', 'Vetoed, so not in the order']);
    expect(screen.queryByRole('link', { name: legal.fundThis })).toBeNull();
    // No card carries a live link, so no agreement is said.
    expect(document.querySelector('p.fund-agreement')).toBeNull();
  });

  it('omits the fund button for a full bar, a non-goal card and a missing payment link, and the bar at a zero target', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const kinds = [
      card({ id: 'full', title: 'Full', stage: 'voted', funding_target_usd: 100, funded_usd: 100 }),
      card({ id: 'one', title: 'Oneoff', shape: 'oneoff', funding_target_usd: 100, funded_usd: 10 }),
      card({ id: 'zero', title: 'Zero', funding_target_usd: 0 }),
    ];
    // None of them is in the order; draw each face directly.
    faces(kinds, snapshot(kinds));
    expect(screen.queryByRole('link', { name: legal.fundThis })).toBeNull();
    expect(within(boxFor('Zero')).queryByRole('progressbar')).toBeNull();
    cleanup();
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
    const open = card({ id: 'n3', funding_target_usd: 100, funded_usd: 10 });
    flow(snapshot([open]));
    expect(screen.queryByRole('link', { name: legal.fundThis })).toBeNull();
    expect(document.querySelector('p.fund-agreement')).toBeNull();
  });
});

describe('the building and checks faces', () => {
  it('show what a card has spent and link its own page, with no bar', () => {
    const building = [
      card({ id: 'a', title: 'Building one', stage: 'building', spent_usd: 0.42 }),
      card({ id: 'b', title: 'Gated one', stage: 'gated', source: 'agent' }),
    ];
    faces(building, snapshot(building));
    expect(paragraph(`${copy.sources.board} · $0.42 ${legal.spentSoFar}`)).toBeTruthy();
    expect(within(boxFor('Building one')).getByRole('link', { name: copy.cardPage.watchBuilt }).getAttribute('href')).toBe('/card/a');
    expect(within(boxFor('Gated one')).getByRole('link', { name: copy.cardPage.watchBuilt }).getAttribute('href')).toBe('/card/b');
    expect(within(boxFor('Gated one')).getByText(copy.statusGated)).toBeTruthy();
    // No studio-billed spend yet (or founder-billed work, which is never published): no cost shown.
    expect(within(boxFor('Gated one')).getByText(copy.sources.agent).textContent).toBe(copy.sources.agent);
    expect(within(boxFor('Gated one')).queryByText(new RegExp(legal.spentSoFar))).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keep the Watch link on the compact face, and a funded face waits for the agents with no link', () => {
    const cards = [
      card({ id: 'a', title: 'Building one', stage: 'building', spent_usd: 0.42 }),
      card({ id: 'q', title: 'Queued one', stage: 'funded', funding_target_usd: 10, funded_usd: 10 }),
    ];
    flow(snapshot(cards));
    expect(within(boxFor('Building one', 4)).getByRole('link', { name: copy.cardPage.watchBuilt }).getAttribute('href')).toBe('/card/a');
    const queued = boxFor('Queued one', 4);
    expect(queued.getAttribute('data-face')).toBe('funded');
    expect(within(queued).getByText(copy.waitingForAgents)).toBeTruthy();
    expect(within(queued).queryByRole('link')).toBeNull();
  });
});

describe('ShippedRow', () => {
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

  function rows(snap: Snapshot, cards = shipped) {
    return render(
      <MemoryRouter>
        <ul>
          {cards.map((c) => (
            <ShippedRow key={c.id} card={c} snapshot={snap} />
          ))}
        </ul>
      </MemoryRouter>,
    );
  }

  it('draws the ship date in the rail, the title, then the suit, the Live tag, cost, who funded it and the Watch link', () => {
    rows(snapshot(shipped, { older: { contributors: 3, credited_usd: 3 } }));
    const items = screen.getAllByRole('listitem');
    expect(items.map((row) => row.querySelector('.row-time')?.textContent)).toEqual([formatDate('2026-09-16T18:30:00Z'), formatDate('2026-09-15T09:00:00Z')]);
    expect(items.map((row) => within(row).getByRole('heading', { level: 3 }).textContent)).toEqual(['A clearer ledger page', 'Save and resume']);
    expect(items.map((row) => [row.querySelector('.row-meta [data-suit]')?.getAttribute('data-suit'), row.querySelector('.row-meta [data-state]')?.textContent])).toEqual([
      ['studio', copy.statusLive],
      ['game', copy.statusLive],
    ]);
    // A card nobody funded names who asked for it instead of a contributor count.
    expect(within(items[0]!).getByText(`$0.50 ${legal.spent} · ${copy.sources.board}`)).toBeTruthy();
    expect(within(items[1]!).getByText(`$1.23 ${legal.spent} · ${legal.contributorsMany.replace('{n}', '3')}`)).toBeTruthy();
    expect(within(items[1]!).getByRole('link', { name: copy.cardPage.watchWasBuilt }).getAttribute('href')).toBe('/card/older');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows no cost for founder-billed work, and no count when the funding figures did not load', () => {
    const founder = card({ id: 'f', title: 'Founder built', stage: 'live', shape: 'oneoff', spent_usd: 0 });
    rows(snapshot([founder]), [founder]);
    expect(screen.getByText(copy.sources.board)).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
    cleanup();
    rows({ ...snapshot(shipped), missing: ['funding'] });
    expect(screen.getByText(`$1.23 ${legal.spent}`)).toBeTruthy();
    expect(screen.queryByText(/contributor/)).toBeNull();
  });
});

describe('PlannedRow and plannedState', () => {
  it('draws a planned title as a row with the suit in the rail and no bar or link', () => {
    render(
      <ul>
        <PlannedRow card={card({ id: 'p', title: 'A planned change', folder: 'platform', horizon: 'next' })} />
      </ul>,
    );
    const row = screen.getByRole('listitem');
    expect(row.querySelector('.row-rail [data-suit]')?.textContent).toBe(copy.categories.studio);
    expect(within(row).getByRole('heading', { level: 3 }).textContent).toBe('A planned change');
    expect(within(row).queryByRole('progressbar')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('says held with the reason, approved and opening soon, or planned', () => {
    expect(plannedState(card({ horizon: 'next', board_vetoed: true, board_veto_reason: 'Out of scope.' }))).toEqual({ label: legal.heldByBoard, reason: 'Out of scope.' });
    expect(plannedState(card({ horizon: 'next', board_vetoed: true, board_veto_reason: ' ' }))).toEqual({ label: legal.heldByBoard, reason: null });
    expect(plannedState(card({ horizon: 'later', opens_at: '2026-10-11T00:00:00Z' }))).toEqual({ label: copy.roadmap.opensSoon, reason: null });
    expect(plannedState(card({ horizon: 'next' }))).toEqual({ label: copy.roadmap.planned, reason: null });
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
    expect(screen.getByRole('heading', { level: 3, name: 'Shipped one' })).toBeTruthy();
    expect(screen.getByText(copy.statusLive).closest('[data-state]')?.getAttribute('data-state')).toBe('live');
    expect(screen.queryByRole('link')).toBeNull();
  });
});

