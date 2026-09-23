import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { formatDate } from '../lib/format';
import type { Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Landing } from './Landing';

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
  ],
  funding: { next1: { contributors: 3, credited_usd: 18.5 }, live1: { contributors: 2, credited_usd: 3 } },
  launchedAt: null,
  paused: false,
  totals: { usd_total: 1.25, input_tokens: 12000, cached_tokens: 3000, output_tokens: 800, row_count: 3 },
  events: [],
  deploys: [],
  roles: [],
  cardTitles: {},
  missing: [],
};

/** A paragraph whose whole text, across its inline elements, is exactly this. */
function paragraph(text: string): HTMLElement {
  return screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
}

function paragraphIn(container: HTMLElement, text: string): HTMLElement {
  return within(container).getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
}

function fakeSource(): StudioSource {
  return {
    load: () => Promise.resolve(snapshot),
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
  it('renders every required line with a live source', async () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    renderLanding(fakeSource());

    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([copy.pitchTitle]);
    expect(screen.getByText(copy.pitchBody)).toBeTruthy();
    // Contribute goes to the chooser first, not straight to checkout.
    expect(screen.getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe('/contribute');
    expect(screen.getByText(legal.split)).toBeTruthy();
    expect(screen.getByText(copy.fundIntro)).toBeTruthy();

    // Three short lines and a link to the whole path on /how-it-works.
    expect(copy.steps).toHaveLength(3);
    for (const step of copy.steps) expect(screen.getByText(step)).toBeTruthy();
    const how = screen.getByRole('region', { name: copy.howItWorks });
    expect(within(how).getByRole('link', { name: copy.howItWorksMore }).getAttribute('href')).toBe('/how-it-works');
    expect(screen.getByText(legal.artPolicy)).toBeTruthy();
    expect(screen.getByText(legal.allAges)).toBeTruthy();
    expect(screen.getByText(legal.fixedRulesIntro)).toBeTruthy();
    for (const rule of legal.fixedRules) expect(screen.getByText(rule)).toBeTruthy();

    await waitFor(() => expect(screen.getAllByText('$48.56')).toHaveLength(2));
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      copy.rightNow,
      copy.now,
      copy.fund,
      copy.queued,
      copy.shipped,
      copy.howItWorks,
      legal.meter,
      legal.ledger,
      copy.policies,
    ]);
    expect(screen.getAllByRole('link', { name: copy.fullLedger }).map((link) => link.getAttribute('href'))).toEqual(['/ledger', '/ledger']);

    // Right now: money available, what is building and what shipped last. The agent work itself is
    // the Ledger section below, so the panel stays about as tall as the pitch beside it.
    const panel = screen.getByRole('complementary', { name: copy.rightNow });
    expect(within(panel).getByText('$48.56')).toBeTruthy();
    expect(paragraphIn(panel, `${copy.buildingLine} The core loop`)).toBeTruthy();
    expect(paragraphIn(panel, `${copy.latestShipped} The unlock list`)).toBeTruthy();
    expect(within(panel).queryByRole('list')).toBeNull();
    expect(screen.queryByText(legal.staleFigures)).toBeNull();
    expect(screen.getByText(legal.ledgerEmpty)).toBeTruthy();

    expect(screen.getByText('$7.10')).toBeTruthy();
    expect(screen.getByText('$2.56')).toBeTruthy();
    expect(screen.getByText('$1.25')).toBeTruthy();
    expect(screen.getByText('12,000 in · 3,000 cached · 800 out tokens')).toBeTruthy();
    expect(screen.getAllByText(legal.describeAvailable)).toHaveLength(2);
    expect(screen.getByText(legal.describeReserve)).toBeTruthy();
    expect(screen.getByText(legal.describeIncidentReserve)).toBeTruthy();
    expect(screen.getByText(legal.held)).toBeTruthy();
    expect(screen.getByText('$61.50')).toBeTruthy();
    expect(screen.getByText(legal.describeHeld)).toBeTruthy();
    expect(screen.getByText(legal.describeAgentSpend)).toBeTruthy();
    expect(screen.queryAllByRole('tooltip')).toHaveLength(0);
    expect(screen.getByText(copy.notLiveYet)).toBeTruthy();

    // Building now shows the card and what it has spent; the fund board lists open cards.
    expect(paragraph(`${copy.sources.board} · $3.20 ${legal.spentSoFar}`)).toBeTruthy();
    expect(screen.getByText('$25.00 of $100.00').tagName).toBe('DD');
    expect(screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'A second level',
      'A music track',
      'A clearer ledger page',
    ]);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      'The core loop',
      'A second level',
      'A music track',
      'A clearer ledger page',
      'The unlock list',
      'Save and resume',
    ]);

    // Queued lists the funded card as a row, not a box.
    const queued = screen.getByRole('region', { name: copy.queued });
    expect(within(queued).getByText('Gatherer costs 11')).toBeTruthy();
    expect(within(queued).queryByRole('progressbar')).toBeNull();

    // Shipped lists the live cards newest first, with no bar and no fund button, and never in the fund board.
    const shipped = screen.getByRole('region', { name: copy.shipped });
    expect(within(shipped).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'The unlock list',
      'Save and resume',
    ]);
    expect(within(shipped).getByText(copy.shippedIntro)).toBeTruthy();
    expect(
      within(shipped).getByText(
        `$1.50 ${legal.spent} · ${legal.contributorsMany.replace('{n}', '2')} · ${legal.shippedOn} ${formatDate('2026-09-15T09:00:00Z')}`,
      ),
    ).toBeTruthy();
    expect(within(shipped).queryByRole('progressbar')).toBeNull();
    expect(within(shipped).queryByRole('link', { name: copy.playTheGame })).toBeNull();

    // Summaries show; the agent briefs sit in closed disclosures.
    expect(screen.getByText('Walk, jump and land in the first level.')).toBeTruthy();
    const briefs = [...document.querySelectorAll('details.brief')] as HTMLDetailsElement[];
    expect(briefs.map((d) => [d.open, d.querySelector('p')?.textContent])).toEqual([
      [false, 'Move, jump, land.'],
      [false, 'Add a second stage.'],
    ]);
  });

  it('links each shipped Dust card to the game when the play URL is set', async () => {
    vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
    renderLanding(fakeSource());
    const shipped = await screen.findByRole('region', { name: copy.shipped });
    expect(within(shipped).getAllByRole('link', { name: copy.playTheGame }).map((a) => a.getAttribute('href'))).toEqual([
      'https://play.example',
      'https://play.example',
    ]);
  });

  it('filters the fund board by category and shows the studio chip only while it has cards', async () => {
    renderLanding(fakeSource());
    await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(3));
    const filters = screen.getByRole('group', { name: copy.filterLabel });
    const pressed = () =>
      within(filters)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent);
    expect(pressed()).toEqual([`${copy.categories.all} 3`]);
    // No card funds a next game, so its chip is hidden rather than showing 0.
    expect(within(filters).getAllByRole('button').map((b) => b.textContent)).toEqual([
      `${copy.categories.all} 3`,
      `${copy.categories.game} 2`,
      `${copy.categories.studio} 1`,
    ]);

    fireEvent.click(within(filters).getByRole('button', { name: `${copy.categories.studio} 1` }));
    expect(screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-label'))).toEqual(['A clearer ledger page']);
    expect(screen.getByText(copy.categoryNotes.studio)).toBeTruthy();

    fireEvent.click(within(filters).getByRole('button', { name: `${copy.categories.game} 2` }));
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('hides the studio chip when no studio card is open, which is the state at launch', async () => {
    renderLanding({
      load: () => Promise.resolve({ ...snapshot, cards: snapshot.cards.filter((card) => card.folder !== 'platform') }),
      subscribe: () => () => {},
    });
    await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(2));
    const filters = screen.getByRole('group', { name: copy.filterLabel });
    expect(within(filters).getAllByRole('button').map((b) => b.textContent)).toEqual([
      `${copy.categories.all} 2`,
      `${copy.categories.game} 2`,
    ]);
  });

  it('never lists a next or later card as open for funding', async () => {
    const planned = [
      { ...snapshot.cards[2]!, id: 'later1', title: 'A planned card', horizon: 'later' as const, funding_target_usd: 0 },
      { ...snapshot.cards[1]!, id: 'next1b', title: 'A ranked card', horizon: 'next' as const, rank: 1 },
    ];
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    renderLanding({ load: () => Promise.resolve({ ...snapshot, cards: [...snapshot.cards, ...planned] }), subscribe: () => () => {} });
    await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(3));
    expect(screen.queryByText('A planned card')).toBeNull();
    expect(screen.queryByText('A ranked card')).toBeNull();
    const fund = screen.getByRole('region', { name: copy.fund });
    expect(within(fund).getAllByText(copy.statusOpen)).toHaveLength(2);
    expect(within(fund).getAllByRole('link', { name: legal.fundThis }).map((a) => a.getAttribute('href'))).not.toContain(
      'https://buy.stripe.com/test-link?client_reference_id=later1',
    );
  });

  it('says the agents are paused in the Right now panel while the board has paused them', async () => {
    renderLanding({
      load: () => Promise.resolve({ ...snapshot, cards: snapshot.cards.filter((card) => card.stage !== 'building'), paused: true }),
      subscribe: () => () => {},
    });
    const panel = screen.getByRole('complementary', { name: copy.rightNow });
    await waitFor(() => expect(within(panel).getByText(legal.pausedNotice)).toBeTruthy());
    expect(within(panel).getByText(copy.nowEmptyPaused)).toBeTruthy();
    expect(within(panel).queryByText(copy.nowEmpty)).toBeNull();
  });

  it('says nothing about a pause when the studio row did not load', async () => {
    renderLanding({
      load: () => Promise.resolve({ ...snapshot, paused: true, missing: ['studio'] }),
      subscribe: () => () => {},
    });
    await waitFor(() => expect(screen.getAllByText('$48.56')).toHaveLength(2));
    expect(screen.queryByText(legal.pausedNotice)).toBeNull();
  });

  it('shows In the pool at $0.00 and states the shortfall when agent work has cost more than came in', async () => {
    renderLanding({
      load: () => Promise.resolve({ ...snapshot, pool: { ...snapshot.pool!, balance_usd: -1.234 } }),
      subscribe: () => () => {},
    });
    const panel = screen.getByRole('complementary', { name: copy.rightNow });
    await waitFor(() => expect(within(panel).getByText('$0.00')).toBeTruthy());
    expect(within(panel).getByText(legal.poolBalance)).toBeTruthy();
    expect(within(panel).getByText(`${legal.describeAvailable} ${legal.shortfall.replace('{amount}', '$1.23')}`)).toBeTruthy();
    expect(screen.queryByText(/-\$/)).toBeNull();
  });

  it('shows the unavailable line and no figures without a database', () => {
    renderLanding(null);
    expect(screen.getAllByText(legal.meterUnavailable).length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: copy.now })).toBeNull();
    expect(screen.getByText(legal.contributeUnavailable)).toBeTruthy();
    expect(screen.queryByText(copy.notLiveYet)).toBeNull();
  });

  it('says nothing is building and nothing needs funding when the database holds no cards', async () => {
    renderLanding({
      load: () => Promise.resolve({ ...snapshot, cards: [], funding: {} }),
      subscribe: () => () => {},
    });
    await waitFor(() => expect(screen.getByText(copy.nowEmpty)).toBeTruthy());
    expect(screen.getByText(copy.fundEmpty)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: copy.now })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: copy.queued })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: copy.shipped })).toBeNull();
    expect(screen.queryByText(copy.latestShipped)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
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
    const panel = screen.getByRole('complementary', { name: copy.rightNow });
    // The live region is in place, empty, before any figure loads, so its text arriving is announced.
    const status = within(panel).getByRole('status');
    expect(status.textContent).toBe('');
    await waitFor(() => expect(within(panel).getByText('$48.56')).toBeTruthy());
    expect(within(panel).getByRole('status')).toBe(status);
    expect(status.textContent).toBe('');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    const funding = screen.getByRole('region', { name: legal.meter });
    expect(within(funding).queryByText(legal.staleFigures)).toBeNull();

    fail = true;
    onChange();
    await waitFor(() => expect(status.textContent).toBe(legal.staleFigures), { timeout: 3000 });
    expect(within(panel).getByRole('status')).toBe(status);
    expect(status.className).toBe('muted small status');
    expect(within(panel).getByText('$48.56')).toBeTruthy();
    // The meter repeats the line beside the money, without a second live region.
    expect(within(funding).getByText(legal.staleFigures)).toBeTruthy();
    expect(within(funding).getByText('$7.10')).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(1);

    fail = false;
    onChange();
    await waitFor(() => expect(status.textContent).toBe(''), { timeout: 3000 });
    expect(within(funding).queryByText(legal.staleFigures)).toBeNull();
  });

  it('says nothing about launch when the studio row did not load', async () => {
    renderLanding({
      load: () => Promise.resolve({ ...snapshot, launchedAt: null, missing: ['studio'] }),
      subscribe: () => () => {},
    });
    await waitFor(() => expect(screen.getAllByText('$48.56')).toHaveLength(2));
    expect(screen.queryByText(copy.notLiveYet)).toBeNull();
    expect(screen.queryByText(new RegExp(copy.liveSince))).toBeNull();
  });

  it('shows the live-since date once the studio has launched', async () => {
    renderLanding({
      load: () => Promise.resolve({ ...snapshot, launchedAt: '2026-09-20T00:00:00Z' }),
      subscribe: () => () => {},
    });
    await waitFor(() =>
      expect(screen.getByText(`${copy.liveSince} ${formatDate('2026-09-20T00:00:00Z')}`)).toBeTruthy(),
    );
    expect(screen.queryByText(copy.notLiveYet)).toBeNull();
  });
});
