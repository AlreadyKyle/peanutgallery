import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { books } from '../lib/books.test-fixture';
import { fundingPlace, groupCards, shippedAt } from '../lib/cards';
import { copy } from '../lib/copy';
import { formatDate } from '../lib/format';
import { legal } from '../lib/legal';
import { canFund } from '../lib/payment';
import type { Card, Snapshot, Supply } from '../lib/source';
import { plannedLine } from './Card';
import { draftingLine, MachineFlow } from './Flow';

const STRIPE = 'https://buy.stripe.com/test-link';

type Lane = 'next' | 'fund' | 'building' | 'shipped';

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c',
    title: 'A card',
    summary: 'A summary the compact face leaves out.',
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

/** The cards a goal bar still has room on stand in for the waterfall's order. */
function snapshot(cards: Card[], over: Partial<Snapshot> = {}): Snapshot {
  return {
    pool: null,
    cards,
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    money: books(cards.filter(canFund).map((c) => c.id)),
    missing: [],
    ...over,
  };
}

function supply(over: Partial<Supply> = {}): Supply {
  return { drafting: false, short: false, reason: null, runs_today: 0, run_limit: 3, next_check_at: null, ...over };
}

function renderFlow(snap: Snapshot) {
  return render(
    <MemoryRouter>
      <MachineFlow snapshot={snap} groups={groupCards(snap.cards, fundingPlace(snap))} />
    </MemoryRouter>,
  );
}

function lane(name: Lane): HTMLElement {
  return document.querySelector(`li.flow-lane[data-lane="${name}"]`) as HTMLElement;
}

function titles(name: Lane): string[] {
  return within(lane(name))
    .queryAllByRole('heading', { level: 4 })
    .map((h) => h.textContent ?? '');
}

function more(name: Lane): HTMLAnchorElement | null {
  return lane(name).querySelector('p.more a');
}

const open = (n: number) => Array.from({ length: n }, (_, i) => card({ id: `o${i}`, title: `Open ${i + 1}`, created_at: `2026-09-14T00:00:0${i}Z` }));
const planned = (n: number) => Array.from({ length: n }, (_, i) => card({ id: `p${i}`, title: `Planned ${i + 1}`, horizon: 'next', rank: i + 1 }));
const live = (n: number) =>
  Array.from({ length: n }, (_, i) => card({ id: `l${i}`, title: `Live ${i + 1}`, stage: 'live', shape: 'oneoff', funding_target_usd: 0, live_at: `2026-09-${10 + i}T00:00:00Z` }));

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
  vi.stubEnv('VITE_PLAY_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('MachineFlow', () => {
  it('draws four lanes in the order a card moves, each headed by its name and count and saying who acts in it', () => {
    renderFlow(snapshot([...planned(1), ...open(2), card({ id: 'b', title: 'Building', stage: 'building' })]));
    const lanes = [...document.querySelectorAll('ol.flow-lanes > li.flow-lane')];
    expect(lanes.map((li) => li.getAttribute('data-lane'))).toEqual(['next', 'fund', 'building', 'shipped']);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      `${copy.flow.lanes.next.title} ${copy.flow.countOne}`,
      `${copy.flow.lanes.fund.title} ${copy.flow.count.replace('{n}', '2')}`,
      `${copy.flow.lanes.building.title} ${copy.flow.countOne}`,
      `${copy.flow.lanes.shipped.title} ${copy.flow.count.replace('{n}', '0')}`,
    ]);
    // Each lane is named by its heading.
    for (const li of lanes) expect(li.getAttribute('aria-labelledby')).toBe(li.querySelector('h3.flow-title')?.id);
    expect(lanes.map((li) => li.querySelector('.flow-step-number')?.textContent)).toEqual(['1', '2', '3', '4']);
    expect(lane('fund').querySelector('.flow-who')?.textContent).toBe(copy.flow.lanes.fund.who);
    expect(lane('building').querySelector('.flow-who')?.textContent).toBe(copy.flow.lanes.building.who);
    expect(lane('shipped').querySelector('.flow-who')?.textContent).toBe(copy.flow.lanes.shipped.who);
    // Every card is a compact face with an h4 title and no summary.
    const faces = [...document.querySelectorAll('li.card')];
    expect(faces).toHaveLength(4);
    for (const face of faces) expect(face.getAttribute('data-compact')).toBe('true');
    expect(document.querySelector('p.card-summary')).toBeNull();
  });

  it('shows at most three cards a lane, with the count in the heading still the whole lane', () => {
    renderFlow(snapshot([...planned(5), ...open(5), ...live(5), ...Array.from({ length: 4 }, (_, i) => card({ id: `b${i}`, title: `Building ${i + 1}`, stage: 'building' }))]));
    expect(titles('next')).toEqual(['Planned 1', 'Planned 2', 'Planned 3']);
    expect(titles('fund')).toEqual(['Open 1', 'Open 2', 'Open 3']);
    expect(titles('building')).toEqual(['Building 1', 'Building 2', 'Building 3']);
    expect(titles('shipped')).toEqual(['Live 5', 'Live 4', 'Live 3']);
    for (const name of ['next', 'fund', 'shipped'] as const) {
      expect(lane(name).querySelector('.flow-count')?.textContent).toBe(copy.flow.count.replace('{n}', '5'));
    }
    expect(lane('building').querySelector('.flow-count')?.textContent).toBe(copy.flow.count.replace('{n}', '4'));
  });

  it('links Next up and Shipped to the roadmap, Fund now to /contribute only past three cards, and Building nowhere', () => {
    renderFlow(snapshot([...planned(1), ...open(4), ...live(1)]));
    expect([more('next')?.textContent, more('next')?.getAttribute('href')]).toEqual([copy.flow.lanes.next.more, '/roadmap']);
    expect([more('shipped')?.textContent, more('shipped')?.getAttribute('href')]).toEqual([copy.flow.lanes.shipped.more, '/roadmap']);
    expect([more('fund')?.textContent, more('fund')?.getAttribute('href')]).toEqual([copy.flow.lanes.fund.more.replace('{n}', '4'), '/contribute']);
    expect(more('building')).toBeNull();
    cleanup();
    renderFlow(snapshot(open(3)));
    expect(more('fund')).toBeNull();
    expect(titles('fund')).toHaveLength(3);
  });

  describe('Fund now', () => {
    it("draws the waterfall's order as a fund grid with each card's Fund this card and one agreement under it", () => {
      vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
      const cards = open(3);
      // The order puts the third card first.
      renderFlow(snapshot(cards, { money: books(['o2', 'o0', 'o1']) }));
      const grid = lane('fund').querySelector('ul.fund-grid')!;
      expect(grid).not.toBeNull();
      expect(grid.classList.contains('flow-cards')).toBe(true);
      expect(titles('fund')).toEqual(['Open 3', 'Open 1', 'Open 2']);
      expect(within(lane('fund')).getAllByRole('link', { name: legal.fundThis }).map((a) => a.getAttribute('href'))).toEqual([
        `${STRIPE}?client_reference_id=o2`,
        `${STRIPE}?client_reference_id=o0`,
        `${STRIPE}?client_reference_id=o1`,
      ]);
      expect(lane('fund').querySelectorAll('p.fund-agreement')).toHaveLength(1);
      expect(grid.contains(lane('fund').querySelector('p.fund-agreement'))).toBe(false);
      // Only the Fund now lane is a fund grid.
      expect(document.querySelectorAll('ul.fund-grid')).toHaveLength(1);
    });

    it('says no agreement when no card carries a live link', () => {
      renderFlow(snapshot(open(2)));
      expect(lane('fund').querySelector('p.fund-agreement')).toBeNull();
      expect(within(lane('fund')).queryByRole('link', { name: legal.fundThis })).toBeNull();
    });

    it('stands in a tile for an empty lane: fund the next card in line, with Contribute only while the Payment Link is set', () => {
      vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
      renderFlow(snapshot([card({ id: 'b', stage: 'building' })]));
      const tile = lane('fund').querySelector('.flow-empty')!;
      expect(tile.querySelector('.flow-empty-title')?.textContent).toBe(legal.pickForMe);
      expect(within(tile as HTMLElement).getByText(legal.nextInLineNone)).toBeTruthy();
      expect(within(tile as HTMLElement).getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe('/contribute');
      expect(lane('fund').querySelector('ul')).toBeNull();
      expect(lane('fund').querySelector('p.fund-agreement')).toBeNull();
      expect(more('fund')).toBeNull();
      cleanup();
      vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
      renderFlow(snapshot([]));
      expect(lane('fund').querySelector('.flow-empty-title')?.textContent).toBe(legal.pickForMe);
      expect(within(lane('fund')).queryByRole('link')).toBeNull();
    });
  });

  describe('Building', () => {
    it('lists the cards being built or checked, then the funded cards waiting for the agents', () => {
      renderFlow(
        snapshot([
          card({ id: 'q', title: 'Queued', stage: 'funded', funding_target_usd: 10, funded_usd: 10 }),
          card({ id: 'g', title: 'Gated', stage: 'gated' }),
          card({ id: 'b', title: 'Built', stage: 'building' }),
        ]),
      );
      expect(titles('building')).toEqual(['Gated', 'Built', 'Queued']);
      expect([...lane('building').querySelectorAll('li.card')].map((li) => li.getAttribute('data-face'))).toEqual(['checks', 'building', 'funded']);
      expect(lane('building').querySelector('.flow-count')?.textContent).toBe(copy.flow.count.replace('{n}', '3'));
      expect(lane('building').querySelector('.flow-empty')).toBeNull();
      // A funded card is not open for funding.
      expect(titles('fund')).toEqual([]);
    });

    it('stands in a tile for an empty lane, naming the newest shipped card and the day it went live', () => {
      const shipped = live(2);
      renderFlow(snapshot(shipped));
      const tile = lane('building').querySelector('.flow-empty') as HTMLElement;
      expect(within(tile).getByText(copy.flow.lanes.building.empty)).toBeTruthy();
      const newest = shipped[1]!;
      expect(tile.querySelector('.card-meta')?.textContent).toBe(
        copy.flow.lanes.building.lastBuilt.replace('{title}', newest.title).replace('{date}', formatDate(shippedAt(newest))),
      );
      cleanup();
      renderFlow(snapshot([]));
      const bare = lane('building').querySelector('.flow-empty') as HTMLElement;
      expect(bare.textContent).toBe(copy.flow.lanes.building.empty);
    });
  });

  describe('Next up', () => {
    it('draws its cards on the planned face, approved agent cards first, then planned cards, then board work, never a held one', () => {
      renderFlow(
        snapshot([
          card({ id: 'board', title: 'Board work', horizon: 'next', rank: 1, board_work: true }),
          card({ id: 'held', title: 'Held', horizon: 'next', rank: 1, board_vetoed: true, board_veto_reason: 'No.' }),
          card({ id: 'plan', title: 'Planned', horizon: 'later' }),
          card({ id: 'soon', title: 'Opens soon', horizon: 'later', opens_at: '2026-10-11T00:00:00Z' }),
          card({ id: 'now', title: 'Open now', horizon: 'now' }),
        ]),
      );
      expect(titles('next')).toEqual(['Opens soon', 'Planned', 'Board work']);
      const faces = [...lane('next').querySelectorAll('li.card')] as HTMLElement[];
      expect(faces.map((li) => li.getAttribute('data-face'))).toEqual(['planned', 'planned', 'planned']);
      expect(faces.map((li) => li.querySelector('.card-bottom .card-meta')?.textContent)).toEqual([copy.roadmap.opensSoon, copy.flow.planned, copy.flow.boardWork]);
      expect(lane('next').querySelector('.flow-count')?.textContent).toBe(copy.flow.count.replace('{n}', '3'));
      // A planned card takes no money: no bar, no spec rows, no fund link.
      expect(within(lane('next')).queryByRole('progressbar')).toBeNull();
      expect(lane('next').querySelector('.spec-rows')).toBeNull();
      expect(screen.queryByText('Held')).toBeNull();
      // The now card is in Fund now, never Next up.
      expect(titles('fund')).toEqual(['Open now']);
    });

    it('stands in a tile for an empty lane and keeps the roadmap link', () => {
      renderFlow(snapshot(open(1)));
      expect(lane('next').querySelector('.flow-empty')?.textContent).toBe(copy.flow.lanes.next.empty);
      expect(more('next')?.getAttribute('href')).toBe('/roadmap');
    });

    it.each([
      ['drafting', supply({ drafting: true, reason: 'daily_limit' }), copy.flow.drafting, 'true'],
      ['done for today', supply({ reason: 'daily_limit', run_limit: 4, runs_today: 4 }), copy.flow.draftingDone.replace('{n}', '4'), null],
      ['at a zero limit', supply({ reason: 'daily_limit', run_limit: 0 }), copy.flow.draftingIdle, null],
      ['not short', supply({ reason: 'not_short' }), copy.flow.draftingIdle, null],
      ['idle', supply(), copy.flow.draftingIdle, null],
      ['without a supply row', null, copy.flow.draftingIdle, null],
    ] as const)("says the Game Designer's state when %s", (_, value, text, drafting) => {
      renderFlow(snapshot(planned(1), { supply: value }));
      const who = lane('next').querySelector('p.flow-who')!;
      expect(who.textContent).toBe(text);
      expect(who.classList.contains('flow-agent')).toBe(true);
      expect(who.getAttribute('data-drafting')).toBe(drafting);
      expect(who.querySelector('svg[data-glyph="pencil"]')).not.toBeNull();
    });
  });

  describe('Shipped', () => {
    it('shows the newest three live cards, each saying how it was built and linking its page', () => {
      renderFlow(snapshot(live(4)));
      expect(titles('shipped')).toEqual(['Live 4', 'Live 3', 'Live 2']);
      const faces = [...lane('shipped').querySelectorAll('li.card')] as HTMLElement[];
      expect(faces.map((li) => li.getAttribute('data-face'))).toEqual(['live', 'live', 'live']);
      expect(within(faces[0]!).getByRole('link', { name: copy.cardPage.watchWasBuilt }).getAttribute('href')).toBe('/card/l3');
      expect(within(lane('shipped')).queryByRole('link', { name: copy.playTheGame })).toBeNull();
    });

    it('stands in a tile for an empty lane', () => {
      renderFlow(snapshot(open(1)));
      expect(lane('shipped').querySelector('.flow-empty')?.textContent).toBe(copy.flow.lanes.shipped.empty);
    });
  });

  it('never leaves a lane blank: with no cards every lane holds its tile', () => {
    renderFlow(snapshot([]));
    for (const name of ['next', 'fund', 'building', 'shipped'] as const) {
      const tile = lane(name).querySelector('.flow-empty');
      expect(tile, name).not.toBeNull();
      expect(tile!.textContent!.trim(), name).not.toBe('');
      expect(lane(name).querySelector('li.card'), name).toBeNull();
    }
  });
});

describe('draftingLine', () => {
  it('reads the supply: drafting, done for today with its limit, or waiting', () => {
    expect(draftingLine(snapshot([], { supply: supply({ drafting: true }) }))).toEqual({ text: copy.flow.drafting, drafting: true });
    expect(draftingLine(snapshot([], { supply: supply({ reason: 'daily_limit', run_limit: 2 }) }))).toEqual({
      text: copy.flow.draftingDone.replace('{n}', '2'),
      drafting: false,
    });
    expect(draftingLine(snapshot([], { supply: supply({ reason: 'not_short' }) }))).toEqual({ text: copy.flow.draftingIdle, drafting: false });
    expect(draftingLine(snapshot([], { supply: null }))).toEqual({ text: copy.flow.draftingIdle, drafting: false });
    expect(draftingLine(snapshot([]))).toEqual({ text: copy.flow.draftingIdle, drafting: false });
  });
});

describe('plannedLine', () => {
  it('says approved and opening soon, board work, or planned', () => {
    expect(plannedLine(card({ horizon: 'next', opens_at: '2026-10-11T00:00:00Z', board_work: true }))).toBe(copy.roadmap.opensSoon);
    expect(plannedLine(card({ horizon: 'next', board_work: true }))).toBe(copy.flow.boardWork);
    expect(plannedLine(card({ horizon: 'later' }))).toBe(copy.flow.planned);
    // A now card with opens_at set is not waiting to open.
    expect(plannedLine(card({ horizon: 'now', opens_at: '2026-10-11T00:00:00Z' }))).toBe(copy.flow.planned);
  });
});
