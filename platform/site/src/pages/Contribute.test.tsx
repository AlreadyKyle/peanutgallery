import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { legal } from '../lib/legal';
import { books } from '../lib/books.test-fixture';
import { canFund } from '../lib/payment';
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
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: 10,
    funded_usd: 0,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

/**
 * A studio whose funding order (public_money.funding_order) is `order`: by default every card a goal
 * bar still has room on, in the given order, standing in for the waterfall. `over` replaces any part.
 */
function source(cards: Card[], paused = false, order: string[] = cards.filter(canFund).filter((c) => c.horizon === 'now' && c.stage !== 'building' && c.stage !== 'live').map((c) => c.id), over: Partial<Snapshot> = {}): StudioSource {
  const snapshot: Snapshot = {
    pool: null,
    cards,
    funding: {},
    launchedAt: null,
    paused,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    money: books(order),
    missing: [],
    ...over,
  };
  return { load: () => Promise.resolve(snapshot), subscribe: () => () => {} };
}

/** Every link to checkout on the page: the first choice and each card. */
function checkoutLinks(): HTMLElement[] {
  return screen.getAllByRole('link').filter((link) => (link.getAttribute('href') ?? '').startsWith(STRIPE));
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
  it("puts Fund the next card in line first, naming the next card, then exactly the funding order's cards in that order, each linking to checkout", async () => {
    renderContribute(
      source(
        [
          card({ id: 'g1', title: 'Rename the Gatherer', summary: 'A new name.', stage: 'voted' }),
          card({ id: 's1', title: 'A clearer ledger', folder: 'platform', bucket: 'platform' }),
          card({ id: 'refunded', title: 'Refunded below its target', stage: 'funded', funding_target_usd: 5, funded_usd: 4 }),
          card({ id: 'vetoed', title: 'Vetoed card', stage: 'proposed' }),
          card({ id: 'b1', title: 'Being built', stage: 'building' }),
        ],
        false,
        // The waterfall: a funded card a refund left below its target first; the vetoed card is not in it.
        ['refunded', 's1', 'g1'],
      ),
    );
    expect(screen.getByRole('heading', { level: 1, name: legal.contributeTitle })).toBeTruthy();
    const links = () => screen.getAllByRole('link');
    expect(links()[0]?.getAttribute('href')).toBe(STRIPE);
    await waitFor(() => expect(links()[0]?.textContent).toBe(`${legal.pickForMe}${legal.nextInLine.replace('{title}', 'Refunded below its target')}`));

    const choices = screen.getAllByRole('listitem').map((item) => within(item).getByRole('link'));
    expect(choices.map((a) => a.getAttribute('href'))).toEqual([
      `${STRIPE}?client_reference_id=refunded`,
      `${STRIPE}?client_reference_id=s1`,
      `${STRIPE}?client_reference_id=g1`,
    ]);
    expect(within(choices[2]!).getByText('A new name.')).toBeTruthy();
    expect(screen.queryByText('Vetoed card')).toBeNull();
    expect(screen.queryByText('Being built')).toBeNull();
    // The waterfall line sits directly under the choices.
    const list = choices[0]!.closest('ul')!;
    expect(list.nextElementSibling?.textContent).toBe(legal.waterfallLine);
    expect(checkoutLinks()).toHaveLength(4);
  });

  it('says the money waits in Not on a card yet when no card is in the funding order', async () => {
    renderContribute(source([card({ id: 'g1', title: 'Rename the Gatherer' })], false, []));
    await waitFor(() => expect(screen.getByText(legal.noFundableCards)).toBeTruthy());
    expect(screen.getByRole('link', { name: new RegExp(legal.pickForMe) }).textContent).toBe(`${legal.pickForMe}${legal.nextInLineNone}`);
    expect(checkoutLinks()).toHaveLength(1);
    expect(screen.queryByText(legal.waterfallLine)).toBeNull();
  });

  it('offers only Fund the next card in line, naming no card, when public_money did not load', async () => {
    renderContribute(source([card({ id: 'g1', title: 'Rename the Gatherer' })], false, ['g1'], { money: null, missing: ['money'] }));
    await waitFor(() => expect(screen.getByText(legal.partUnavailable)).toBeTruthy());
    expect(screen.getByRole('link', { name: new RegExp(legal.pickForMe) }).textContent).toBe(`${legal.pickForMe}${legal.pickForMeBody}`);
    expect(checkoutLinks()).toHaveLength(1);
    expect(screen.queryByText('Rename the Gatherer')).toBeNull();
  });

  it('states the agreement directly under the first choice, before any card, with the Terms, the Refunds page and the age condition', async () => {
    renderContribute(source([card({ id: 'g1', title: 'Rename the Gatherer' })]));
    await waitFor(() => expect(screen.getByText('Rename the Gatherer')).toBeTruthy());
    const first = screen.getByRole('link', { name: new RegExp(legal.pickForMe) });
    const agreement = first.nextElementSibling as HTMLElement;
    expect(agreement.tagName).toBe('P');
    expect(agreement.textContent).toBe(
      legal.contributeAgreement.replace('{terms}', legal.footerLinks.terms).replace('{refunds}', legal.refundsPageLink),
    );
    expect(agreement.textContent).toMatch(/adult where you live, or have the permission of a parent or guardian/);
    expect(within(agreement).getByRole('link', { name: legal.footerLinks.terms }).getAttribute('href')).toBe('/terms');
    expect(within(agreement).getByRole('link', { name: legal.refundsPageLink }).getAttribute('href')).toBe('/refunds');
    const cardLink = checkoutLinks()[1]!;
    expect(agreement.compareDocumentPosition(cardLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists only cards on horizon now, never a roadmap card', async () => {
    renderContribute(
      source([
        card({ id: 'g1', title: 'Rename the Gatherer' }),
        card({ id: 'n1', title: 'Planned next', horizon: 'next' }),
        card({ id: 'l1', title: 'Planned later', horizon: 'later' }),
      ]),
    );
    await waitFor(() => expect(screen.getByText('Rename the Gatherer')).toBeTruthy());
    expect(screen.queryByText('Planned next')).toBeNull();
    expect(screen.queryByText('Planned later')).toBeNull();
    expect(checkoutLinks()).toHaveLength(2);
  });

  it('says the agents are paused above the choices while the board has paused them', async () => {
    renderContribute(source([card({ id: 'g1', title: 'Rename the Gatherer' })], true));
    await waitFor(() => expect(screen.getByText(legal.pausedNotice)).toBeTruthy());
    // The notice comes before the first choice, so it is read before any payment.
    const notice = screen.getByText(legal.pausedNotice);
    const pick = screen.getByRole('link', { name: new RegExp(legal.pickForMe) });
    expect(notice.compareDocumentPosition(pick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  for (const reason of ['awaiting_credit', 'spend_limit', 'incident', 'board']) {
    it(`says why the agents are paused in the notice: ${reason}`, async () => {
      renderContribute(source([card({ id: 'g1', title: 'Rename the Gatherer' })], true, undefined, { pauseReason: reason }));
      await waitFor(() => expect(document.querySelector('p.notice')?.textContent).toBe(legal.pauseReasons[reason]));
    });
  }

  it('draws no paused notice when the studio row did not load', async () => {
    renderContribute(source([card({ id: 'g1', title: 'Rename the Gatherer' })], true, undefined, { pauseReason: 'incident', missing: ['studio'] }));
    await waitFor(() => expect(screen.getByText('Rename the Gatherer')).toBeTruthy());
    expect(document.querySelector('p.notice')).toBeNull();
  });

  it('keeps Fund the next card in line when no card needs funding, and says so', async () => {
    renderContribute(source([]));
    await waitFor(() => expect(screen.getByText(legal.noFundableCards)).toBeTruthy());
    expect(screen.getByRole('link', { name: new RegExp(legal.pickForMe) }).getAttribute('href')).toBe(STRIPE);
  });

  it('says the figures may be out of date when a refresh fails', async () => {
    let onChange = () => {};
    let fail = false;
    const cards = [card({ id: 'g1', title: 'Rename the Gatherer' })];
    const loaded = source(cards);
    renderContribute({
      load: () => (fail ? Promise.reject(new Error('network down')) : loaded.load()),
      subscribe: (callback) => {
        onChange = callback;
        return () => {};
      },
    });
    const status = screen.getByRole('status');
    await waitFor(() => expect(screen.getByText('Rename the Gatherer')).toBeTruthy());
    expect(status.textContent).toBe('');
    fail = true;
    onChange();
    await waitFor(() => expect(status.textContent).toBe(legal.staleFigures), { timeout: 3000 });
    expect(screen.getAllByRole('status')).toEqual([status]);
    expect(screen.getByText('Rename the Gatherer')).toBeTruthy();
  });

  it('says contributions are not open without a payment link', () => {
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
    renderContribute(null);
    expect(screen.getByText(legal.contributeUnavailable)).toBeTruthy();
    expect(screen.queryByRole('link', { name: new RegExp(legal.pickForMe) })).toBeNull();
  });
});
