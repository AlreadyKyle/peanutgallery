import { describe, expect, it, vi } from 'vitest';
import {
  barFraction,
  CARDS_PATH,
  cardUrl,
  formatUsd,
  LIVE_PATH,
  loadNextCard,
  nextCardText,
  pickNextCard,
  showNextCard,
  type NextCardElements,
} from '../render/next-card';

function liveCard(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { stage: 'open', horizon: 'now', funding_target_usd: 40, funded_usd: 12.5, ...over };
}

function docs(order: string[], extra: { live?: Record<string, unknown>; cards?: Record<string, unknown>[] } = {}) {
  const live = {
    money: { funding_order: order.map((card_id) => ({ card_id, room_usd: 10 })) },
    cards: { a: liveCard(), b: liveCard({ funded_usd: 3, funding_target_usd: 6 }), c: liveCard(), ...extra.live },
  };
  const cards = {
    cards: extra.cards ?? [
      { id: 'a', title: 'A site card', folder: 'platform' },
      { id: 'b', title: 'A new unit for Dust', folder: 'seed-1' },
      { id: 'c', title: 'Another Dust card', folder: 'seed-1' },
    ],
  };
  return { live, cards };
}

describe('pickNextCard', () => {
  it('takes the first seed-1 card in the funding order, skipping other folders', () => {
    const { live, cards } = docs(['a', 'b', 'c']);
    expect(pickNextCard(live, cards)).toEqual({ id: 'b', title: 'A new unit for Dust', fundedUsd: 3, targetUsd: 6 });
  });

  it('follows the order, not the card document', () => {
    const { live, cards } = docs(['c', 'b']);
    expect(pickNextCard(live, cards)?.id).toBe('c');
  });

  it('is null when no Dust card is in the order, the order is empty or did not load', () => {
    expect(pickNextCard(...Object.values(docs(['a'])) as [unknown, unknown])).toBeNull();
    expect(pickNextCard(...Object.values(docs([])) as [unknown, unknown])).toBeNull();
    const { live, cards } = docs(['b']);
    expect(pickNextCard({ ...live, money: null }, cards)).toBeNull();
  });

  it('is null for malformed documents or figures', () => {
    expect(pickNextCard(null, {})).toBeNull();
    expect(pickNextCard([], [])).toBeNull();
    const bad = docs(['b'], { live: { b: liveCard({ funding_target_usd: 0 }) } });
    expect(pickNextCard(bad.live, bad.cards)).toBeNull();
    const nan = docs(['b'], { live: { b: liveCard({ funded_usd: 'x' }) } });
    expect(pickNextCard(nan.live, nan.cards)).toBeNull();
  });

  it('never shows a planned or shipped card', () => {
    const later = docs(['b'], { live: { b: liveCard({ horizon: 'later' }) } });
    expect(pickNextCard(later.live, later.cards)).toBeNull();
    const shipped = docs(['b'], { live: { b: liveCard({ stage: 'live' }) } });
    expect(pickNextCard(shipped.live, shipped.cards)).toBeNull();
  });

  it('skips an order place whose words have not arrived', () => {
    const { live, cards } = docs(['x', 'c']);
    expect(pickNextCard(live, cards)?.id).toBe('c');
  });
});

describe('the line', () => {
  const card = { id: 'ABC-123', title: 'A new unit for Dust', fundedUsd: 12.5, targetUsd: 40 };

  it('links the card page on the site', () => {
    expect(cardUrl(card.id)).toBe('https://mobmachine.games/card/abc-123');
  });

  it('formats dollars and fills the bar between 0 and 1', () => {
    expect(formatUsd(40)).toBe('$40');
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(barFraction(card)).toBeCloseTo(0.3125);
    expect(barFraction({ ...card, fundedUsd: 90 })).toBe(1);
  });

  it('states the title and the bar, and uses no chance words', () => {
    const text = nextCardText(card);
    expect(text.label).toBe('Next for Dust: A new unit for Dust');
    expect(text.amount).toBe('$12.50 of $40');
    for (const words of Object.values(text)) expect(words).not.toMatch(/\b(chance|luck|lucky|odds|win|prize|random)\b/i);
  });

  it('shows the element for a card and hides it for none', () => {
    const clicks: (() => void)[] = [];
    const el = () => ({
      textContent: '',
      style: { width: '' },
      hidden: true,
      href: '',
      setAttribute() {},
      addEventListener: (_: string, fn: () => void) => clicks.push(fn),
    });
    const elements = { root: el(), link: el(), title: el(), amount: el(), fill: el() } as unknown as NextCardElements;
    showNextCard(elements, card);
    expect(elements.root.hidden).toBe(false);
    // A click through to the card is counted as dust_next_card (docs/specs/play-counts.md).
    expect(clicks).toHaveLength(1);
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon });
    try {
      clicks[0]!();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sendBeacon).toHaveBeenCalledWith('/api/count', '{"event":"dust_next_card"}');
    expect(elements.link.href).toBe('https://mobmachine.games/card/abc-123');
    expect(elements.fill.style.width).toBe('31%');
    showNextCard(elements, null);
    expect(elements.root.hidden).toBe(true);
  });
});

describe('loadNextCard', () => {
  it('reads both public documents on this origin', async () => {
    const { live, cards } = docs(['b']);
    const asked: string[] = [];
    const fetchFn = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(url === LIVE_PATH ? live : cards), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await loadNextCard(fetchFn))?.id).toBe('b');
    expect(asked.sort()).toEqual([CARDS_PATH, LIVE_PATH].sort());
  });

  it('is null when a read fails, answers an error or is not JSON', async () => {
    expect(await loadNextCard((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBeNull();
    expect(await loadNextCard((async () => new Response('{}', { status: 502 })) as unknown as typeof fetch)).toBeNull();
    expect(await loadNextCard((async () => new Response('<!doctype html>', { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });
});
