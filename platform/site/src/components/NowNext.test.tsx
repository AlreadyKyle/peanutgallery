import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import type { Card, Snapshot } from '../lib/source';
import type { StudioState } from '../lib/studio';
import { NextList, NowList } from './NowNext';

const STRIPE = 'https://buy.stripe.com/test-link';

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c',
    title: 'A card',
    intent: null,
    source: 'board',
    stage: 'proposed',
    shape: 'goal',
    funding_target_usd: 0,
    funded_usd: 0,
    actual_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

function ready(cards: Card[], funding: Snapshot['funding'] = {}): StudioState {
  return {
    state: 'ready',
    snapshot: {
      pool: null,
      cards,
      funding,
      launchedAt: null,
      totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
      events: [],
      deploys: [],
      roles: [],
      cardTitles: {},
    },
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('NowList and NextList states', () => {
  it('shows the loading line while the studio loads', () => {
    render(
      <>
        <NowList studio={{ state: 'loading' }} />
        <NextList studio={{ state: 'loading' }} />
      </>,
    );
    expect(screen.getAllByText(copy.loadingCards)).toHaveLength(2);
  });

  it('shows the unavailable line without a database', () => {
    render(
      <>
        <NowList studio={{ state: 'unconfigured' }} />
        <NextList studio={{ state: 'unconfigured' }} />
      </>,
    );
    expect(screen.getAllByText(copy.meterUnavailable)).toHaveLength(2);
  });

  it('shows the empty lines when there are no cards', () => {
    const studio = ready([]);
    render(
      <>
        <NowList studio={studio} />
        <NextList studio={studio} />
      </>,
    );
    expect(screen.getByText(copy.nowEmpty)).toBeTruthy();
    expect(screen.getByText(copy.nextEmpty)).toBeTruthy();
  });
});

describe('NowList card', () => {
  it('shows the source tag, the stage word and what the card has spent', () => {
    const studio = ready([
      card({ id: 'a', stage: 'building', source: 'board', actual_usd: 0.42 }),
      card({ id: 'b', stage: 'gated', source: 'agent', actual_usd: 0 }),
    ]);
    render(<NowList studio={studio} />);

    expect(screen.getByText(copy.sources.board)).toBeTruthy();
    expect(screen.getByText(copy.sources.agent)).toBeTruthy();
    expect(screen.getByText(copy.statusBuilding)).toBeTruthy();
    expect(screen.getByText(copy.statusGated)).toBeTruthy();

    const spent = screen.getAllByText(copy.spentSoFar);
    expect(spent.map((p) => p.textContent)).toEqual([
      `$0.42 ${copy.spentSoFar}`,
      `$0.00 ${copy.spentSoFar}`,
    ]);
  });
});

describe('NextList card', () => {
  it('shows the intent, the decided status with an info button, the bar and the contributors line', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const studio = ready(
      [
        card({
          id: 'n1',
          title: 'A second level',
          intent: 'Add a second stage.',
          source: 'community',
          stage: 'voted',
          funding_target_usd: 100,
          funded_usd: 25,
        }),
      ],
      { n1: { contributors: 3, credited_usd: 18.5 } },
    );
    render(<NextList studio={studio} />);

    expect(screen.getByText('Add a second stage.')).toBeTruthy();
    expect(screen.getByText(copy.statusDecided)).toBeTruthy();
    expect(screen.getByRole('button', { name: `${copy.about} ${copy.statusDecided}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `${copy.about} ${copy.fundThis}` })).toBeTruthy();

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('A second level');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText('$25.00 of $100.00')).toBeTruthy();
    expect(screen.getByText(copy.contributorsMany.replace('{n}', '3'))).toBeTruthy();

    const link = screen.getByRole('link', { name: copy.fundThis });
    expect(link.getAttribute('href')).toBe(`${STRIPE}?client_reference_id=n1`);
    const heading = screen.getByRole('heading', { level: 3, name: 'A second level' });
    expect(link.getAttribute('aria-describedby')).toBe(heading.id);
  });

  it('shows the open status word and a single-contributor line', () => {
    const studio = ready(
      [card({ id: 'n2', stage: 'proposed', funding_target_usd: 50, funded_usd: 0 })],
      { n2: { contributors: 1, credited_usd: 5 } },
    );
    render(<NextList studio={studio} />);
    expect(screen.getByText(copy.statusOpen)).toBeTruthy();
    expect(screen.getByRole('button', { name: `${copy.about} ${copy.statusOpen}` })).toBeTruthy();
    expect(screen.getByText(copy.contributorsOne)).toBeTruthy();
  });

  it('omits the fund link when the bar is full', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const studio = ready([
      card({ id: 'full', stage: 'voted', funding_target_usd: 100, funded_usd: 100 }),
    ]);
    render(<NextList studio={studio} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.queryByRole('link', { name: copy.fundThis })).toBeNull();
  });

  it('omits the fund link when the card is not a goal', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const studio = ready([
      card({ id: 'one', shape: 'oneoff', stage: 'proposed', funding_target_usd: 100, funded_usd: 10 }),
    ]);
    render(<NextList studio={studio} />);
    expect(screen.queryByRole('link', { name: copy.fundThis })).toBeNull();
  });

  it('omits the fund link when there is no payment link', () => {
    const studio = ready([
      card({ id: 'n3', stage: 'proposed', funding_target_usd: 100, funded_usd: 10 }),
    ]);
    render(<NextList studio={studio} />);
    expect(screen.queryByRole('link', { name: copy.fundThis })).toBeNull();
  });

  it('omits the bar when the target is zero', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const studio = ready([card({ id: 'z', stage: 'proposed', funding_target_usd: 0, funded_usd: 0 })]);
    render(<NextList studio={studio} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows 0 contributors on a fundable card with no funding row yet', () => {
    const studio = ready([card({ id: 'new', stage: 'proposed', funding_target_usd: 20, funded_usd: 0 })]);
    render(<NextList studio={studio} />);
    expect(screen.getByText(copy.contributorsMany.replace('{n}', '0'))).toBeTruthy();
  });

  it('shows no contributors line on a card with no target', () => {
    const studio = ready(
      [card({ id: 'z', stage: 'proposed', funding_target_usd: 0, funded_usd: 0 })],
      { z: { contributors: 2, credited_usd: 4 } },
    );
    render(<NextList studio={studio} />);
    expect(screen.queryByText(/contributor/)).toBeNull();
  });
});
