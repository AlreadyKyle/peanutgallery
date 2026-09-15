import { describe, expect, it } from 'vitest';
import {
  canFund,
  fundLink,
  isFullyFunded,
  nextOrder,
  sourceLabel,
  splitCards,
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
    funding_target_usd: 0,
    funded_usd: 0,
    actual_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

describe('splitCards', () => {
  it('sends building and gated cards to Now and the rest to Next', () => {
    const cards = [
      card({ id: 'a', stage: 'building' }),
      card({ id: 'b', stage: 'voted' }),
      card({ id: 'c', stage: 'gated' }),
      card({ id: 'd', stage: 'proposed' }),
    ];
    const { now, next } = splitCards(cards);
    expect(now.map((c) => c.id)).toEqual(['a', 'c']);
    expect(next.map((c) => c.id).sort()).toEqual(['b', 'd']);
  });

  it('keeps Now in the input order and sorts Next by nextOrder', () => {
    const cards = [
      card({ id: 'proposed', stage: 'proposed' }),
      card({ id: 'gated', stage: 'gated' }),
      card({ id: 'funded', stage: 'funded' }),
      card({ id: 'building', stage: 'building' }),
    ];
    const { now, next } = splitCards(cards);
    expect(now.map((c) => c.id)).toEqual(['gated', 'building']);
    expect(next.map((c) => c.id)).toEqual(['funded', 'proposed']);
  });
});

describe('nextOrder', () => {
  it('ranks funded before voted before designing before proposed', () => {
    const cards = [
      card({ id: 'proposed', stage: 'proposed' }),
      card({ id: 'designing', stage: 'designing' }),
      card({ id: 'voted', stage: 'voted' }),
      card({ id: 'funded', stage: 'funded' }),
    ];
    expect([...cards].sort(nextOrder).map((c) => c.id)).toEqual([
      'funded',
      'voted',
      'designing',
      'proposed',
    ]);
  });

  it('orders cards of the same stage by funded amount, highest first', () => {
    const cards = [
      card({ id: 'low', stage: 'voted', funded_usd: 10 }),
      card({ id: 'high', stage: 'voted', funded_usd: 30 }),
    ];
    expect([...cards].sort(nextOrder).map((c) => c.id)).toEqual(['high', 'low']);
  });

  it('breaks a full tie by the oldest created_at', () => {
    const cards = [
      card({ id: 'newer', stage: 'proposed', funded_usd: 0, created_at: '2026-09-14T00:00:02Z' }),
      card({ id: 'older', stage: 'proposed', funded_usd: 0, created_at: '2026-09-14T00:00:01Z' }),
    ];
    expect([...cards].sort(nextOrder).map((c) => c.id)).toEqual(['older', 'newer']);
  });
});

describe('statusOf', () => {
  it('maps every stage to a status', () => {
    expect(statusOf(card({ stage: 'building' }))).toBe('building');
    expect(statusOf(card({ stage: 'gated' }))).toBe('gated');
    expect(statusOf(card({ stage: 'voted' }))).toBe('decided');
    expect(statusOf(card({ stage: 'funded' }))).toBe('decided');
    expect(statusOf(card({ stage: 'designing' }))).toBe('open');
    expect(statusOf(card({ stage: 'proposed' }))).toBe('open');
    expect(statusOf(card({ stage: 'anything-else' }))).toBe('open');
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
