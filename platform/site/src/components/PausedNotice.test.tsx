import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { legal } from '../lib/legal';
import type { Snapshot } from '../lib/source';
import { PausedNotice, pausedSentence } from './PausedNotice';

afterEach(() => {
  cleanup();
});

function snapshot(over: Partial<Snapshot>): Snapshot {
  return {
    pool: null,
    cards: [],
    funding: {},
    launchedAt: null,
    paused: true,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    missing: [],
    ...over,
  };
}

function notice(s: Snapshot): string | null {
  const { container } = render(<PausedNotice studio={{ state: 'ready', snapshot: s, stale: false }} />);
  const text = container.querySelector('p.notice')?.textContent ?? null;
  cleanup();
  return text;
}

describe('pausedSentence and the paused notice', () => {
  it('says the reason for each pause, the same sentence in the notice', () => {
    for (const reason of ['awaiting_credit', 'spend_limit', 'incident', 'board']) {
      const s = snapshot({ pauseReason: reason });
      expect(pausedSentence(s), reason).toBe(legal.pauseReasons[reason]);
      expect(notice(s), reason).toBe(legal.pauseReasons[reason]);
    }
  });

  it('says the general line when the reason is missing or has no sentence', () => {
    for (const pauseReason of [null, undefined, 'a_reason_added_later']) {
      expect(pausedSentence(snapshot({ pauseReason }))).toBe(legal.pausedNotice);
      expect(notice(snapshot({ pauseReason }))).toBe(legal.pausedNotice);
    }
  });

  it('says nothing when not paused, or when the studio row did not load', () => {
    for (const s of [snapshot({ paused: false, pauseReason: null }), snapshot({ paused: true, pauseReason: 'incident', missing: ['studio'] })]) {
      expect(pausedSentence(s)).toBeNull();
      expect(notice(s)).toBeNull();
    }
    const { container } = render(<PausedNotice studio={{ state: 'loading' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('names the category only: no reason sentence names a person or a time', () => {
    for (const sentence of Object.values(legal.pauseReasons)) {
      expect(sentence).not.toMatch(/\b(Kyle|founder|moderator|at \d|on \d|yesterday|today|\d{4})\b/i);
    }
  });
});
