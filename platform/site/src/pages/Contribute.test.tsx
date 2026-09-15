import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import type { Card, Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { Contribute } from './Contribute';

const STRIPE = 'https://buy.stripe.com/test-link';

function card(overrides: Partial<Card>): Card {
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
    funding_target_usd: 10,
    funded_usd: 0,
    actual_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

function source(cards: Card[]): StudioSource {
  const snapshot: Snapshot = {
    pool: null,
    cards,
    funding: {},
    launchedAt: null,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
  };
  return { load: () => Promise.resolve(snapshot), subscribe: () => () => {} };
}

function renderContribute(src: StudioSource | null) {
  return render(
    <SourceProvider source={src}>
      <MemoryRouter>
        <Contribute />
      </MemoryRouter>
    </SourceProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Contribute', () => {
  it('puts Pick for me first, then the fundable cards grouped by category, each linking to checkout', async () => {
    renderContribute(
      source([
        card({ id: 'g1', title: 'Rename the Gatherer', summary: 'A new name.', stage: 'voted' }),
        card({ id: 's1', title: 'A clearer ledger', folder: 'platform', bucket: 'platform' }),
        card({ id: 'full', title: 'Already full', funding_target_usd: 5, funded_usd: 5 }),
        card({ id: 'b1', title: 'Being built', stage: 'building' }),
        card({ id: 'l1', title: 'Already live', stage: 'live', funding_target_usd: 10, funded_usd: 4 }),
      ]),
    );
    expect(screen.getByRole('heading', { level: 1, name: copy.contributeTitle })).toBeTruthy();
    const links = () => screen.getAllByRole('link');
    expect(links()[0]?.textContent).toBe(`${copy.pickForMe}${copy.pickForMeBody}`);
    expect(links()[0]?.getAttribute('href')).toBe(STRIPE);

    await waitFor(() => expect(screen.getByText('Rename the Gatherer')).toBeTruthy());
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([copy.categories.game, copy.categories.studio]);
    const game = screen.getByRole('region', { name: copy.categories.game });
    expect(within(game).getByRole('link').getAttribute('href')).toBe(`${STRIPE}?client_reference_id=g1`);
    expect(within(game).getByText('A new name.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: copy.categories.studio })).getByRole('link').getAttribute('href')).toBe(
      `${STRIPE}?client_reference_id=s1`,
    );
    expect(screen.queryByText('Already full')).toBeNull();
    expect(screen.queryByText('Being built')).toBeNull();
    expect(screen.queryByText('Already live')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('keeps Pick for me when no card needs funding, and says so', async () => {
    renderContribute(source([]));
    await waitFor(() => expect(screen.getByText(copy.noFundableCards)).toBeTruthy());
    expect(screen.getByRole('link', { name: new RegExp(copy.pickForMe) }).getAttribute('href')).toBe(STRIPE);
  });

  it('says contributions are not open without a payment link', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
    renderContribute(null);
    expect(screen.getByText(copy.contributeUnavailable)).toBeTruthy();
    expect(screen.queryByRole('link', { name: new RegExp(copy.pickForMe) })).toBeNull();
  });
});
