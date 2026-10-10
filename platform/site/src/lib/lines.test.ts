import { describe, expect, it } from 'vitest';
import { copy } from './copy';
import { collapseLines, eventLine } from './lines';

describe('event lines', () => {
  it('says each key in words, one event or a run of n, and an unknown key as other', () => {
    expect(eventLine('read')).toBe('read a file');
    expect(eventLine('read', 12)).toBe('read 12 files');
    expect(eventLine('ran', 3)).toBe('ran 3 commands');
    expect(eventLine('gate_passed', 2)).toBe('passed the checks (2 times)');
    expect(eventLine('brand_new_key')).toBe(copy.eventLines.other!.one);
    // The database's own steps: a top-up names its amount, filled by the caller.
    expect(eventLine('topped_up', 1, 1.25)).toBe('topped the card up with $1.25 from Not on a card yet');
    expect(eventLine('topped_up', 1, '0.5000')).toBe('topped the card up with $0.50 from Not on a card yet');
    expect(eventLine('resumed')).toBe('resumed the card by rule after its spending limit');
    expect(eventLine('ranked')).toBe('ranked the cards open for funding');
    for (const key of ['started', 'read', 'edited', 'ran', 'submitted', 'used_tool', 'smoke_passed', 'requeued', 'paused_infra', 'auto_resumed', 'patch_reused', 'dealt', 'topped_up', 'resumed', 'ranked', 'gate_passed', 'gate_failed', 'shipped', 'reverted', 'stopped', 'other']) {
      expect(eventLine(key), key).not.toBe(key === 'other' ? '' : copy.eventLines.other!.one);
    }
  });

  it('collapses consecutive lines by the same agent with the same key on the same card, keeping order', () => {
    const line = (role_id: string | null, line_key: string, card_id: string | null = 'c1') => ({ role_id, line_key, card_id });
    const lines = [
      line('a', 'read'),
      line('a', 'read'),
      line('a', 'read'),
      line('b', 'read'),
      line('a', 'edited'),
      line('a', 'read'),
      line('a', 'read', 'c2'),
      line(null, 'dealt'),
      line(null, 'dealt'),
    ];
    expect(collapseLines(lines).map((l) => [l.role_id, l.line_key, l.card_id, l.count])).toEqual([
      ['a', 'read', 'c1', 3],
      ['b', 'read', 'c1', 1],
      ['a', 'edited', 'c1', 1],
      ['a', 'read', 'c1', 1],
      ['a', 'read', 'c2', 1],
      [null, 'dealt', 'c1', 2],
    ]);
    // Events from before the line keys never merge.
    expect(collapseLines([{ role_id: 'a' }, { role_id: 'a' }]).map((l) => l.count)).toEqual([1, 1]);
  });
});
