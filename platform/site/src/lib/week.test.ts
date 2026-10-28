import { describe, expect, it } from 'vitest';
import type { FeedDoc, FeedEvent } from './community-types';
import { loadWeek, MAX_PAGES, weekFrom, weekStart } from './week';

// This week, in public (QUEUE Q-053): the New York week, Monday 00:00 to now, counted from the feed.

const person = (handle: string) => ({ handle, displayName: handle, level: 1, avatar: { body: 'a', eyes: 'a', antennae: 'a', pattern: 'a', fill: 'a' }, frame: null, flair: null });

function event(id: string, at: string, kind: FeedEvent['kind'], text: string, extra: Partial<FeedEvent> = {}): FeedEvent {
  return { id, at, kind, text, ...extra };
}

describe('weekStart', () => {
  it('is Monday 00:00 in New York, in summer time and in winter time', () => {
    // Wednesday 28 October 2026, 15:00 UTC: EDT, so Monday 26 October 00:00 is 04:00 UTC.
    expect(new Date(weekStart(Date.parse('2026-10-28T15:00:00Z'))).toISOString()).toBe('2026-10-26T04:00:00.000Z');
    // Wednesday 11 November 2026: EST, so Monday 9 November 00:00 is 05:00 UTC.
    expect(new Date(weekStart(Date.parse('2026-11-11T15:00:00Z'))).toISOString()).toBe('2026-11-09T05:00:00.000Z');
  });

  it('counts a Sunday evening in New York in the week that began six days before, though UTC is on Monday', () => {
    // Monday 2 November 2026, 03:00 UTC is Sunday 1 November, 22:00 EST (the clocks went back that morning).
    expect(new Date(weekStart(Date.parse('2026-11-02T03:00:00Z'))).toISOString()).toBe('2026-10-26T04:00:00.000Z');
  });

  it('starts a new week at Monday midnight in New York', () => {
    expect(new Date(weekStart(Date.parse('2026-10-26T04:00:00Z'))).toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(new Date(weekStart(Date.parse('2026-10-26T03:59:59Z'))).toISOString()).toBe('2026-10-19T04:00:00.000Z');
  });
});

describe('weekFrom', () => {
  const from = Date.parse('2026-10-26T04:00:00Z');

  it('counts contributions, opened, funded and shipped cards, and the named players, from Monday only', () => {
    const week = weekFrom(
      [
        event('1', '2026-10-28T10:00:00Z', 'contribution', 'Ada put $2.00 on Faster gatherers', { actor: person('ada'), amountCents: 200, cardId: 'c1' }),
        event('2', '2026-10-28T09:00:00Z', 'contribution', 'Someone put $1.00 into the Machine', { actor: null, amountCents: 100 }),
        event('3', '2026-10-27T09:00:00Z', 'stage', 'Faster gatherers is funded', { cardId: 'c1' }),
        event('4', '2026-10-27T10:00:00Z', 'stage', 'Faster gatherers is building', { cardId: 'c1' }),
        event('5', '2026-10-27T11:00:00Z', 'shipped', 'Brighter dust shipped', { cardId: 'c2' }),
        event('6', '2026-10-26T05:00:00Z', 'card_opened', 'A new card opened: Night mode', { cardId: 'c3' }),
        event('7', '2026-10-26T06:00:00Z', 'suggestion', 'Bea shared an idea', { actor: person('bea') }),
        event('8', '2026-10-26T07:00:00Z', 'contribution', 'Ada put $1.00 on Night mode', { actor: person('ada'), amountCents: 100, cardId: 'c3' }),
        // Before Monday 00:00 in New York: not this week.
        event('9', '2026-10-26T03:59:00Z', 'shipped', 'Old card shipped', { cardId: 'c9' }),
        event('10', '2026-10-25T12:00:00Z', 'contribution', 'Cy put $5.00 on Old card', { actor: person('cy'), amountCents: 500 }),
        // The same line twice (two pages overlapping) counts once.
        event('1', '2026-10-28T10:00:00Z', 'contribution', 'Ada put $2.00 on Faster gatherers', { actor: person('ada'), amountCents: 200, cardId: 'c1' }),
      ],
      from,
    );
    expect(week).toEqual({
      from: '2026-10-26T04:00:00.000Z',
      day: '2026-10-26',
      contributions: 3,
      opened: 1,
      funded: [{ id: 'c1', title: 'Faster gatherers' }],
      shipped: [{ id: 'c2', title: 'Brighter dust' }],
      players: 2,
      complete: true,
    });
  });

  it('is all zero for a quiet week', () => {
    expect(weekFrom([], from)).toMatchObject({ contributions: 0, opened: 0, funded: [], shipped: [], players: 0 });
  });
});

describe('loadWeek', () => {
  const now = Date.parse('2026-10-28T15:00:00Z');

  function reader(pages: Record<string, FeedDoc>) {
    const asked: string[] = [];
    const read = async <T,>(path: string): Promise<T> => {
      asked.push(path);
      const page = pages[path];
      if (page === undefined) throw new Error(`no page ${path}`);
      return page as T;
    };
    return { read: read as Parameters<typeof loadWeek>[1], asked };
  }

  it('reads older pages until one reaches back past Monday, then stops', async () => {
    const { read, asked } = reader({
      '/feed': { events: [event('a', '2026-10-28T10:00:00Z', 'shipped', 'A shipped', { cardId: 'a' })], next: 'p2' },
      '/feed?cursor=p2': {
        events: [event('b', '2026-10-27T10:00:00Z', 'shipped', 'B shipped', { cardId: 'b' }), event('c', '2026-10-20T10:00:00Z', 'shipped', 'C shipped', { cardId: 'c' })],
        next: 'p3',
      },
    });
    const week = await loadWeek(now, read);
    expect(asked).toEqual(['/feed', '/feed?cursor=p2']);
    expect(week.shipped.map((card) => card.id)).toEqual(['a', 'b']);
    expect(week.complete).toBe(true);
  });

  it('stops at the last page of the feed', async () => {
    const { read, asked } = reader({ '/feed': { events: [], next: null } });
    expect((await loadWeek(now, read)).complete).toBe(true);
    expect(asked).toEqual(['/feed']);
  });

  it(`reads at most ${MAX_PAGES} pages, and says when the week was not reached`, async () => {
    const pages: Record<string, FeedDoc> = {};
    for (let i = 0; i <= MAX_PAGES; i += 1) {
      pages[i === 0 ? '/feed' : `/feed?cursor=p${i}`] = { events: [event(`e${i}`, '2026-10-28T10:00:00Z', 'contribution', 'Someone put $1.00 into the Machine')], next: `p${i + 1}` };
    }
    const { read, asked } = reader(pages);
    const week = await loadWeek(now, read);
    expect(asked).toHaveLength(MAX_PAGES);
    expect(week.complete).toBe(false);
    expect(week.contributions).toBe(MAX_PAGES);
  });

  it('rejects when the feed does not answer', async () => {
    const { read } = reader({});
    await expect(loadWeek(now, read)).rejects.toThrow();
  });
});
