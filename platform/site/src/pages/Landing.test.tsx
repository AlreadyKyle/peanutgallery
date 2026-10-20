import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { formatDate } from '../lib/format';
import { RESERVE_PCT } from '../lib/payment';
import { books } from '../lib/books.test-fixture';
import type { Role, Snapshot, StudioSource, Supply } from '../lib/source';
import { resetSignInOpen } from '../lib/sign-in';
import { SourceProvider } from '../lib/studio';
import { HOME_ACTIONS, Landing } from './Landing';

const snapshot: Snapshot = {
  pool: {
    balance_usd: 48.56,
    reserve_usd: 7.1,
    incident_reserve_usd: 2.56,
    held_usd: 61.5,
    daily_spent_usd: 0,
    day: '2026-09-14',
  },
  cards: [
    {
      id: 'now1',
      title: 'The core loop',
      summary: 'Walk, jump and land in the first level.',
      intent: 'Move, jump, land.',
      source: 'board',
      stage: 'building',
      shape: 'goal',
      bucket: 'game',
      folder: 'seed-1',
      horizon: 'now',
      rank: null,
      executor_role_id: null,
      funding_target_usd: 100,
      funded_usd: 100,
      spent_usd: 3.2,
      created_at: '2026-09-14T00:00:00Z',
      updated_at: '2026-09-14T00:00:00Z',
      live_at: null,
    },
    {
      id: 'next1',
      title: 'A second level',
      summary: 'A second level to play after the first.',
      intent: 'Add a second stage.',
      source: 'community',
      stage: 'voted',
      shape: 'goal',
      bucket: 'game',
      folder: 'seed-1',
      horizon: 'now',
      rank: null,
      executor_role_id: null,
      funding_target_usd: 100,
      funded_usd: 25,
      spent_usd: 0,
      created_at: '2026-09-14T00:00:01Z',
      updated_at: '2026-09-14T00:00:01Z',
      live_at: null,
    },
    {
      id: 'next2',
      title: 'A music track',
      summary: null,
      intent: '',
      source: 'agent',
      stage: 'proposed',
      shape: 'goal',
      bucket: 'game',
      folder: 'seed-1',
      horizon: 'now',
      rank: null,
      executor_role_id: null,
      funding_target_usd: 50,
      funded_usd: 0,
      spent_usd: 0,
      created_at: '2026-09-14T00:00:02Z',
      updated_at: '2026-09-14T00:00:02Z',
      live_at: null,
    },
    {
      id: 'studio1',
      title: 'A clearer ledger page',
      summary: null,
      intent: null,
      source: 'board',
      stage: 'proposed',
      shape: 'goal',
      bucket: 'platform',
      folder: 'platform',
      horizon: 'now',
      rank: null,
      executor_role_id: null,
      funding_target_usd: 10,
      funded_usd: 0,
      spent_usd: 0,
      created_at: '2026-09-14T00:00:03Z',
      updated_at: '2026-09-14T00:00:03Z',
      live_at: null,
    },
    {
      id: 'queued1',
      title: 'Gatherer costs 11',
      summary: null,
      intent: null,
      source: 'board',
      stage: 'funded',
      shape: 'oneoff',
      bucket: 'game',
      folder: 'seed-1',
      horizon: 'now',
      rank: null,
      executor_role_id: null,
      funding_target_usd: 0,
      funded_usd: 0,
      spent_usd: 0,
      created_at: '2026-09-14T00:00:04Z',
      updated_at: '2026-09-14T00:00:04Z',
      live_at: null,
    },
    {
      id: 'live1',
      title: 'Save and resume',
      summary: 'Your progress is kept between visits.',
      intent: 'Persist the save.',
      source: 'board',
      stage: 'live',
      shape: 'goal',
      bucket: 'game',
      folder: 'seed-1',
      horizon: 'now',
      rank: null,
      executor_role_id: null,
      funding_target_usd: 3,
      funded_usd: 3,
      spent_usd: 1.5,
      created_at: '2026-09-13T00:00:00Z',
      updated_at: '2026-09-15T09:00:00Z',
      live_at: null,
    },
    {
      id: 'live2',
      title: 'The unlock list',
      summary: null,
      intent: null,
      source: 'board',
      stage: 'live',
      shape: 'oneoff',
      bucket: 'game',
      folder: 'seed-1',
      horizon: 'now',
      rank: null,
      executor_role_id: null,
      funding_target_usd: 0,
      funded_usd: 0,
      spent_usd: 0.75,
      created_at: '2026-09-13T00:00:01Z',
      updated_at: '2026-09-15T11:00:00Z',
      live_at: null,
    },
    {
      id: 'plan1',
      title: 'A third level',
      summary: 'Planned, not open for funding.',
      intent: null,
      source: 'board',
      stage: 'proposed',
      shape: 'goal',
      bucket: 'game',
      folder: 'seed-1',
      horizon: 'next',
      rank: 2,
      executor_role_id: null,
      funding_target_usd: 0,
      funded_usd: 0,
      spent_usd: 0,
      created_at: '2026-09-14T00:00:05Z',
      updated_at: '2026-09-14T00:00:05Z',
      live_at: null,
    },
  ],
  funding: { next1: { contributors: 3, credited_usd: 18.5 }, live1: { contributors: 2, credited_usd: 3 } },
  launchedAt: null,
  paused: false,
  totals: { usd_total: 1.25, input_tokens: 12000, cached_tokens: 3000, output_tokens: 800, row_count: 3 },
  events: Array.from({ length: 7 }, (_, i) => ({
    id: `e${i}`,
    card_id: 'live2',
    role_id: 'r-a',
    type: i === 0 ? 'ship' : 'tool_call',
    created_at: `2026-09-15T11:0${i}:00Z`,
  })),
  deploys: [],
  roles: [
    role('r-a', 'Builder A', 'Builds funded game cards.'),
    role('r-b', 'Builder B', 'Builds funded game cards, too.'),
    role('r-q', 'QA', 'Finds problems in Dust.'),
    role('r-p', 'Platform Builder', 'Builds site cards.'),
    { ...role('r-d', 'Game Director', 'Holds the pillars.'), write_access: false },
  ],
  cardTitles: { live2: 'The unlock list' },
  money: books(['next1', 'next2', 'studio1']),
  missing: [],
};

function role(id: string, title: string, description: string): Role {
  return {
    id,
    name: title,
    title,
    description,
    species_note: 'A small blue creature with two round antennae.',
    model: 'claude-opus-5-5',
    write_access: true,
    state: 'active',
    hired_at: '2026-09-14T00:00:00Z',
    // The roster marks each running; the Platform Builder's closed lane starts it later (teamStatus).
    status: 'running',
    trigger: null,
    paused: false,
    paused_reason: null,
  };
}

function supply(over: Partial<Supply> = {}): Supply {
  return { drafting: false, offline: false, short: true, reason: null, runs_today: 0, run_limit: 3, next_check_at: null, ...over };
}

function fakeSource(over: Partial<Snapshot> = {}): StudioSource {
  return {
    load: () => Promise.resolve({ ...snapshot, ...over }),
  };
}

function renderLanding(source: StudioSource | null) {
  return render(
    <SourceProvider source={source}>
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    </SourceProvider>,
  );
}

type Lane = 'next' | 'building' | 'shipped';

/** Waits for the snapshot to draw the floor's stations (docs/specs/place.md). */
async function lanesDrawn(): Promise<void> {
  await waitFor(() => expect(document.querySelectorAll('.floor-parts > [data-station-part]')).toHaveLength(5));
}

/** The status line's text, once the snapshot has loaded. */
async function statusLine(): Promise<HTMLElement> {
  await lanesDrawn();
  return document.querySelector('p.status-line') as HTMLElement;
}

/** A lane's station on the floor. */
function lane(name: Lane): HTMLElement {
  return document.querySelector(`[data-station-part="${name}"]`) as HTMLElement;
}

/** The card titles a lane shows, in order (h3 on home's compact faces, under the station's h2). */
function laneTitles(name: Lane): string[] {
  return [...lane(name).querySelectorAll<HTMLElement>('li.card')]
    .flatMap((card) => within(card).queryAllByRole('heading', { level: 3 }))
    .map((h) => h.textContent ?? '');
}

/** The fund section above the lanes. */
function fundSection(): HTMLElement {
  return screen.getByRole('region', { name: copy.flow.fundTitle });
}

/** The cards to fund, in order (h3 on their full faces). */
function fundTitles(): string[] {
  return [...document.querySelectorAll('ul.fund-grid > li.card h3')].map((h) => h.textContent ?? '');
}

beforeEach(() => {
  vi.stubEnv('VITE_DISCORD_INVITE', '');
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
  vi.stubEnv('VITE_PLAY_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Landing', () => {
  it("is drawn in the board's order, on four bands, with every card on the floor: the cards to fund, the first game, Ideas, Next up, Building, then Shipped", async () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
    const { container } = renderLanding(fakeSource());

    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([copy.pitchTitle]);
    expect(screen.getByText(copy.pitchBody)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.playFree }).getAttribute('href')).toBe('https://play.example');
    // The hero's button goes to the cards to fund; How it works is in the top bar (decision 72).
    expect(screen.getByRole('link', { name: copy.fundACard }).getAttribute('href')).toBe('#fund');

    await screen.findByRole('region', { name: copy.team.title });
    await lanesDrawn();
    // The live studio sits on the plate beside the pitch, in view when the page opens (docs/specs/brand.md,
    // Home); the floor follows in the board's order (decisions 67 and 70): the cards to fund, the first
    // game, then the players' ideas and Next up, Building and Shipped (docs/specs/place.md).
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      copy.studioRoom.title,
      copy.flow.fundTitle,
      copy.game.title,
      copy.ideas.title,
      copy.flow.lanes.next.title,
      copy.flow.lanes.building.title,
      copy.flow.lanes.shipped.title,
      copy.team.title,
      legal.moneyHeading,
    ]);
    // Four bands: the pitch and the live studio (the ink plate), the floor (paper: the stations, with
    // the first game after the cards to fund), the team (ink) and the money (paper).
    const bands = [...container.querySelectorAll<HTMLElement>('main > *')];
    expect(bands.map((band) => band.className)).toEqual(['band floor-plate', 'band floor-band', 'band', 'band']);
    expect(bands[0]!.querySelector('h1')).not.toBeNull();
    expect([...bands[0]!.querySelectorAll('h2')].map((h) => h.id)).toEqual(['studio']);
    expect([...bands[1]!.querySelectorAll('h2')].map((h) => h.id)).toEqual(['fund', 'game', 'ideas', 'next', 'building', 'shipped']);
    // The first game's tile: its name, its box art with alt text, and Play to the game (decision 68).
    expect(screen.getByRole('link', { name: copy.game.play }).getAttribute('href')).toBe('https://play.example');
    expect(screen.getByRole('img', { name: copy.game.alt }).getAttribute('src')).toBe('/games/dust-box-art.svg');
    // The split is told on /how-it-works and /contribute, not again on home.
    expect(screen.queryByText(legal.agentShareLine, { exact: false })).toBeNull();
    expect(bands[2]!.querySelector('h2')?.id).toBe('team');
    expect(bands[3]!.querySelector('h2')?.id).toBe('money');
    expect(screen.getByText(copy.flow.fundIntro)).toBeTruthy();
    // The cards to fund are full faces, ahead of the building and shipped stations.
    const grid = bands[1]!.querySelector('ul.fund-grid')!;
    expect(grid.compareDocumentPosition(lane('building')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const face of grid.querySelectorAll('li.card')) expect(face.hasAttribute('data-compact')).toBe(false);
    // Every card is in band 2.
    expect(container.querySelectorAll('li.card').length).toBeGreaterThan(0);
    for (const card of container.querySelectorAll('li.card, .funding-bar')) expect(card.closest('main > .band')).toBe(bands[1]);
    // The stations, Fund first, each also a link in the rail; the room carries no labels over them.
    expect([...container.querySelectorAll('.floor-parts > [data-station-part]')].map((part) => part.getAttribute('data-station-part'))).toEqual([
      'fund',
      'ideas',
      'next',
      'building',
      'shipped',
    ]);
    expect([...container.querySelectorAll('.floor-stations a')].map((a) => a.getAttribute('href'))).toEqual(['#fund', '#ideas', '#next', '#building', '#shipped', '#team']);
    expect(bands[0]!.querySelectorAll('.station-tags, .station-tag, .station-pill')).toHaveLength(0);
    // No filter chips, no old sections, no Right now panel, no How it works steps, no fixed rules.
    expect(screen.queryByRole('group', { name: copy.filterLabel })).toBeNull();
    for (const old of ['Building now', "Fund what's next", 'Queued', 'Planned next']) expect(screen.queryByRole('heading', { level: 2, name: old })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText(legal.fixedRulesIntro)).toBeNull();
    // Each card page link is a Watch link: on the building face and on each shipped face (supporter-pages).
    // The live studio and the pipe link cards too (docs/specs/final-state.md); they are counted apart.
    const watch = [...container.querySelectorAll('a[href^="/card/"]')].filter((a) => a.closest('.live-studio') === null).map((a) => a.textContent);
    expect(watch.length).toBeGreaterThan(0);
    expect(new Set(watch)).toEqual(new Set([copy.cardPage.watchBuilt, copy.cardPage.watchWasBuilt]));
  }, 20_000); // About 1.2 s alone; pnpm verify runs every package at once, and under that load it passed 5 s.

  it('says in one status line how many cards are open and building, with the figures at 600', async () => {
    renderLanding(fakeSource());
    const line = await statusLine();
    expect(line.textContent).toBe('3 cards are open for funding. 1 card is being built.');
    expect([...line.querySelectorAll('strong')].map((strong) => strong.textContent)).toEqual(['3 cards', '1 card']);
    expect(line.querySelector('svg[data-glyph="pause"]')).toBeNull();
  });

  it('draws no game tile without a play address, like the hero button', async () => {
    renderLanding(fakeSource());
    await screen.findByRole('region', { name: copy.team.title });
    expect(screen.queryByRole('region', { name: copy.game.title })).toBeNull();
    expect(screen.queryByRole('link', { name: copy.game.play })).toBeNull();
  });

  it('says the agents are drafting when no card is open and the supply says so, and that none is open otherwise', async () => {
    const closed = snapshot.cards.filter((card) => !['next1', 'next2', 'studio1'].includes(card.id));
    renderLanding(fakeSource({ cards: closed, supply: supply({ drafting: true }) }));
    expect((await statusLine()).textContent).toBe(`${copy.status.drafting} 1 card is being built.`);
    expect(lane('next').querySelector('.flow-who')?.textContent).toBe(copy.flow.drafting);
    cleanup();
    renderLanding(fakeSource({ cards: closed, supply: supply({ drafting: false }) }));
    expect((await statusLine()).textContent).toBe(`${copy.status.openNone} 1 card is being built.`);
    cleanup();
    // An open card is said first, whatever the supply.
    renderLanding(fakeSource({ supply: supply({ drafting: true }) }));
    expect((await statusLine()).textContent).toBe('3 cards are open for funding. 1 card is being built.');
  });

  it('says the agents are offline in place of what they build or draft, with the open cards still counted (decision 77)', async () => {
    renderLanding(fakeSource({ supply: supply({ offline: true }) }));
    expect((await statusLine()).textContent).toBe(`3 cards are open for funding. ${copy.agentsOffline}`);
    expect(lane('next').querySelector('.flow-who')?.textContent).toBe(copy.agentsOffline);
    // The building card names its builder, and says nothing about building now.
    expect(document.querySelector('main')?.textContent).not.toContain(copy.buildingBy.replace('{name} ', ''));
    cleanup();
    const closed = snapshot.cards.filter((card) => !['next1', 'next2', 'studio1'].includes(card.id));
    renderLanding(fakeSource({ cards: closed, supply: supply({ offline: true, drafting: true }) }));
    expect((await statusLine()).textContent).toBe(`${copy.status.openNone} ${copy.agentsOffline}`);
    cleanup();
    // A pause is not offline: the line is as it was (decision 62).
    renderLanding(fakeSource({ paused: true, pauseReason: 'board', supply: supply() }));
    expect((await statusLine()).textContent).toBe('3 cards are open for funding. 1 card is being built.');
  });

  it('says nothing about a pause while the studio is paused, whatever the reason (decision 62)', async () => {
    for (const pauseReason of [null, 'awaiting_credit', 'spend_limit', 'incident', 'board']) {
      renderLanding(fakeSource({ paused: true, pauseReason, cards: snapshot.cards.filter((card) => card.stage !== 'building') }));
      await lanesDrawn();
      const line = document.querySelector('p.status-line')!;
      await waitFor(() => expect(line.textContent).toBe('3 cards are open for funding.'));
      expect(line.querySelector('svg[data-glyph="pause"]')).toBeNull();
      expect(document.querySelector('p.notice')).toBeNull();
      expect(document.querySelectorAll('.team-strip svg.avatar').length).toBe(3);
      cleanup();
    }
  });

  it('shows the loading line while the snapshot loads, and the unavailable line without a database', () => {
    renderLanding({ load: () => new Promise(() => {}) });
    // The status line waits for the snapshot; the fund section holds the loading line, and the lanes
    // wait too.
    expect(document.querySelector('p.status-line')).toBeNull();
    expect(within(fundSection()).getByText(copy.loadingCards).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('region', { name: copy.flow.title })).toBeNull();
    expect(document.querySelector('ol.flow-lanes')).toBeNull();
    cleanup();
    renderLanding(null);
    expect(document.querySelector('p.status-line')).toBeNull();
    expect(within(fundSection()).getByText(legal.meterUnavailable)).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(document.querySelector('ol.flow-lanes')).toBeNull();
    expect(within(fundSection()).getByText(legal.meterUnavailable)).toBeTruthy();
    expect(screen.queryByRole('region', { name: copy.flow.title })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: copy.team.title })).toBeNull();
  });

  it('lists open cards in funding order with fund links in the fund section, and the building then the funded cards in Building', async () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    renderLanding(fakeSource());
    await lanesDrawn();
    const fund = fundSection();
    expect(fund.querySelector('ul.fund-grid')).not.toBeNull();
    expect(fundTitles()).toEqual(['A second level', 'A music track', 'A clearer ledger page']);
    expect(within(fund).getAllByRole('link', { name: legal.fundThis }).map((a) => a.getAttribute('href'))).toEqual([
      'https://buy.stripe.com/test-link?client_reference_id=next1',
      'https://buy.stripe.com/test-link?client_reference_id=next2',
      'https://buy.stripe.com/test-link?client_reference_id=studio1',
    ]);
    // Three cards: no See all link, only the link to what a contribution gets you.
    expect(fund.querySelector('p.more a[href="/contribute"]')).toBeNull();
    expect(within(fund).getByRole('link', { name: legal.perks.link }).getAttribute('href')).toBe('/contribute#perks-title');
    expect(fund.querySelector('.perks')).toBeNull();
    const building = lane('building');
    expect(laneTitles('building')).toEqual(['The core loop', 'Gatherer costs 11']);
    expect(within(building).getByText(`${copy.sources.board} · $3.20 ${legal.spentSoFar}`)).toBeTruthy();
    expect(within(building).getByText('Gatherer costs 11').closest('li')?.getAttribute('data-face')).toBe('funded');
    expect(within(building).queryByRole('progressbar')).toBeNull();
    // No brief on a card; the agreement is said once, under the fund grid, and nowhere else.
    expect(document.querySelector('details.brief')).toBeNull();
    // The Machine card (docs/specs/final-state.md) is its own checkout link; the one agreement line
    // under the cards covers it too, so the page says it once.
    expect(within(fund).getAllByText(/By funding you accept/)).toHaveLength(1);
    expect(screen.getAllByText(/By funding you accept/)).toHaveLength(1);
    expect(fund.querySelector('.machine-card .fund-agreement')).toBeNull();
  });

  it('shows three cards to fund and links See all n open cards to /contribute', async () => {
    const open = Array.from({ length: 5 }, (_, i) => ({ ...snapshot.cards[2]!, id: `o${i}`, title: `Open card ${i + 1}` }));
    renderLanding(fakeSource({ cards: open, money: books(open.map((card) => card.id)) }));
    await lanesDrawn();
    expect(fundTitles()).toEqual(['Open card 1', 'Open card 2', 'Open card 3']);
    const all = within(fundSection()).getByRole('link', { name: copy.flow.fundMore.replace('{n}', '5') });
    expect(all.getAttribute('href')).toBe('/contribute');
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it("counts and draws as open for funding only the cards in the waterfall's order, and every open card when it did not load", async () => {
    // The fixture's order holds next1, next2 and studio1; leave studio1 out, as a veto would.
    renderLanding(fakeSource({ money: books(['next1', 'next2']) }));
    expect((await statusLine()).textContent).toBe('2 cards are open for funding. 1 card is being built.');
    const titles = fundTitles();
    expect(titles).toHaveLength(2);
    expect(titles).not.toContain(snapshot.cards.find((card) => card.id === 'studio1')!.title);
    cleanup();
    renderLanding(fakeSource({ money: null, missing: ['money'] }));
    expect((await statusLine()).textContent).toBe('3 cards are open for funding. 1 card is being built.');
    expect(fundTitles()).toHaveLength(3);
    expect(within(fundSection()).queryByRole('link', { name: legal.fundThis })).toBeNull();
  });

  it('never lists a next or later card among the cards to fund, nor a now card in Next up', async () => {
    const planned = [
      { ...snapshot.cards[2]!, id: 'later1', title: 'A planned card', horizon: 'later' as const, funding_target_usd: 0 },
      { ...snapshot.cards[1]!, id: 'next1b', title: 'A ranked card', horizon: 'next' as const, rank: 1 },
      { ...snapshot.cards[1]!, id: 'soon1', title: 'An approved draft', horizon: 'next' as const, opens_at: '2026-10-11T00:00:00Z' },
    ];
    const cards = [...snapshot.cards, ...planned];
    renderLanding(fakeSource({ cards, money: books(['next1', 'next2', 'studio1', 'next1b', 'later1']) }));
    await lanesDrawn();
    const fund = fundTitles();
    expect(fund).not.toContain('A planned card');
    expect(fund).not.toContain('A ranked card');
    // Next up holds only the approved agent card waiting to open, on the planned face; the backlog
    // cards are the repository's plan and never show (docs/specs/always-open.md).
    expect(laneTitles('next')).toEqual(['An approved draft']);
    const horizon = (li: Element) => cards.find((card) => card.id === li.getAttribute('data-card'))!.horizon;
    for (const li of lane('next').querySelectorAll('li.card')) {
      expect(horizon(li)).not.toBe('now');
      expect(li.getAttribute('data-face')).toBe('planned');
    }
    for (const li of document.querySelectorAll('ul.fund-grid > li.card')) expect(horizon(li)).toBe('now');
    expect(within(lane('next')).queryByRole('progressbar')).toBeNull();
  });

  it('keeps Ideas on the floor and the rail while sign-in is closed and the board has no ideas, with no pitch button', async () => {
    resetSignInOpen();
    window.localStorage.clear();
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
    const fetch = vi.fn((url: string) => {
      if (url.includes('/auth/settings')) return json({ signIn: false });
      if (url.includes('/suggestions')) return json({ items: [], next: null });
      return Promise.reject(new TypeError('offline'));
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const { container } = renderLanding(fakeSource());
      await waitFor(() => expect(document.querySelectorAll('.floor-parts > [data-station-part]')).toHaveLength(5));
      await waitFor(() => expect(fetch.mock.calls.map(([url]) => url).some((url) => url.includes('/suggestions'))).toBe(true));
      await waitFor(() => expect(window.localStorage.getItem('mm:sign-in-open')).toBe('0'));
      const part = container.querySelector<HTMLElement>('[data-station-part="ideas"]')!;
      expect(part).not.toBeNull();
      await waitFor(() => expect(within(part).getByText(copy.ideas.emptyClosed)).toBeTruthy());
      expect(within(part).queryByText(copy.ideas.closed)).toBeNull();
      expect(within(part).queryByRole('link', { name: copy.ideas.pitch })).toBeNull();
      expect([...container.querySelectorAll('.floor-stations a')].map((a) => a.getAttribute('href'))).toContain('#ideas');
    } finally {
      vi.unstubAllGlobals();
      resetSignInOpen();
      window.localStorage.clear();
    }
  });

  it('leaves a held card out of Next up', async () => {
    const soon = { ...snapshot.cards[7]!, id: 'soon1', title: 'An approved draft', opens_at: '2026-10-12T00:00:00Z' };
    const held = { ...snapshot.cards[7]!, id: 'held1', title: 'A held card', rank: 1, opens_at: '2026-10-11T00:00:00Z', board_vetoed: true, board_veto_reason: 'Not now.' };
    renderLanding(fakeSource({ cards: [...snapshot.cards, soon, held] }));
    await lanesDrawn();
    expect(laneTitles('next')).toEqual(['An approved draft']);
    expect(screen.queryByText('A held card')).toBeNull();
  });

  it('draws the fund panel and three lanes for a database with no cards, each lane holding its tile and none blank', async () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    const { container } = renderLanding(fakeSource({ cards: [], funding: {}, money: books([]) }));
    expect((await statusLine()).textContent).toBe(copy.status.openNone);
    for (const name of ['next', 'building', 'shipped'] as const) {
      const tile = lane(name).querySelector('.flow-empty');
      expect(tile, name).not.toBeNull();
      expect(tile!.textContent!.trim(), name).not.toBe('');
      expect(lane(name).querySelector('li.card'), name).toBeNull();
    }
    // The fund section stands in a panel: fund the next card in line, with no repeat of the status line.
    const panel = fundSection().querySelector('.fund-empty') as HTMLElement;
    expect(panel.querySelector('.fund-empty-title')?.textContent).toBe(legal.pickForMe);
    expect(within(panel).getByText(legal.fundEmptyBody)).toBeTruthy();
    expect(panel.textContent).not.toContain(copy.status.openNone);
    // Next up says what the Game Designer is doing, so the panel does not.
    expect(panel.querySelector('.fund-empty-agent')).toBeNull();
    expect(within(panel).getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe('/contribute');
    expect(document.querySelector('ul.fund-grid')).toBeNull();
    expect(lane('building').querySelector('.flow-empty')?.textContent).toBe(copy.flow.lanes.building.empty);
    // Ideas holds no drafted card, and says what the Game Designer is doing instead.
    expect(lane('next').querySelector('li.card')).toBeNull();
    expect(lane('next').querySelector('.flow-who')?.textContent).toBe(copy.flow.draftingIdle);
    expect(lane('next').querySelector('.flow-empty')?.textContent).toBe(copy.flow.lanes.next.empty);
    expect(lane('shipped').querySelector('.flow-empty')?.textContent).toBe(copy.flow.lanes.shipped.empty);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.querySelectorAll('main > .band')).toHaveLength(4);
  });

  it("says the Game Designer's state in Next up, and the idle line when the supply is missing", async () => {
    // The fixture has no supply, as before the database carried it.
    renderLanding(fakeSource());
    await lanesDrawn();
    expect(lane('next').querySelector('.flow-who')?.textContent).toBe(copy.flow.draftingIdle);
    cleanup();
    renderLanding(fakeSource({ supply: null }));
    await lanesDrawn();
    expect(lane('next').querySelector('.flow-who')?.textContent).toBe(copy.flow.draftingIdle);
    expect(lane('next').querySelector('.flow-who')?.hasAttribute('data-drafting')).toBe(false);
    cleanup();
    renderLanding(fakeSource({ supply: supply({ reason: 'daily_limit', run_limit: 3, runs_today: 3 }) }));
    await lanesDrawn();
    expect(lane('next').querySelector('.flow-who')?.textContent).toBe(copy.flow.draftingDone.replace('{n}', '3'));
  });

  it('draws the first three running roles as a team strip linking to /team, and three bands without roles', async () => {
    renderLanding(fakeSource());
    const team = await screen.findByRole('region', { name: copy.team.title });
    expect(
      within(team)
        .getAllByRole('link')
        .filter((a) => a.classList.contains('member'))
        .map((a) => [a.querySelector('.member-name')?.textContent, a.querySelector('.member-job')?.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Builder A', 'Builds funded game cards.', '/team#agent-r-a'],
      ['Builder B', 'Builds funded game cards, too.', '/team#agent-r-b'],
      ['QA', 'Finds problems in Dust.', '/team#agent-r-q'],
    ]);
    expect(within(team).getByRole('link', { name: copy.team.meetAll }).getAttribute('href')).toBe('/team');
    cleanup();
    const { container } = renderLanding(fakeSource({ roles: [] }));
    await lanesDrawn();
    expect(screen.queryByRole('region', { name: copy.team.title })).toBeNull();
    // Signal, paper (the cards), then the money takes the third band.
    const bands = [...container.querySelectorAll('main > .band')];
    expect(bands).toHaveLength(3);
    expect(bands[2]!.querySelector('h2')?.id).toBe('money');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      copy.studioRoom.title,
      copy.flow.fundTitle,
      copy.ideas.title,
      copy.flow.lanes.next.title,
      copy.flow.lanes.building.title,
      copy.flow.lanes.shipped.title,
      legal.moneyHeading,
    ]);
    // With no team, the map leaves the lounge's station out.
    expect([...container.querySelectorAll('.floor-stations a')].map((a) => a.getAttribute('href'))).not.toContain('#team');
  });

  it('lists the latest three shipped cards, newest first, saying what each cost and who funded it', async () => {
    const more = [3, 4].map((n) => ({ ...snapshot.cards[6]!, id: `live${n}`, title: `Older ship ${n}`, updated_at: `2026-09-1${n - 2}T00:00:00Z` }));
    renderLanding(fakeSource({ cards: [...snapshot.cards, ...more] }));
    await lanesDrawn();
    const shipped = lane('shipped');
    expect(laneTitles('shipped')).toEqual(['The unlock list', 'Save and resume', 'Older ship 4']);
    // The rail counts every shipped card; the station shows the latest three.
    expect(document.querySelector('.floor-stations a[href="#shipped"] .floor-station-count')?.textContent).toBe('4');
    const faces = [...shipped.querySelectorAll('li.card')] as HTMLElement[];
    expect(faces.map((li) => li.getAttribute('data-face'))).toEqual(['live', 'live', 'live']);
    expect(within(faces[1]!).getByText(new RegExp(`\\$1\\.50 ${legal.spent}`))).toBeTruthy();
    expect(within(faces[1]!).getByRole('link', { name: copy.cardPage.watchWasBuilt }).getAttribute('href')).toBe('/card/live1');
    expect(within(shipped).queryByRole('progressbar')).toBeNull();
    expect(within(shipped).getByRole('link', { name: copy.flow.lanes.shipped.more }).getAttribute('href')).toBe('/reports');
    // With nothing building, Building names the newest ship.
    cleanup();
    renderLanding(fakeSource({ cards: snapshot.cards.filter((card) => !['now1', 'queued1'].includes(card.id)) }));
    await lanesDrawn();
    expect(lane('building').querySelector('.flow-empty .card-meta')?.textContent).toBe(
      copy.flow.lanes.building.lastBuilt.replace('{title}', 'The unlock list').replace('{date}', formatDate('2026-09-15T11:00:00Z')),
    );
  });

  it('says where the money goes: the pool with the coin in one line, that these are contributions and the ledger has every figure, and the five latest actions', async () => {
    renderLanding(fakeSource());
    const money = await screen.findByRole('region', { name: legal.moneyHeading });
    await waitFor(() => expect(within(money).getByText('$48.56')).toBeTruthy());
    expect(money.querySelector('.pool-line svg.coin')).not.toBeNull();
    expect(money.querySelector('.pool-line')?.textContent).toBe(`$48.56 ${legal.poolInline}`);
    expect(within(money).getByText(`${legal.notDonations} ${legal.moneyLedgerLine}`)).toBeTruthy();
    // The split is told on /how-it-works and /contribute (the copy audit of 18 October 2026).
    expect(money.querySelector('p.money-split')).toBeNull();
    expect(money.textContent).not.toContain(`${RESERVE_PCT}% of every contribution`);
    expect(within(money).getByRole('heading', { level: 3, name: legal.latestActions })).toBeTruthy();
    expect(within(money).getAllByRole('listitem')).toHaveLength(HOME_ACTIONS);
    expect(within(money).getByRole('link', { name: copy.fullLedger }).getAttribute('href')).toBe('/ledger');
  });

  it('shows In the pool at $0.00 and states the shortfall when agent work has cost more than came in', async () => {
    renderLanding(fakeSource({ pool: { ...snapshot.pool!, balance_usd: -1.234 } }));
    const money = await screen.findByRole('region', { name: legal.moneyHeading });
    await waitFor(() => expect(within(money).getByText('$0.00')).toBeTruthy());
    expect(within(money).getByText(`${legal.shortfall.replace('{amount}', '$1.23')} ${legal.notDonations} ${legal.moneyLedgerLine}`)).toBeTruthy();
    expect(screen.queryByText(/-\$/)).toBeNull();
  });

  it('keeps the figures and says they may be out of date when a refresh fails, until one succeeds', async () => {
    // A return to the tab loads at once (lib/studio.tsx).
    const onChange = () => document.dispatchEvent(new Event('visibilitychange'));
    let fail = false;
    renderLanding({
      load: () => (fail ? Promise.reject(new Error('network down')) : Promise.resolve(snapshot)),
    });
    // The live region is in place, empty, before any figure loads, so its text arriving is announced.
    const status = document.querySelector('.fund-status p.status[role="status"]')!;
    expect(status.textContent).toBe('');
    await waitFor(() => expect(screen.getByText('$48.56')).toBeTruthy());
    fail = true;
    onChange();
    await waitFor(() => expect(status.textContent).toBe(legal.staleFigures), { timeout: 3000 });
    expect(screen.getByText('$48.56')).toBeTruthy();
    fail = false;
    onChange();
    await waitFor(() => expect(status.textContent).toBe(''), { timeout: 3000 });
  });
});
