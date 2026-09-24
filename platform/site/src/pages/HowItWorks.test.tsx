import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import type { Card, Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { exampleSplit } from '../lib/payment';
import { HowItWorks } from './HowItWorks';

const STRIPE = 'https://buy.stripe.com/test-link';
const page = copy.howItWorksPage;
const money = legal.howMoneyMoves;

function card(overrides: Partial<Card>): Card {
  return {
    id: 'c',
    title: 'A card',
    summary: null,
    intent: 'Edit the config.',
    source: 'board',
    stage: 'proposed',
    shape: 'goal',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: 3,
    funded_usd: 1,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    pool: null,
    cards: [],
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    missing: [],
    ...overrides,
  };
}

function renderPage(source: StudioSource | null) {
  return render(
    <SourceProvider source={source}>
      <MemoryRouter>
        <HowItWorks />
      </MemoryRouter>
    </SourceProvider>,
  );
}

function sourceOf(value: Snapshot): StudioSource {
  return { load: () => Promise.resolve(value) };
}

function figures(): HTMLElement[] {
  return [...document.querySelectorAll('figure.example')] as HTMLElement[];
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
  vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('How it works', () => {
  it('shows six steps, each beside a labelled example, then where the money goes, holds and refunds, and the rules', () => {
    renderPage(null);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([page.title]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      ...money.blocks.map((block) => block.heading),
      ...money.sections.map((section) => section.heading),
      page.rulesHeading,
    ]);
    expect(figures()).toHaveLength(6);
    for (const figure of figures()) expect(figure.querySelector('figcaption')?.textContent).toMatch(/^Example/);
    for (const rule of legal.fixedRules) expect(screen.getByText(rule)).toBeTruthy();
    expect(screen.getByText(legal.artPolicy)).toBeTruthy();
    // Holds and refunds links to the Refunds page.
    expect(screen.getByRole('link', { name: legal.refundsPageLink }).getAttribute('href')).toBe('/refunds');
  });

  it('never renders a Payment Link, a fund button or a Play link, even with real open cards and the link set', async () => {
    const open = card({ id: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', title: 'Real open card', funding_target_usd: 5, funded_usd: 2 });
    const live = card({ id: 'l1', title: 'Real shipped card', stage: 'live', live_at: '2026-09-15T00:00:00Z' });
    const { container } = renderPage(sourceOf(snapshot({ cards: [open, live] })));
    await waitFor(() => expect(screen.getByText('Real open card')).toBeTruthy());
    expect(container.innerHTML).not.toContain(STRIPE);
    expect(container.innerHTML).not.toContain('buy.stripe.com');
    expect(container.innerHTML).not.toContain('client_reference_id');
    expect(screen.queryByText(legal.fundThis)).toBeNull();
    expect(screen.queryByText(copy.playTheGame)).toBeNull();
    expect(container.querySelectorAll('figure.example a, figure.example button, figure.example details')).toHaveLength(0);
  });

  it('uses real public records where they exist and labels them, and made-up figures where none does', async () => {
    const open = card({ id: 'o1', title: 'Real open card' });
    const live = card({ id: 'l1', title: 'Real shipped card', stage: 'live', live_at: '2026-09-15T00:00:00Z' });
    renderPage(
      sourceOf(
        snapshot({
          cards: [open, live],
          events: [{ id: 'e1', card_id: 'o1', role_id: null, type: 'start', created_at: '2026-09-15T00:00:00Z' }],
          cardTitles: { o1: 'Real open card' },
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('Real shipped card')).toBeTruthy());
    const labels = figures().map((figure) => figure.querySelector('figcaption')?.firstChild?.textContent);
    expect(labels).toEqual([
      page.exampleReal, // the real open card
      page.exampleMadeUp, // the split is worked arithmetic
      page.exampleMadeUp, // no card is queued
      page.exampleReal, // the real agent action
      page.exampleMadeUp, // no deploy yet
      page.exampleReal, // the real shipped card
    ]);
  });

  it('draws the made-up visuals from the example card when the studio has no data', () => {
    renderPage(null);
    expect(screen.getAllByRole('heading', { level: 3, name: page.exampleCard.title }).length).toBeGreaterThan(0);
    expect(figures().every((figure) => figure.querySelector('figcaption')?.textContent?.startsWith('Example'))).toBe(true);
  });

  it('works the split exactly as apply_contribution does, and the notes match the figures', () => {
    expect(exampleSplit(10)).toEqual({ reserve: 1, studio: 1.8, agents: 7.2, incident: 0.36, credit: 6.84 });
    renderPage(null);
    const split = figures()[1]!;
    expect(within(split).getByText(money.splitCaption)).toBeTruthy();
    for (const amount of ['$1.00', '$1.80', '$0.36', '$6.84']) expect(within(split).getByText(amount)).toBeTruthy();
    expect(money.splitRows.studioNote).toContain('$9.00');
    expect(money.splitRows.incidentNote).toContain('$7.20');
  });

  it('shows the paused notice while the board has paused the agents', async () => {
    renderPage(sourceOf(snapshot({ paused: true })));
    await waitFor(() => expect(screen.getByText(legal.pausedNotice)).toBeTruthy());
  });
});
