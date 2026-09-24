import { describe, expect, it } from 'vitest';
import {
  canFund,
  categoryOf,
  fundableCards,
  fundLink,
  fundOrder,
  groupCards,
  inCategory,
  inFundingOrder,
  isFullyFunded,
  isRunnable,
  nextInLine,
  openForFunding,
  plannedCards,
  shippedOrder,
  sourceLabel,
  faceOf,
  CATEGORY_FILTERS,
  visibleFilters,
} from './cards';
import { copy } from './copy';
import { books } from './books.test-fixture';
import type { Card, Money, Snapshot } from './source';

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
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: 0,
    funded_usd: 0,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

describe('groupCards', () => {
  it('sends building and gated cards to now, funded cards to queued, live cards to shipped and the rest to fund', () => {
    const cards = [
      card({ id: 'a', stage: 'building' }),
      card({ id: 'b', stage: 'voted' }),
      card({ id: 'c', stage: 'gated' }),
      card({ id: 'd', stage: 'proposed' }),
      card({ id: 'e', stage: 'funded' }),
      card({ id: 'f', stage: 'live', updated_at: '2026-09-15T10:00:00Z' }),
      // A live goal with room left on its bar is still shipped, never fundable.
      card({ id: 'g', stage: 'live', funding_target_usd: 10, funded_usd: 2, updated_at: '2026-09-15T12:00:00Z' }),
    ];
    const { now, fund, queued, shipped } = groupCards(cards);
    expect(now.map((c) => c.id)).toEqual(['a', 'c']);
    expect(fund.map((c) => c.id)).toEqual(['b', 'd']);
    expect(queued.map((c) => c.id)).toEqual(['e']);
    expect(shipped.map((c) => c.id)).toEqual(['g', 'f']);
  });
});

function snapshot(cards: Card[], money: Money | null, missing: Snapshot['missing'] = []): Snapshot {
  return {
    pool: null,
    cards,
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    money,
    missing,
  };
}

describe('fundableCards, nextInLine and inFundingOrder (payment.ts, kernel)', () => {
  const cards = [
    card({ id: 'picked', stage: 'voted', funding_target_usd: 5, funded_usd: 1 }),
    card({ id: 'refunded', stage: 'funded', funding_target_usd: 5, funded_usd: 4 }),
    card({ id: 'vetoed', stage: 'proposed', funding_target_usd: 5 }),
    card({ id: 'open', stage: 'proposed', funding_target_usd: 5 }),
  ];

  it("offers exactly the cards in the waterfall's order, in that order, and skips an id the snapshot does not list", () => {
    // A funded card a refund left below its target takes money first; a vetoed card is not in the order.
    const s = snapshot(cards, books(['refunded', 'gone', 'picked', 'open']));
    expect(fundableCards(s).map((c) => c.id)).toEqual(['refunded', 'picked', 'open']);
    expect(nextInLine(s)?.id).toBe('refunded');
    expect(inFundingOrder(s, 'refunded')).toBe(true);
    expect(inFundingOrder(s, 'vetoed')).toBe(false);
  });

  it('offers no card and names none when the order is empty', () => {
    const s = snapshot(cards, books([]));
    expect(fundableCards(s)).toEqual([]);
    expect(nextInLine(s)).toBeNull();
    expect(inFundingOrder(s, 'open')).toBe(false);
  });

  it('offers no card when public_money did not load, or a snapshot carries no books', () => {
    for (const s of [snapshot(cards, null, ['money']), snapshot(cards, books(['open']), ['money']), { ...snapshot(cards, null), money: undefined }]) {
      expect(fundableCards(s)).toEqual([]);
      expect(nextInLine(s)).toBeNull();
      expect(inFundingOrder(s, 'open')).toBe(false);
    }
  });

  it("keeps in home's fund group only the open cards in the order, and every open card when the order did not load", () => {
    const loaded = snapshot(cards, books(['refunded', 'picked', 'open']));
    // The vetoed card takes no money, so home neither counts it as open nor draws it; the refunded
    // card is funded, so it stays queued.
    expect(groupCards(cards, openForFunding(loaded)).fund.map((c) => c.id)).toEqual(['picked', 'open']);
    expect(groupCards(cards, openForFunding(snapshot(cards, books([])))).fund).toEqual([]);
    for (const s of [snapshot(cards, null, ['money']), { ...snapshot(cards, null), money: undefined }]) {
      expect(groupCards(cards, openForFunding(s)).fund.map((c) => c.id)).toEqual(['picked', 'vetoed', 'open']);
    }
  });
});

describe('shippedOrder', () => {
  it('puts the latest ship first, then the newest card when two shipped at the same time', () => {
    const cards = [
      card({ id: 'first', updated_at: '2026-09-15T09:00:00Z' }),
      card({ id: 'latest', updated_at: '2026-09-15T11:30:00.123456+00:00' }),
      card({ id: 'tie-old', updated_at: '2026-09-15T10:00:00Z', created_at: '2026-09-14T00:00:01Z' }),
      card({ id: 'tie-new', updated_at: '2026-09-15T10:00:00Z', created_at: '2026-09-14T00:00:02Z' }),
    ];
    expect([...cards].sort(shippedOrder).map((c) => c.id)).toEqual(['latest', 'tie-new', 'tie-old', 'first']);
  });

  it('orders by live_at, so a refund or held release after shipping does not move a card', () => {
    const cards = [
      card({ id: 'shipped-early-touched-late', live_at: '2026-09-15T09:00:00Z', updated_at: '2026-09-29T09:00:00Z' }),
      card({ id: 'shipped-later', live_at: '2026-09-16T09:00:00Z', updated_at: '2026-09-16T09:00:00Z' }),
    ];
    expect([...cards].sort(shippedOrder).map((c) => c.id)).toEqual(['shipped-later', 'shipped-early-touched-late']);
  });
});

describe('fundOrder', () => {
  it('ranks voted before designing before proposed', () => {
    const cards = [
      card({ id: 'proposed', stage: 'proposed' }),
      card({ id: 'designing', stage: 'designing' }),
      card({ id: 'voted', stage: 'voted' }),
    ];
    expect([...cards].sort(fundOrder).map((c) => c.id)).toEqual(['voted', 'designing', 'proposed']);
  });

  it('orders cards of the same stage by funded amount, highest first, then the oldest', () => {
    const cards = [
      card({ id: 'low', stage: 'voted', funded_usd: 10 }),
      card({ id: 'high', stage: 'voted', funded_usd: 30 }),
      card({ id: 'newer', stage: 'proposed', created_at: '2026-09-14T00:00:02Z' }),
      card({ id: 'older', stage: 'proposed', created_at: '2026-09-14T00:00:01Z' }),
    ];
    expect([...cards].sort(fundOrder).map((c) => c.id)).toEqual(['high', 'low', 'older', 'newer']);
  });
});

describe('faceOf', () => {
  it('maps every stage to a face', () => {
    expect(faceOf(card({ stage: 'building' }))).toBe('building');
    expect(faceOf(card({ stage: 'gated' }))).toBe('checks');
    expect(faceOf(card({ stage: 'funded' }))).toBe('funded');
    expect(faceOf(card({ stage: 'live' }))).toBe('live');
    expect(faceOf(card({ stage: 'voted' }))).toBe('picked');
    expect(faceOf(card({ stage: 'designing' }))).toBe('open');
    expect(faceOf(card({ stage: 'proposed' }))).toBe('open');
    expect(faceOf(card({ stage: 'anything-else' }))).toBe('open');
  });
});

describe('categoryOf and inCategory', () => {
  it('puts platform cards under the studio and seed-1 cards under the game, and has no third suit', () => {
    const game = card({ folder: 'seed-1', bucket: 'qa' });
    const studio = card({ folder: 'platform', bucket: 'platform' });
    expect(categoryOf(game)).toBe('game');
    expect(categoryOf(studio)).toBe('studio');
    expect([inCategory(game, 'all'), inCategory(game, 'game'), inCategory(game, 'studio')]).toEqual([true, true, false]);
    expect(inCategory(studio, 'studio')).toBe(true);
  });
});

describe('isFullyFunded', () => {
  it('is true only when a positive target has been reached', () => {
    expect(isFullyFunded(card({ funding_target_usd: 100, funded_usd: 100 }))).toBe(true);
    expect(isFullyFunded(card({ funding_target_usd: 100, funded_usd: 99 }))).toBe(false);
    expect(isFullyFunded(card({ funding_target_usd: 0, funded_usd: 0 }))).toBe(false);
  });
});

describe('canFund', () => {
  it('is true for a goal card with an unmet positive target', () => {
    expect(canFund(card({ shape: 'goal', funding_target_usd: 100, funded_usd: 25 }))).toBe(true);
  });

  it('is false for a non-goal shape, a zero target, and a full bar', () => {
    expect(canFund(card({ shape: 'oneoff', funding_target_usd: 100, funded_usd: 0 }))).toBe(false);
    expect(canFund(card({ shape: 'goal', funding_target_usd: 0, funded_usd: 0 }))).toBe(false);
    expect(canFund(card({ shape: 'goal', funding_target_usd: 100, funded_usd: 100 }))).toBe(false);
  });
});

describe('fundLink', () => {
  it('adds client_reference_id with ? for a bare URL', () => {
    expect(fundLink('https://buy.stripe.com/abc', 'card-1')).toBe(
      'https://buy.stripe.com/abc?client_reference_id=card-1',
    );
  });

  it('adds it with & when the URL already has a query string and encodes the id', () => {
    expect(fundLink('https://buy.stripe.com/abc?utm=x', 'a/b c')).toBe(
      'https://buy.stripe.com/abc?utm=x&client_reference_id=a%2Fb%20c',
    );
  });
});

describe('sourceLabel', () => {
  it('labels a known source and passes an unknown source through', () => {
    expect(sourceLabel('board')).toBe(copy.sources.board);
    expect(sourceLabel('community')).toBe(copy.sources.community);
    expect(sourceLabel('mystery')).toBe('mystery');
  });
});

describe('horizons', () => {
  it('keeps next and later cards out of building, funding and the queue, and never open for funding', () => {
    const cards = [
      card({ id: 'now-open', stage: 'proposed', funding_target_usd: 3 }),
      card({ id: 'later-open', stage: 'proposed', horizon: 'later' }),
      card({ id: 'next-picked', stage: 'voted', horizon: 'next', funding_target_usd: 3 }),
      card({ id: 'next-funded', stage: 'funded', horizon: 'next' }),
      card({ id: 'next-building', stage: 'building', horizon: 'next' }),
      card({ id: 'next-live', stage: 'live', horizon: 'next' }),
    ];
    const groups = groupCards(cards);
    expect(groups.fund.map((c) => c.id)).toEqual(['now-open']);
    expect(groups.queued).toEqual([]);
    expect(groups.now).toEqual([]);
    // A live card is a record of what shipped, whatever horizon it was filed on.
    expect(groups.shipped.map((c) => c.id)).toEqual(['next-live']);
    expect(isRunnable(cards[1]!)).toBe(false);
  });

  it('lists the roadmap by horizon, ranked cards first, lowest rank first, then the oldest', () => {
    const cards = [
      card({ id: 'n-unranked-old', horizon: 'next', created_at: '2026-09-14T00:00:01Z' }),
      card({ id: 'n-2', horizon: 'next', rank: 2 }),
      card({ id: 'n-1', horizon: 'next', rank: 1 }),
      card({ id: 'n-unranked-new', horizon: 'next', created_at: '2026-09-14T00:00:09Z' }),
      card({ id: 'l-1', horizon: 'later', rank: 1 }),
      card({ id: 'l-live', horizon: 'later', stage: 'live' }),
      card({ id: 'now', horizon: 'now' }),
    ];
    const planned = plannedCards(cards);
    expect(planned.next.map((c) => c.id)).toEqual(['n-1', 'n-2', 'n-unranked-old', 'n-unranked-new']);
    expect(planned.later.map((c) => c.id)).toEqual(['l-1']);
  });
});

describe('visibleFilters', () => {
  it('always shows All and Dust, and The studio only while it has cards', () => {
    expect(visibleFilters([card({ folder: 'seed-1' })])).toEqual(['all', 'game']);
    expect(visibleFilters([])).toEqual(['all', 'game']);
    expect(visibleFilters([card({ folder: 'platform' })])).toEqual(['all', 'game', 'studio']);
  });
});

