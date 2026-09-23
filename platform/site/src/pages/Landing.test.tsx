import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { formatDate } from '../lib/format';
import { DEFAULT_STUDIO_PCT, RESERVE_PCT } from '../lib/payment';
import { books } from '../lib/books.test-fixture';
import type { Role, Snapshot, StudioSource } from '../lib/source';
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
  };
}

function fakeSource(over: Partial<Snapshot> = {}): StudioSource {
  return {
    load: () => Promise.resolve({ ...snapshot, ...over }),
    subscribe: () => () => {},
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

/** The status line's text, once the snapshot has loaded. */
async function statusLine(): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 2, name: copy.now });
  return document.querySelector('p.status-line') as HTMLElement;
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
  it("is drawn in the board's order, on bands, with every section from the snapshot", async () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
    const { container } = renderLanding(fakeSource());

    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([copy.pitchTitle]);
    expect(screen.getByText(copy.pitchBody)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.playDust }).getAttribute('href')).toBe('https://play.example');
    expect(screen.getByRole('link', { name: copy.howItWorks }).getAttribute('href')).toBe('/how-it-works');

    await screen.findByRole('heading', { level: 2, name: copy.now });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      copy.now,
      copy.fund,
      copy.queued,
      copy.team.title,
      copy.shipped,
      copy.plannedNext,
      legal.moneyHeading,
    ]);
    // Five bands: the pitch, the cards, the team, the roadmap and the money. Every card is in band 2.
    const bands = [...container.querySelectorAll('main > *')];
    expect(bands.map((band) => band.className)).toEqual(['band', 'band', 'band', 'band', 'band']);
    for (const card of container.querySelectorAll('li.card, .funding-bar')) expect(card.closest('main > .band')).toBe(bands[1]);
    // No Right now panel, no How it works steps, no fixed rules on home any more.
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText(legal.fixedRulesIntro)).toBeNull();
    // No card page yet, so nothing links to one.
    expect(container.querySelector('a[href^="/card/"]')).toBeNull();
  });

  it('says in one status line how many cards are open and building, with the figures at 600', async () => {
    renderLanding(fakeSource());
    const line = await statusLine();
    expect(line.textContent).toBe('3 cards are open for funding. 1 card is being built.');
    expect([...line.querySelectorAll('strong')].map((strong) => strong.textContent)).toEqual(['3 cards', '1 card']);
    expect(line.querySelector('svg[data-glyph="pause"]')).toBeNull();
  });

  it('says the agents are paused only in the status line, with the pause glyph, while the board has paused them', async () => {
    renderLanding(fakeSource({ paused: true, cards: snapshot.cards.filter((card) => card.stage !== 'building') }));
    await screen.findByRole('heading', { level: 2, name: copy.fund });
    const line = document.querySelector('p.status-line')!;
    // No reason read: the general line, the same sentence as the paused notice on other pages.
    await waitFor(() => expect(line.textContent).toBe(`3 cards are open for funding. ${legal.pausedNotice}`));
    expect(line.querySelector('svg[data-glyph="pause"]')).not.toBeNull();
    expect(document.querySelector('p.notice')).toBeNull();
    // The team strip draws the agents asleep.
    expect(document.querySelectorAll('.team-strip svg.avatar').length).toBe(3);
  });

  for (const reason of ['awaiting_credit', 'spend_limit', 'incident', 'board']) {
    it(`says why the agents are paused in the status line: ${reason}`, async () => {
      renderLanding(fakeSource({ paused: true, pauseReason: reason, cards: snapshot.cards.filter((card) => card.stage !== 'building') }));
      await screen.findByRole('heading', { level: 2, name: copy.fund });
      const line = document.querySelector('p.status-line')!;
      await waitFor(() => expect(line.textContent).toBe(`3 cards are open for funding. ${legal.pauseReasons[reason]}`));
      expect(line.querySelector('svg[data-glyph="pause"]')).not.toBeNull();
    });
  }

  it('says nothing about a pause when the studio row did not load', async () => {
    renderLanding(fakeSource({ paused: true, pauseReason: 'incident', missing: ['studio'] }));
    const line = await statusLine();
    expect(line.textContent).toBe('3 cards are open for funding. 1 card is being built.');
    expect(line.querySelector('svg[data-glyph="pause"]')).toBeNull();
  });

  it('shows the loading line while the snapshot loads, and the unavailable line without a database', () => {
    renderLanding({ load: () => new Promise(() => {}), subscribe: () => () => {} });
    const loading = document.querySelector('p.status-line')!;
    expect(loading.textContent).toBe(legal.loadingFigures);
    expect(loading.getAttribute('aria-busy')).toBe('true');
    cleanup();
    renderLanding(null);
    expect(document.querySelector('p.status-line')?.textContent).toBe(legal.meterUnavailable);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: copy.now })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: copy.team.title })).toBeNull();
  });

  it('lists open cards in funding order with fund links, the queue as rows, and building cards above them', async () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    renderLanding(fakeSource());
    await screen.findByRole('heading', { level: 2, name: copy.now });
    const fund = screen.getByRole('region', { name: copy.fund });
    expect(within(fund).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'A second level',
      'A music track',
      'A clearer ledger page',
    ]);
    expect(within(fund).getAllByRole('link', { name: legal.fundThis }).map((a) => a.getAttribute('href'))).toEqual([
      'https://buy.stripe.com/test-link?client_reference_id=next1',
      'https://buy.stripe.com/test-link?client_reference_id=next2',
      'https://buy.stripe.com/test-link?client_reference_id=studio1',
    ]);
    const now = screen.getByRole('region', { name: copy.now });
    expect(within(now).getByText(`${copy.sources.board} · $3.20 ${legal.spentSoFar}`)).toBeTruthy();
    const queued = screen.getByRole('region', { name: copy.queued });
    expect(within(queued).getByText('Gatherer costs 11')).toBeTruthy();
    expect(within(queued).queryByRole('progressbar')).toBeNull();
    // Summaries show; the agent briefs sit in closed disclosures.
    const briefs = [...document.querySelectorAll('details.brief')] as HTMLDetailsElement[];
    expect(briefs.map((d) => [d.open, d.querySelector('p')?.textContent])).toEqual([
      [false, 'Move, jump, land.'],
      [false, 'Add a second stage.'],
    ]);
  });

  it('filters the fund board by category and shows the studio chip only while it has cards', async () => {
    renderLanding(fakeSource());
    await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(3));
    const filters = screen.getByRole('group', { name: copy.filterLabel });
    expect(within(filters).getAllByRole('button').map((b) => b.textContent)).toEqual([
      `${copy.categories.all} 3`,
      `${copy.categories.game} 2`,
      `${copy.categories.studio} 1`,
    ]);
    fireEvent.click(within(filters).getByRole('button', { name: `${copy.categories.studio} 1` }));
    expect(screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-label'))).toEqual(['A clearer ledger page']);
    expect(screen.getByText(copy.categoryNotes.studio)).toBeTruthy();
    cleanup();
    renderLanding(fakeSource({ cards: snapshot.cards.filter((card) => card.folder !== 'platform') }));
    await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(2));
    expect(within(screen.getByRole('group', { name: copy.filterLabel })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      `${copy.categories.all} 2`,
      `${copy.categories.game} 2`,
    ]);
  });

  it('shows three cards on a phone, and Show all n cards reveals the rest and focuses the fourth title', async () => {
    const open = Array.from({ length: 5 }, (_, i) => ({ ...snapshot.cards[2]!, id: `o${i}`, title: `Open card ${i + 1}` }));
    renderLanding(fakeSource({ cards: open }));
    const show = await screen.findByRole('button', { name: copy.showAllCards.replace('{n}', '5') });
    expect(document.querySelector('.fund-grid')?.hasAttribute('data-all')).toBe(false);
    fireEvent.click(show);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Open card 4'));
    expect(document.querySelector('.fund-grid')?.getAttribute('data-all')).toBe('true');
    expect(screen.queryByRole('button', { name: copy.showAllCards.replace('{n}', '5') })).toBeNull();
  });

  it('never lists a next or later card as open for funding', async () => {
    const planned = [
      { ...snapshot.cards[2]!, id: 'later1', title: 'A planned card', horizon: 'later' as const, funding_target_usd: 0 },
      { ...snapshot.cards[1]!, id: 'next1b', title: 'A ranked card', horizon: 'next' as const, rank: 1 },
    ];
    renderLanding(fakeSource({ cards: [...snapshot.cards, ...planned] }));
    await screen.findByRole('heading', { level: 2, name: copy.now });
    const fund = screen.getByRole('region', { name: copy.fund });
    expect(within(fund).queryByText('A planned card')).toBeNull();
    expect(within(fund).queryByText('A ranked card')).toBeNull();
    // They are the roadmap: Planned next lists them, ranked first.
    const next = screen.getByRole('region', { name: copy.plannedNext });
    expect(within(next).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['A ranked card', 'A third level', 'A planned card']);
  });

  it('draws the first three running roles as a team strip linking to /team, and no team band without roles', async () => {
    renderLanding(fakeSource());
    const team = await screen.findByRole('region', { name: copy.team.title });
    expect(
      within(team)
        .getAllByRole('link')
        .map((a) => [a.querySelector('.member-name')?.textContent, a.querySelector('.member-job')?.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Builder A', 'Builds funded game cards.', '/team#agent-r-a'],
      ['Builder B', 'Builds funded game cards, too.', '/team#agent-r-b'],
      ['QA', 'Finds problems in Dust.', '/team#agent-r-q'],
    ]);
    cleanup();
    const { container } = renderLanding(fakeSource({ roles: [] }));
    await screen.findByRole('heading', { level: 2, name: copy.shipped });
    expect(screen.queryByRole('region', { name: copy.team.title })).toBeNull();
    expect(container.querySelectorAll('main > .band')).toHaveLength(4);
  });

  it('lists the latest three shipped cards as rows, newest first, with cost and who funded them', async () => {
    const more = [3, 4].map((n) => ({ ...snapshot.cards[6]!, id: `live${n}`, title: `Older ship ${n}`, updated_at: `2026-09-1${n - 2}T00:00:00Z` }));
    renderLanding(fakeSource({ cards: [...snapshot.cards, ...more] }));
    const shipped = await screen.findByRole('region', { name: copy.shipped });
    expect(within(shipped).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['The unlock list', 'Save and resume', 'Older ship 4']);
    const rows = within(shipped).getAllByRole('listitem');
    expect(rows[1]!.querySelector('.row-time')?.textContent).toBe(formatDate('2026-09-15T09:00:00Z'));
    expect(within(rows[1]!).getByText(`$1.50 ${legal.spent} · ${legal.contributorsMany.replace('{n}', '2')}`)).toBeTruthy();
    expect(within(shipped).queryByRole('progressbar')).toBeNull();
    expect(within(shipped).getByRole('link', { name: copy.roadmapLink }).getAttribute('href')).toBe('/roadmap');
  });

  it('says where the money goes: the pool with the coin, the split from the fixed constants, and the five latest actions', async () => {
    renderLanding(fakeSource());
    const money = await screen.findByRole('region', { name: legal.moneyHeading });
    await waitFor(() => expect(within(money).getByText('$48.56')).toBeTruthy());
    expect(money.querySelector('.pool-line svg.coin')).not.toBeNull();
    expect(within(money).getByText(legal.describeAvailable)).toBeTruthy();
    const split = money.querySelector('p.money-split')!.textContent!;
    expect(split).toContain(`${RESERVE_PCT}% of every contribution`);
    expect(split).toContain(`${100 - DEFAULT_STUDIO_PCT}% goes to the agents and ${DEFAULT_STUDIO_PCT}% to the studio`);
    expect(split.endsWith(legal.notDonations)).toBe(true);
    expect(within(money).getByRole('heading', { level: 3, name: legal.latestActions })).toBeTruthy();
    expect(within(money).getAllByRole('listitem')).toHaveLength(HOME_ACTIONS);
    expect(within(money).getByRole('link', { name: copy.fullLedger }).getAttribute('href')).toBe('/ledger');
  });

  it('shows In the pool at $0.00 and states the shortfall when agent work has cost more than came in', async () => {
    renderLanding(fakeSource({ pool: { ...snapshot.pool!, balance_usd: -1.234 } }));
    const money = await screen.findByRole('region', { name: legal.moneyHeading });
    await waitFor(() => expect(within(money).getByText('$0.00')).toBeTruthy());
    expect(within(money).getByText(`${legal.describeAvailable} ${legal.shortfall.replace('{amount}', '$1.23')}`)).toBeTruthy();
    expect(screen.queryByText(/-\$/)).toBeNull();
  });

  it('says nothing needs funding and draws no roadmap band when the database holds no cards', async () => {
    const { container } = renderLanding(fakeSource({ cards: [], funding: {} }));
    await waitFor(() => expect(screen.getByText(copy.fundEmpty)).toBeTruthy());
    expect(screen.queryByRole('heading', { level: 2, name: copy.now })).toBeNull();
    expect(screen.getByText(copy.queuedEmpty)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: copy.shipped })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(container.querySelectorAll('main > .band')).toHaveLength(4);
  });

  it('keeps the figures and says they may be out of date when a refresh fails, until one succeeds', async () => {
    let onChange = () => {};
    let fail = false;
    renderLanding({
      load: () => (fail ? Promise.reject(new Error('network down')) : Promise.resolve(snapshot)),
      subscribe: (callback) => {
        onChange = callback;
        return () => {};
      },
    });
    // The live region is in place, empty, before any figure loads, so its text arriving is announced.
    const status = document.querySelector('.hero p.status[role="status"]')!;
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
