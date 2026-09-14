import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { copy } from '../lib/copy';
import { formatDate } from '../lib/format';
import type { Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Landing } from './Landing';

const snapshot: Snapshot = {
  pool: {
    balance_usd: 48.56,
    reserve_usd: 7.1,
    incident_reserve_usd: 2.56,
    daily_spent_usd: 0,
    day: '2026-09-14',
  },
  cards: [
    {
      id: 'now1',
      title: 'The core loop',
      intent: 'Move, jump, land.',
      source: 'board',
      stage: 'building',
      shape: 'goal',
      funding_target_usd: 100,
      funded_usd: 100,
      actual_usd: 3.2,
      created_at: '2026-09-14T00:00:00Z',
    },
    {
      id: 'next1',
      title: 'A second level',
      intent: 'Add a second stage.',
      source: 'community',
      stage: 'voted',
      shape: 'goal',
      funding_target_usd: 100,
      funded_usd: 25,
      actual_usd: 0,
      created_at: '2026-09-14T00:00:01Z',
    },
    {
      id: 'next2',
      title: 'A music track',
      intent: '',
      source: 'agent',
      stage: 'proposed',
      shape: 'goal',
      funding_target_usd: 50,
      funded_usd: 0,
      actual_usd: 0,
      created_at: '2026-09-14T00:00:02Z',
    },
  ],
  funding: { next1: { contributors: 3, credited_usd: 18.5 } },
  launchedAt: null,
  totals: { usd_total: 1.25, input_tokens: 12000, cached_tokens: 3000, output_tokens: 800, row_count: 3 },
  events: [],
  deploys: [],
  roles: [],
  cardTitles: {},
};

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Landing', () => {
  it('renders every required line with a live source', async () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    renderLanding(fakeSource());

    expect(screen.getByRole('heading', { level: 1, name: copy.studioName })).toBeTruthy();
    expect(screen.getByText(copy.pitch)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe(
      'https://buy.stripe.com/test-link',
    );
    expect(screen.getByText(copy.split)).toBeTruthy();
    expect(screen.getByText(copy.preLaunch)).toBeTruthy();

    for (const step of copy.steps) expect(screen.getByText(step)).toBeTruthy();

    expect(screen.getByText(copy.artPolicy)).toBeTruthy();
    expect(screen.getByText(copy.allAges)).toBeTruthy();
    expect(screen.getByText(copy.fixedRulesIntro)).toBeTruthy();
    for (const rule of copy.fixedRules) expect(screen.getByText(rule)).toBeTruthy();

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([copy.howItWorks, copy.meter, copy.ledger, copy.now, copy.next, copy.policies]);
    expect(screen.getByRole('link', { name: copy.fullLedger }).getAttribute('href')).toBe('/ledger');

    await waitFor(() => expect(screen.getByText('$48.56')).toBeTruthy());
    expect(screen.getByText('$7.10')).toBeTruthy();
    expect(screen.getByText('$2.56')).toBeTruthy();
    expect(screen.getByText('$1.25')).toBeTruthy();
    expect(screen.getByText('12,000')).toBeTruthy();
    expect(screen.getByText(copy.ledgerEmpty)).toBeTruthy();

    // Not launched yet, so the pre-launch lines show and no live-since date.
    expect(screen.getByText(copy.notLiveYet)).toBeTruthy();
    expect(screen.getByText(copy.preLaunch)).toBeTruthy();

    // Now shows the building card and what it has spent; Next shows the queued cards.
    expect(screen.getByText('The core loop')).toBeTruthy();
    expect(screen.getByText('$3.20')).toBeTruthy();
    expect(screen.getByText('3 contributors')).toBeTruthy();

    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'A second level',
      'A music track',
    ]);
    expect(bars[0]?.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('$25.00 of $100.00')).toBeTruthy();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['The core loop', 'A second level', 'A music track']);
  });

  it('shows the unavailable line and no figures without a database', () => {
    renderLanding(null);
    expect(screen.getAllByText(copy.meterUnavailable).length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText(copy.nowEmpty)).toBeNull();
    expect(screen.queryByText(copy.nextEmpty)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(copy.contributeUnavailable)).toBeTruthy();
    // Launch state is unknown without a database, so the offer stays.
    expect(screen.getByText(copy.preLaunch)).toBeTruthy();
  });

  it('shows the empty Now and Next lines when the database holds no cards', async () => {
    renderLanding({
      load: () => Promise.resolve({ ...snapshot, cards: [], funding: {} }),
      subscribe: () => () => {},
    });
    await waitFor(() => expect(screen.getByText(copy.nowEmpty)).toBeTruthy());
    expect(screen.getByText(copy.nextEmpty)).toBeTruthy();
    expect(screen.queryByText(copy.meterUnavailable)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
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
    expect(screen.queryByText(copy.preLaunch)).toBeNull();
  });
});
