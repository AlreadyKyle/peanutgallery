import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { copy } from '../lib/copy';
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
  goals: [
    {
      id: 'c1',
      title: 'Week 1: the loop',
      stage: 'voted',
      funding_target_usd: 100,
      funded_usd: 25,
      created_at: '2026-09-14T00:00:00Z',
    },
    {
      id: 'c2',
      title: 'Week 2: the show',
      stage: 'voted',
      funding_target_usd: 150,
      funded_usd: 0,
      created_at: '2026-09-14T00:00:01Z',
    },
    {
      id: 'c3',
      title: 'Week 3: money and public',
      stage: 'voted',
      funding_target_usd: 250,
      funded_usd: 0,
      created_at: '2026-09-14T00:00:02Z',
    },
  ],
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
  vi.stubEnv('VITE_LAUNCH_AT', '');
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
    expect(screen.getByText(copy.launchDefault)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe(
      'https://buy.stripe.com/test-link',
    );
    expect(screen.getByText(copy.split)).toBeTruthy();
    expect(screen.getByText(copy.poolTotal)).toBeTruthy();
    expect(screen.getByText(copy.preLaunch)).toBeTruthy();
    expect(screen.getByText(copy.artPolicy)).toBeTruthy();
    expect(screen.getByText(copy.allAges)).toBeTruthy();
    expect(screen.getByText(copy.kernel)).toBeTruthy();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([copy.meter, copy.ledger, copy.build, copy.policies]);
    expect(screen.getByRole('link', { name: copy.fullLedger }).getAttribute('href')).toBe('/ledger');

    await waitFor(() => expect(screen.getByText('$48.56')).toBeTruthy());
    expect(screen.getByText('$7.10')).toBeTruthy();
    expect(screen.getByText('$2.56')).toBeTruthy();
    expect(screen.getByText('$1.25')).toBeTruthy();
    expect(screen.getByText('12,000')).toBeTruthy();
    expect(screen.getByText(copy.ledgerEmpty)).toBeTruthy();

    const bars = screen.getAllByRole('progressbar');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'Week 1: the loop',
      'Week 2: the show',
      'Week 3: money and public',
    ]);
    expect(bars[0]?.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('$25.00 of $100.00')).toBeTruthy();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Week 1: the loop', 'Week 2: the show', 'Week 3: money and public']);
  });

  it('shows the unavailable line and no figures without a database', () => {
    renderLanding(null);
    expect(screen.getAllByText(copy.meterUnavailable).length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText(copy.goalsEmpty)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(copy.contributeUnavailable)).toBeTruthy();
  });

  it('shows the seeding line when the database holds no goal cards', async () => {
    renderLanding({ load: () => Promise.resolve({ ...snapshot, goals: [] }), subscribe: () => () => {} });
    await waitFor(() => expect(screen.getByText(copy.goalsEmpty)).toBeTruthy());
    expect(screen.queryByText(copy.meterUnavailable)).toBeNull();
  });

  it('shows the launch date when set', () => {
    vi.stubEnv('VITE_LAUNCH_AT', '2026-10-05T14:00:00Z');
    renderLanding(fakeSource());
    expect(screen.getByText('Launch: Monday 5 October 2026, 10:00 ET')).toBeTruthy();
  });
});
