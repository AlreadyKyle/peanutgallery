import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import type { Card, Snapshot } from '../lib/source';
import type { StudioState } from '../lib/studio';
import { BuildingNow, FundBoard, QueuedList } from './Cards';

const STRIPE = 'https://buy.stripe.com/test-link';

function card(overrides: Partial<Card> = {}): Card {
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
    ...overrides,
  };
}

function snapshot(cards: Card[], funding: Snapshot['funding'] = {}): Snapshot {
  return {
    pool: null,
    cards,
    funding,
    launchedAt: null,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
  };
}

function ready(cards: Card[], funding: Snapshot['funding'] = {}): StudioState {
  return { state: 'ready', snapshot: snapshot(cards, funding) };
}

/** A paragraph whose whole text, across its inline elements, is exactly this. */
function paragraph(text: string): HTMLElement {
  return screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
}

function boxFor(title: string): HTMLElement {
  return screen.getByRole('heading', { level: 3, name: title }).closest('li')!;
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('FundBoard states', () => {
  it('shows the loading line and the unavailable line', () => {
    render(<FundBoard studio={{ state: 'loading' }} />);
    expect(screen.getByText(copy.loadingCards)).toBeTruthy();
    cleanup();
    render(<FundBoard studio={{ state: 'unconfigured' }} />);
    expect(screen.getByText(copy.meterUnavailable)).toBeTruthy();
  });

  it('shows the empty line when nothing needs funding', () => {
    render(<FundBoard studio={ready([card({ stage: 'building' }), card({ id: 'q', stage: 'funded' })])} />);
    expect(screen.getByText(copy.fundEmpty)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('a card box', () => {
  it('shows category, status badge, title, summary, bar caption, a fund button and a closed brief', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    const intent = 'Edit seed-1/config/unlocks.json. Run the bot; stop and report.';
    render(
      <FundBoard
        studio={ready(
          [
            card({
              id: 'n1',
              title: 'A fourteenth unlock',
              summary: 'Add one more unlock.',
              intent,
              stage: 'voted',
              funding_target_usd: 100,
              funded_usd: 25,
              source: 'community',
            }),
          ],
          { n1: { contributors: 3, credited_usd: 18.5 } },
        )}
      />,
    );
    const box = boxFor('A fourteenth unlock');
    expect(within(box).getByText(copy.categories.game)).toBeTruthy();
    expect(within(box).getByText(copy.statusPicked).classList.contains('badge')).toBe(true);
    expect(within(box).getByText('Add one more unlock.').classList.contains('card-summary')).toBe(true);

    const bar = within(box).getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBe('A fourteenth unlock');
    expect([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-valuenow')]).toEqual(['0', '100', '25']);
    expect(paragraph(`$25.00 of $100.00 · ${copy.contributorsMany.replace('{n}', '3')}`)).toBeTruthy();

    const link = within(box).getByRole('link', { name: copy.fundThis });
    expect(link.getAttribute('href')).toBe(`${STRIPE}?client_reference_id=n1`);
    expect(link.classList.contains('button')).toBe(true);
    expect(link.getAttribute('aria-describedby')).toBe(screen.getByRole('heading', { level: 3 }).id);

    const details = box.querySelector('details.brief') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe(copy.agentBrief);
    expect(link.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(details.querySelector('summary')!);
    expect(details.open).toBe(true);
    expect(within(details).getByText(intent)).toBeTruthy();
  });

  it('shows an open card without a badge and a single contributor', () => {
    render(<FundBoard studio={ready([card({ id: 'n2', funding_target_usd: 50 })], { n2: { contributors: 1, credited_usd: 5 } })} />);
    expect(screen.getByText(copy.statusOpen).classList.contains('badge')).toBe(false);
    expect(paragraph(`$0.00 of $50.00 · ${copy.contributorsOne}`)).toBeTruthy();
  });

  it('shows 0 contributors on a goal with no funding row, and no summary or brief when blank', () => {
    render(<FundBoard studio={ready([card({ id: 'new', title: 'New', summary: '  ', intent: null, funding_target_usd: 20 })])} />);
    expect(paragraph(`$0.00 of $20.00 · ${copy.contributorsMany.replace('{n}', '0')}`)).toBeTruthy();
    expect(document.querySelectorAll('p.card-summary')).toHaveLength(0);
    expect(boxFor('New').querySelector('details.brief')).toBeNull();
  });

  it('omits the fund button for a full bar, a non-goal card and a missing payment link, and the bar at a zero target', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
    render(
      <FundBoard
        studio={ready([
          card({ id: 'full', title: 'Full', stage: 'voted', funding_target_usd: 100, funded_usd: 100 }),
          card({ id: 'one', title: 'Oneoff', shape: 'oneoff', funding_target_usd: 100, funded_usd: 10 }),
          card({ id: 'zero', title: 'Zero', funding_target_usd: 0 }),
        ])}
      />,
    );
    expect(screen.queryByRole('link', { name: copy.fundThis })).toBeNull();
    expect(within(boxFor('Zero')).queryByRole('progressbar')).toBeNull();
    cleanup();
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
    render(<FundBoard studio={ready([card({ id: 'n3', funding_target_usd: 100, funded_usd: 10 })])} />);
    expect(screen.queryByRole('link', { name: copy.fundThis })).toBeNull();
  });
});

describe('BuildingNow and QueuedList', () => {
  it('shows building cards with what they have spent, and nothing when none are building', () => {
    render(
      <BuildingNow
        snapshot={snapshot([
          card({ id: 'a', title: 'Building one', stage: 'building', actual_usd: 0.42 }),
          card({ id: 'b', title: 'Gated one', stage: 'gated', source: 'agent' }),
        ])}
      />,
    );
    expect(paragraph(`$0.42 ${copy.spentSoFar} · ${copy.sources.board}`)).toBeTruthy();
    expect(within(boxFor('Gated one')).getByText(copy.statusGated)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    cleanup();
    const { container } = render(<BuildingNow snapshot={snapshot([card()])} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists funded cards as rows, and nothing when none are queued', () => {
    render(<QueuedList snapshot={snapshot([card({ id: 'q', title: 'Queued one', stage: 'funded', folder: 'platform' })])} />);
    const row = screen.getByText('Queued one').closest('li')!;
    expect(row.textContent).toBe(`Queued one${copy.categories.studio} · ${copy.sources.board}`);
    cleanup();
    const { container } = render(<QueuedList snapshot={snapshot([card()])} />);
    expect(container.innerHTML).toBe('');
  });
});
