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
import { supplyFrom } from '../lib/source';
import { buildingEmptyLine, draftingLine, FundNow, HOME_FUND_CARDS, MachineFlow } from './Flow';
import { MachineCard } from './MachineCard';

const STRIPE = 'https://buy.stripe.com/test-link';

type Lane = 'next' | 'building' | 'shipped';

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
  return { drafting: false, offline: false, short: false, reason: null, runs_today: 0, run_limit: 3, next_check_at: null, ...over };
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
// Approved agent cards waiting to open: the only cards Next up holds (docs/specs/always-open.md).
const planned = (n: number) =>
  Array.from({ length: n }, (_, i) => card({ id: `p${i}`, title: `Planned ${i + 1}`, horizon: 'next', rank: i + 1, opens_at: `2026-10-${11 + i}T00:00:00Z` }));
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
  it('draws three lanes in the order a card moves, each headed by its name and count and saying who acts in it', () => {
    renderFlow(snapshot([...planned(1), ...open(2), card({ id: 'b', title: 'Building', stage: 'building' })]));
    // The lanes set their own heights, so the layout audit leaves the list's balance alone.
    expect(document.querySelector('ol.flow-lanes')?.getAttribute('data-balance')).toBe('ignore');
    const lanes = [...document.querySelectorAll('ol.flow-lanes > li.flow-lane')];
    expect(lanes.map((li) => li.getAttribute('data-lane'))).toEqual(['next', 'building', 'shipped']);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      `${copy.flow.lanes.next.title} ${copy.flow.countOne}`,
      `${copy.flow.lanes.building.title} ${copy.flow.countOne}`,
      `${copy.flow.lanes.shipped.title} ${copy.flow.count.replace('{n}', '0')}`,
    ]);
    // Each lane is named by its heading.
    for (const li of lanes) expect(li.getAttribute('aria-labelledby')).toBe(li.querySelector('h3.flow-title')?.id);
    expect(lanes.map((li) => li.querySelector('.flow-step-number')?.textContent)).toEqual(['01', '02', '03']);
    expect(lane('building').querySelector('.flow-who')?.textContent).toBe(copy.flow.lanes.building.who);
    expect(lane('shipped').querySelector('.flow-who')?.textContent).toBe(copy.flow.lanes.shipped.who);
    // Every card in a lane is a compact face with an h4 title and no summary; the open cards are
    // FundNow's, above the lanes, and never in them.
    const faces = [...document.querySelectorAll('li.card')];
    expect(faces).toHaveLength(2);
    for (const face of faces) expect(face.getAttribute('data-compact')).toBe('true');
    expect(document.querySelector('p.card-summary')).toBeNull();
    expect(screen.queryByText('Open 1')).toBeNull();
    expect(document.querySelector('ul.fund-grid')).toBeNull();
  });

  it('shows at most three cards a lane, with the count in the heading still the whole lane', () => {
    renderFlow(snapshot([...planned(5), ...open(5), ...live(5), ...Array.from({ length: 4 }, (_, i) => card({ id: `b${i}`, title: `Building ${i + 1}`, stage: 'building' }))]));
    expect(titles('next')).toEqual(['Planned 1', 'Planned 2', 'Planned 3']);
    expect(titles('building')).toEqual(['Building 1', 'Building 2', 'Building 3']);
    expect(titles('shipped')).toEqual(['Live 5', 'Live 4', 'Live 3']);
    for (const name of ['next', 'shipped'] as const) {
      expect(lane(name).querySelector('.flow-count')?.textContent).toBe(copy.flow.count.replace('{n}', '5'));
    }
    expect(lane('building').querySelector('.flow-count')?.textContent).toBe(copy.flow.count.replace('{n}', '4'));
  });

  it('links Shipped to the reports, and Next up and Building nowhere (there is no roadmap page)', () => {
    renderFlow(snapshot([...planned(1), ...open(4), ...live(1)]));
    expect(more('next')).toBeNull();
    expect(document.querySelector('a[href="/roadmap"]')).toBeNull();
    expect([more('shipped')?.textContent, more('shipped')?.getAttribute('href')]).toEqual([copy.flow.lanes.shipped.more, '/reports']);
    expect(more('building')).toBeNull();
    expect(document.querySelector('a[href="/contribute"]')).toBeNull();
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
    it('draws only approved agent cards waiting to open, on the planned face: never the backlog, kernel work or a held card', () => {
      renderFlow(
        snapshot([
          card({ id: 'board', title: 'Board work', horizon: 'next', rank: 1, board_work: true }),
          card({ id: 'held', title: 'Held', horizon: 'next', rank: 1, board_vetoed: true, board_veto_reason: 'No.' }),
          card({ id: 'plan', title: 'Planned', horizon: 'later' }),
          card({ id: 'soon', title: 'Opens soon', horizon: 'later', opens_at: '2026-10-11T00:00:00Z' }),
          card({ id: 'now', title: 'Open now', horizon: 'now' }),
        ]),
      );
      expect(titles('next')).toEqual(['Opens soon']);
      const faces = [...lane('next').querySelectorAll('li.card')] as HTMLElement[];
      expect(faces.map((li) => li.getAttribute('data-face'))).toEqual(['planned']);
      expect(faces.map((li) => li.querySelector('.card-bottom .card-meta')?.textContent)).toEqual([copy.roadmap.opensSoon]);
      expect(lane('next').querySelector('.flow-count')?.textContent).toBe(copy.flow.countOne);
      expect(screen.queryByText('Board work')).toBeNull();
      // A planned card takes no money: no bar, no spec rows, no fund link.
      expect(within(lane('next')).queryByRole('progressbar')).toBeNull();
      expect(lane('next').querySelector('.spec-rows')).toBeNull();
      expect(screen.queryByText('Held')).toBeNull();
      // The now card is open for funding, so it is FundNow's, never Next up's.
      expect(screen.queryByText('Open now')).toBeNull();
    });

    it('stands in a tile for an empty lane', () => {
      renderFlow(snapshot(open(1)));
      expect(lane('next').querySelector('.flow-empty')?.textContent).toBe(copy.flow.lanes.next.empty);
    });

    it.each([
      ['drafting', supply({ drafting: true, reason: 'daily_limit' }), copy.flow.drafting, 'true'],
      ['done for today', supply({ reason: 'daily_limit', run_limit: 4, runs_today: 4 }), copy.flow.draftingDone.replace('{n}', '4'), null],
      ['at a zero limit', supply({ reason: 'daily_limit', run_limit: 0 }), copy.flow.draftingIdle, null],
      ['not short', supply({ reason: 'not_short' }), copy.flow.draftingIdle, null],
      ['idle', supply(), copy.flow.draftingIdle, null],
      ['without a supply row', null, copy.flow.draftingIdle, null],
      ['offline', supply({ offline: true, reason: 'already_queued' }), copy.agentsOffline, null],
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

    it('keeps the live face for a card shipped from horizon next or later: only Next up draws the planned face', () => {
      const shipped = [
        card({ id: 'ln', title: 'Shipped from next', stage: 'live', shape: 'oneoff', funding_target_usd: 0, horizon: 'next', live_at: '2026-09-16T00:00:00Z' }),
        card({ id: 'll', title: 'Shipped from later', stage: 'live', shape: 'oneoff', funding_target_usd: 0, horizon: 'later', live_at: '2026-09-15T00:00:00Z' }),
      ];
      renderFlow(snapshot([...shipped, card({ id: 'p', title: 'Still planned', horizon: 'next', opens_at: '2026-10-11T00:00:00Z' })]));
      expect(titles('shipped')).toEqual(['Shipped from next', 'Shipped from later']);
      const faces = [...lane('shipped').querySelectorAll('li.card')] as HTMLElement[];
      expect(faces.map((li) => li.getAttribute('data-face'))).toEqual(['live', 'live']);
      expect(faces.map((li) => within(li).getByRole('link', { name: copy.cardPage.watchWasBuilt }).getAttribute('href'))).toEqual(['/card/ln', '/card/ll']);
      expect(lane('shipped').textContent).not.toContain(copy.flow.planned);
      // A live card is not on the roadmap; Next up keeps only the planned card, on the planned face.
      expect(titles('next')).toEqual(['Still planned']);
      expect(lane('next').querySelector('li.card')?.getAttribute('data-face')).toBe('planned');
    });

    it('stands in a tile for an empty lane', () => {
      renderFlow(snapshot(open(1)));
      expect(lane('shipped').querySelector('.flow-empty')?.textContent).toBe(copy.flow.lanes.shipped.empty);
    });
  });

  it('never leaves a lane blank: with no cards every lane holds its tile', () => {
    renderFlow(snapshot([]));
    for (const name of ['next', 'building', 'shipped'] as const) {
      const tile = lane(name).querySelector('.flow-empty');
      expect(tile, name).not.toBeNull();
      expect(tile!.textContent!.trim(), name).not.toBe('');
      expect(lane(name).querySelector('li.card'), name).toBeNull();
    }
  });
});

describe('FundNow', () => {
  function renderFund(snap: Snapshot, machine = false) {
    return render(
      <MemoryRouter>
        <FundNow cards={groupCards(snap.cards, fundingPlace(snap)).fund} snapshot={snap} machine={machine ? <MachineCard agreement={false} /> : null} />
      </MemoryRouter>,
    );
  }

  function fundTitles(): string[] {
    return [...document.querySelectorAll('ul.fund-grid > li.card h3')].map((h) => h.textContent ?? '');
  }

  it("draws the waterfall's order as full faces in the fund grid, each with its Fund this card, and one agreement under it", () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    // The order puts the third card first.
    renderFund(snapshot(open(3), { money: books(['o2', 'o0', 'o1']) }));
    const grid = document.querySelector('ul.fund-grid')!;
    expect(grid.classList.contains('card-grid')).toBe(true);
    expect(grid.classList.contains('flow-cards')).toBe(false);
    expect(fundTitles()).toEqual(['Open 3', 'Open 1', 'Open 2']);
    // Full faces: an h3 title and the summary, never the compact face.
    const faces = [...grid.querySelectorAll('li.card')];
    for (const face of faces) {
      expect(face.getAttribute('data-compact')).toBeNull();
      expect(face.querySelector('p.card-summary')?.textContent).toBe('A summary the compact face leaves out.');
    }
    expect(screen.queryAllByRole('heading', { level: 4 })).toEqual([]);
    expect(screen.getAllByRole('link', { name: legal.fundThis }).map((a) => a.getAttribute('href'))).toEqual([
      `${STRIPE}?client_reference_id=o2`,
      `${STRIPE}?client_reference_id=o0`,
      `${STRIPE}?client_reference_id=o1`,
    ]);
    expect(document.querySelectorAll('p.fund-agreement')).toHaveLength(1);
    expect(grid.contains(document.querySelector('p.fund-agreement'))).toBe(false);
    expect(grid.nextElementSibling?.classList.contains('fund-agreement')).toBe(true);
    // Fund the next card in line is on /contribute only: with cards open, home's other way is the Machine card.
    expect(document.querySelector('.fund-next')).toBeNull();
    expect(screen.queryByText(legal.pickForMe)).toBeNull();
  });

  it('sets the Machine card under the cards and says the agreement once for both (decision 73)', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    renderFund(snapshot(open(1)), true);
    const items = document.querySelectorAll('ul.fund-grid > li');
    expect(items).toHaveLength(1);
    const machine = document.querySelector('.fund-ways > .machine-card')!;
    expect(document.querySelector('ul.fund-grid')!.compareDocumentPosition(machine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(machine.querySelector('p.fund-agreement')).toBeNull();
    expect(document.querySelectorAll('p.fund-agreement')).toHaveLength(1);
    cleanup();
    // With no card carrying a live link, the Machine card's link still has the agreement under the grid.
    renderFund(snapshot(open(2), { money: books([]) }), true);
    expect(screen.queryByRole('link', { name: legal.fundThis })).toBeNull();
    expect(document.querySelectorAll('p.fund-agreement')).toHaveLength(1);
  });

  it('says no agreement when no card carries a live link', () => {
    renderFund(snapshot(open(2)));
    expect(fundTitles()).toEqual(['Open 1', 'Open 2']);
    expect(document.querySelector('p.fund-agreement')).toBeNull();
    expect(screen.queryByRole('link', { name: legal.fundThis })).toBeNull();
  });

  it(`shows ${HOME_FUND_CARDS} cards and links the rest to /contribute only past ${HOME_FUND_CARDS}`, () => {
    renderFund(snapshot(open(5)));
    expect(fundTitles()).toEqual(['Open 1', 'Open 2', 'Open 3']);
    const link = document.querySelector('p.more a')!;
    expect([link.textContent, link.getAttribute('href')]).toEqual([copy.flow.fundMore.replace('{n}', '5'), '/contribute']);
    cleanup();
    renderFund(snapshot(open(3)));
    expect(fundTitles()).toHaveLength(3);
    expect(document.querySelector('p.more a')).toBeNull();
  });

  it('stands in a panel with no card open: fund the next card in line, and Contribute only while the Payment Link is set', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    renderFund(snapshot([card({ id: 'b', stage: 'building' })], { supply: supply({ drafting: true }) }));
    const panel = document.querySelector('.fund-empty') as HTMLElement;
    expect(panel.querySelector('.fund-empty-title')?.textContent).toBe(legal.pickForMe);
    expect(within(panel).getByText(legal.fundEmptyBody)).toBeTruthy();
    // The status line above already says no card is open, so the panel does not repeat it.
    expect(panel.textContent).not.toContain(copy.status.openNone);
    // Next up says what the Game Designer is doing, so the panel does not repeat it.
    expect(panel.querySelector('.fund-empty-agent')).toBeNull();
    expect(within(panel).getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe('/contribute');
    expect(document.querySelector('ul')).toBeNull();
    expect(document.querySelector('p.fund-agreement')).toBeNull();
    cleanup();
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
    renderFund(snapshot([]));
    expect(document.querySelector('.fund-empty-title')?.textContent).toBe(legal.pickForMe);
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    // Beside the Machine card, the agreement goes under both, once.
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    renderFund(snapshot([]), true);
    const ways = document.querySelector('.fund-ways')!;
    expect(ways.querySelector('.machine-card')).not.toBeNull();
    expect(ways.nextElementSibling?.classList.contains('fund-agreement')).toBe(true);
    expect(document.querySelectorAll('p.fund-agreement')).toHaveLength(1);
  });
});

describe('draftingLine', () => {
  it('reads the supply: drafting, done for today with its limit, or waiting', () => {
    expect(draftingLine(snapshot([], { supply: supply({ drafting: true }) }))).toEqual({ text: copy.flow.drafting, drafting: true });
    expect(draftingLine(snapshot([], { supply: supply({ reason: 'daily_limit', run_limit: 2 }) }))).toEqual({
      text: copy.flow.draftingDone.replace('{n}', '2'),
      drafting: false,
    });
    expect(draftingLine(snapshot([], { supply: supply({ reason: 'no_money' }) }))).toEqual({ text: copy.flow.draftingNoMoney, drafting: false });
    expect(draftingLine(snapshot([], { supply: supply({ reason: 'not_short' }) }))).toEqual({ text: copy.flow.draftingIdle, drafting: false });
    expect(draftingLine(snapshot([], { supply: null }))).toEqual({ text: copy.flow.draftingIdle, drafting: false });
    expect(draftingLine(snapshot([]))).toEqual({ text: copy.flow.draftingIdle, drafting: false });
  });
});

describe('the agents offline (docs/specs/honest-status.md)', () => {
  it('says so in Next up, drafts nothing, and Building promises no start time', () => {
    // Production on 19 October 2026: the dispatcher last checked in on 15 October, a draft queued since.
    const offline = supplyFrom({ drafting: false, offline: true, short: true, reason: 'already_queued', runs_today: 0, run_limit: 12, next_check_at: null });
    expect(offline).toMatchObject({ drafting: false, offline: true });
    expect(draftingLine(snapshot([], { supply: offline }))).toEqual({ text: copy.agentsOffline, drafting: false });
    expect(buildingEmptyLine(snapshot([], { supply: offline }))).toBe(copy.flow.lanes.building.emptyOffline);
    expect(copy.flow.lanes.building.emptyOffline).not.toMatch(/hour|minute|soon/);
    // An offline flag wins over a drafting one, whatever the database said.
    expect(supplyFrom({ drafting: true, offline: true })).toMatchObject({ drafting: false, offline: true });
    // Online, a running draft is drafting and the promise stands.
    const online = supplyFrom({ drafting: true, offline: false, short: true, reason: 'already_queued', runs_today: 1, run_limit: 12, next_check_at: null });
    expect(online).toMatchObject({ drafting: true, offline: false });
    expect(buildingEmptyLine(snapshot([], { supply: online }))).toBe(copy.flow.lanes.building.empty);
    // A document from before the flag reads as online, with the database's drafting as it is.
    expect(supplyFrom({ drafting: true, runs_today: 0 })).toMatchObject({ drafting: true, offline: false });
  });

  it("says so on a funded card in Building, in the waiting line's place", () => {
    const funded = card({ id: 'f', stage: 'funded', funding_target_usd: 3, funded_usd: 3 });
    renderFlow(snapshot([funded], { supply: supply({ offline: true }) }));
    expect(lane('building').querySelector('p.card-waiting')?.textContent).toBe(copy.agentsOffline);
    cleanup();
    renderFlow(snapshot([funded], { supply: supply() }));
    expect(lane('building').querySelector('p.card-waiting')?.textContent).toBe(copy.waitingForAgents);
  });
});

describe('plannedLine', () => {
  it('says approved and opening soon, kernel work (cards.board_work), or planned', () => {
    expect(plannedLine(card({ horizon: 'next', opens_at: '2026-10-11T00:00:00Z', board_work: true }))).toBe(copy.roadmap.opensSoon);
    expect(plannedLine(card({ horizon: 'next', board_work: true }))).toBe(copy.flow.kernelWork);
    expect(plannedLine(card({ horizon: 'later' }))).toBe(copy.flow.planned);
    // A now card with opens_at set is not waiting to open.
    expect(plannedLine(card({ horizon: 'now', opens_at: '2026-10-11T00:00:00Z' }))).toBe(copy.flow.planned);
  });
});
