import { describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { FEED_KINDS, pipeText } from './Pipe';

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
