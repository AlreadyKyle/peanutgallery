import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { copy } from './lib/copy';
import type { Snapshot, StudioSource } from './lib/source';
import { SourceProvider } from './lib/studio';

const snapshot: Snapshot = {
  pool: {
    balance_usd: 48.56,
    reserve_usd: 7.1,
    incident_reserve_usd: 2.56,
    daily_spent_usd: 0,
    day: '2026-09-14',
  },
  goals: [],
  totals: { usd_total: 1.25, input_tokens: 12000, cached_tokens: 3000, output_tokens: 800, row_count: 3 },
  events: [],
  deploys: [],
  roles: [],
  cardTitles: {},
};

function renderAt(path: string, source: StudioSource | null = null) {
  return render(
    <SourceProvider source={source}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </SourceProvider>,
  );
}

function nav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Site' });
}

beforeEach(() => {
  vi.stubEnv('VITE_DISCORD_INVITE', '');
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('App routes', () => {
  it('renders the landing page at the root', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: copy.studioName })).toBeTruthy();
  });

  it('renders the ledger page', () => {
    renderAt('/ledger');
    expect(screen.getByRole('heading', { level: 1, name: 'Ledger' })).toBeTruthy();
  });

  it('reports an unknown address with a link back to the studio page', () => {
    renderAt('/no-such-page');
    expect(screen.getByRole('heading', { level: 1, name: copy.notFound })).toBeTruthy();
    expect(screen.getByText(copy.notFoundBody)).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Studio' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('heading', { level: 1, name: copy.studioName })).toBeNull();
  });
});

describe('Site chrome', () => {
  it('shows the wordmark, the Studio and Ledger links, the pitch line and the footer line', () => {
    renderAt('/');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: copy.studioName }).getAttribute('href')).toBe('/');
    expect(within(nav()).getByRole('link', { name: 'Studio' }).getAttribute('href')).toBe('/');
    expect(within(nav()).getByRole('link', { name: 'Ledger' }).getAttribute('href')).toBe('/ledger');
    expect(screen.getByText(copy.pitch)).toBeTruthy();
    expect(within(screen.getByRole('contentinfo')).getByText(copy.footer)).toBeTruthy();
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: copy.createdByName }).getAttribute('href')).toBe(copy.createdByUrl);
  });

  it('shows the pitch line on the landing only', () => {
    renderAt('/ledger');
    expect(screen.queryByText(copy.pitch)).toBeNull();
    cleanup();
    renderAt('/board');
    expect(screen.queryByText(copy.pitch)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Board' })).toBeTruthy();
  });

  it('omits the Contribute and Discord links when the env values are unset', () => {
    renderAt('/');
    expect(screen.queryByRole('link', { name: copy.contribute })).toBeNull();
    expect(screen.queryByRole('link', { name: copy.discord })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Board' })).toBeNull();
  });

  it('links Contribute in the nav and Discord in the nav and footer when the env values are set', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
    vi.stubEnv('VITE_DISCORD_INVITE', 'https://discord.gg/invite-code');
    renderAt('/');
    expect(within(nav()).getByRole('link', { name: copy.contribute }).getAttribute('href')).toBe(
      'https://buy.stripe.com/test-link',
    );
    expect(within(nav()).getByRole('link', { name: copy.discord }).getAttribute('href')).toBe(
      'https://discord.gg/invite-code',
    );
    expect(
      within(screen.getByRole('contentinfo')).getByRole('link', { name: copy.discord }).getAttribute('href'),
    ).toBe('https://discord.gg/invite-code');
    expect(screen.queryByRole('link', { name: 'Board' })).toBeNull();
  });

  it('shows the pool balance in the top bar once figures load and nothing before', async () => {
    renderAt('/', { load: () => Promise.resolve(snapshot), subscribe: () => () => {} });
    expect(screen.queryByText(`${copy.pool} $48.56`)).toBeNull();
    await waitFor(() => expect(screen.getByText(`${copy.pool} $48.56`)).toBeTruthy());
    expect(screen.getByText('$48.56')).toBeTruthy();
  });

  it('loads the snapshot once for the top bar and the page together', async () => {
    let loads = 0;
    renderAt('/', {
      load: () => {
        loads += 1;
        return Promise.resolve(snapshot);
      },
      subscribe: () => () => {},
    });
    await waitFor(() => expect(screen.getByText(`${copy.pool} $48.56`)).toBeTruthy());
    expect(screen.getByText('$48.56')).toBeTruthy();
    expect(loads).toBe(1);
  });

  it('shows no pool status without a database', () => {
    renderAt('/');
    expect(screen.queryByText(new RegExp(`^${copy.pool} `))).toBeNull();
  });
});
