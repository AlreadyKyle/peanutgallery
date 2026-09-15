import { describe, expect, it } from 'vitest';
import {
  canFund,
  categoryOf,
  fundLink,
  fundOrder,
  groupCards,
  inCategory,
  isFullyFunded,
  sourceLabel,
  statusOf,
} from './cards';
import { copy } from './copy';
import type { Card } from './source';

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
    funding_target_usd: 0,
    funded_usd: 0,
    actual_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

describe('groupCards', () => {
  it('sends building and gated cards to now, funded cards to queued and the rest to fund', () => {
    const cards = [
      card({ id: 'a', stage: 'building' }),
      card({ id: 'b', stage: 'voted' }),
      card({ id: 'c', stage: 'gated' }),
      card({ id: 'd', stage: 'proposed' }),
      card({ id: 'e', stage: 'funded' }),
    ];
    const { now, fund, queued } = groupCards(cards);
    expect(now.map((c) => c.id)).toEqual(['a', 'c']);
    expect(fund.map((c) => c.id)).toEqual(['b', 'd']);
    expect(queued.map((c) => c.id)).toEqual(['e']);
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

describe('statusOf', () => {
  it('maps every stage to a status', () => {
    expect(statusOf(card({ stage: 'building' }))).toBe('building');
    expect(statusOf(card({ stage: 'gated' }))).toBe('gated');
    expect(statusOf(card({ stage: 'funded' }))).toBe('queued');
    expect(statusOf(card({ stage: 'voted' }))).toBe('picked');
    expect(statusOf(card({ stage: 'designing' }))).toBe('open');
    expect(statusOf(card({ stage: 'proposed' }))).toBe('open');
    expect(statusOf(card({ stage: 'anything-else' }))).toBe('open');
  });
});

describe('categoryOf and inCategory', () => {
  it('puts platform cards under the studio and seed-1 cards under the game, and no card under next', () => {
    const game = card({ folder: 'seed-1', bucket: 'qa' });
    const studio = card({ folder: 'platform', bucket: 'platform' });
    expect(categoryOf(game)).toBe('game');
    expect(categoryOf(studio)).toBe('studio');
    expect([inCategory(game, 'all'), inCategory(game, 'game'), inCategory(game, 'studio'), inCategory(game, 'next')]).toEqual([true, true, false, false]);
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
