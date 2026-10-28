import { describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { FEED_KINDS, pipeText, QUIET_AFTER_MS, quietLine } from './Pipe';
import type { FeedEvent } from '../lib/community-types';
import { formatDate } from '../lib/format';

// The latest activity's rows: an opened card reads "Opened <title>", not "New card A new card opened: <title>".

describe('pipeText', () => {
  const at = '2026-10-20T10:00:00Z';

  it('drops the database prefix from an opened card, so the row reads Opened and the title', () => {
    expect(FEED_KINDS.card_opened.word).toBe('Opened');
    expect(pipeText({ id: 'a', at, kind: 'card_opened', text: 'A new card opened: Cheaper Carts' })).toBe('Cheaper Carts');
  });

  it('leaves every other row as it was written', () => {
    expect(pipeText({ id: 'b', at, kind: 'card_opened', text: 'A rare card appeared: Cheaper Carts' })).toBe('A rare card appeared: Cheaper Carts');
    expect(pipeText({ id: 'c', at, kind: 'shipped', text: 'A new card opened: not an opened row' })).toBe('A new card opened: not an opened row');
  });

  it('heads the feed Latest activity', () => {
    expect(copy.pipe.title).toBe('Latest activity');
    expect(copy.pipe.intro).toBe('The latest from the studio. The ledger keeps the record.');
  });
});

// No empty rooms (QUEUE Q-012): a pipe whose newest row is days old says since when, and what is open now.
describe('quietLine', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const row = (at: string): FeedEvent => ({ id: at, at, kind: 'card_opened', text: 'A new card opened: Cheaper Carts' });

  it('says nothing while the newest row is three days old or newer', () => {
    expect(quietLine([row(new Date(now - QUIET_AFTER_MS).toISOString())], 5, now)).toBeNull();
    expect(quietLine([row('2026-10-21T12:00:00Z')], 5, now)).toBeNull();
  });

  it('says nothing with no rows: the empty pipe says that itself', () => {
    expect(quietLine([], 5, now)).toBeNull();
  });

  it('names the newest row\'s date and the cards open now, both from the data', () => {
    const events = [row('2026-10-11T05:59:46Z'), row('2026-10-10T21:32:39Z')];
    // formatDate holds the day together with no-break spaces.
    const since = `Quiet since ${formatDate('2026-10-11T05:59:46Z')}.`;
    expect(since.replaceAll('\u00a0', ' ')).toBe('Quiet since 11 Oct 2026.');
    expect(quietLine(events, 5, now)).toBe(`${since} 5 cards are open for funding now.`);
    expect(quietLine(events, 1, now)).toBe(`${since} 1 card is open for funding now.`);
    expect(quietLine(events, 0, now)).toBe(since);
  });
});
