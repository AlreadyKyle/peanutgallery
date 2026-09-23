import { describe, expect, it } from 'vitest';
import {
  announcementText,
  changesHeight,
  diffSnapshots,
  LONGEST_UPDATES_LABEL,
  MAX_MOTIONS_PER_POLL,
  shouldAnnounceCount,
  updatesLabel,
} from './changes';
import { copy } from './copy';
import type { Card, Snapshot } from './source';

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: `Card ${id}`,
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
    created_at: `2026-09-14T00:00:0${id.length}Z`,
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

function snap(cards: Card[]): Snapshot {
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
    missing: [],
  };
}

const visible = { hidden: false };

describe('diffSnapshots', () => {
  it('finds nothing on first load', () => {
    expect(diffSnapshots(null, snap([card('a', { funded_usd: 5 })]), visible)).toEqual({ motions: [], still: [], held: [], announce: [] });
  });

  it('plays a fund tick when a card on screen gains money, and holds the reorder it causes', () => {
    const before = snap([card('a', { funded_usd: 2 }), card('b', { funded_usd: 1 })]);
    const after = snap([card('a', { funded_usd: 2 }), card('b', { funded_usd: 4 })]);
    const diff = diffSnapshots(before, after, visible);
    expect(diff.motions).toEqual([{ kind: 'fund', id: 'b', from: 1, to: 4 }]);
    // The fund order puts the most funded first, so both cards would move: held, never applied live.
    expect(diff.held).toEqual([
      { kind: 'move', id: 'b' },
      { kind: 'move', id: 'a' },
    ]);
  });

  it('flips a card that reaches its target, announces it once, and holds its move to Queued', () => {
    const before = snap([card('a', { funded_usd: 9 })]);
    const after = snap([card('a', { funded_usd: 10, stage: 'funded' })]);
    const diff = diffSnapshots(before, after, visible);
    expect(diff.motions).toEqual([
      { kind: 'fund', id: 'a', from: 9, to: 10 },
      { kind: 'flip', id: 'a', from: 'open', to: 'funded' },
    ]);
    expect(diff.held).toEqual([{ kind: 'move', id: 'a' }]);
    expect(diff.announce).toEqual([{ kind: 'funded', id: 'a', title: 'Card a' }]);
    expect(announcementText(diff.announce[0]!)).toBe(copy.announceFunded.replace('{title}', 'Card a'));
  });

  it('announces a shipped card', () => {
    const diff = diffSnapshots(snap([card('a', { stage: 'gated' })]), snap([card('a', { stage: 'live' })]), visible);
    expect(diff.announce).toEqual([{ kind: 'shipped', id: 'a', title: 'Card a' }]);
    expect(announcementText(diff.announce[0]!)).toBe(copy.announceShipped.replace('{title}', 'Card a'));
  });

  it('holds cards that arrive or leave, and never plays them', () => {
    const diff = diffSnapshots(snap([card('a')]), snap([card('b')]), visible);
    expect(diff.motions).toEqual([]);
    expect(diff.held).toEqual([
      { kind: 'enter', id: 'b' },
      { kind: 'leave', id: 'a' },
    ]);
  });

  it('plays at most three per poll and applies the rest at once', () => {
    const ids = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
    const diff = diffSnapshots(
      snap(ids.map((id) => card(id, { funded_usd: 1 }))),
      snap(ids.map((id) => card(id, { funded_usd: 2 }))),
      visible,
    );
    expect(MAX_MOTIONS_PER_POLL).toBe(3);
    expect(diff.motions).toHaveLength(3);
    expect(diff.still).toHaveLength(2);
  });

  it('plays nothing in a hidden tab, applying every change at once', () => {
    const diff = diffSnapshots(snap([card('a', { funded_usd: 1 })]), snap([card('a', { funded_usd: 2 })]), { hidden: true });
    expect(diff.motions).toEqual([]);
    expect(diff.still).toEqual([{ kind: 'fund', id: 'a', from: 1, to: 2 }]);
  });
});

describe('the updates button', () => {
  it('reads Up to date, then Show n updates, capped at 99+', () => {
    expect(updatesLabel(0)).toBe(copy.upToDate);
    expect(updatesLabel(1)).toBe(copy.showOneUpdate);
    expect(updatesLabel(3)).toBe('Show 3 updates');
    expect(updatesLabel(120)).toBe('Show 99+ updates');
    expect(LONGEST_UPDATES_LABEL).toBe('Show 99+ updates');
    for (const n of [0, 1, 7, 99, 100]) expect(updatesLabel(n).length).toBeLessThanOrEqual(LONGEST_UPDATES_LABEL.length);
  });

  it('announces the waiting count only from none to some, at most once a minute', () => {
    expect(shouldAnnounceCount(0, 2, null, 1_000)).toBe(true);
    expect(shouldAnnounceCount(2, 3, 1_000, 2_000)).toBe(false);
    expect(shouldAnnounceCount(0, 0, null, 1_000)).toBe(false);
    expect(shouldAnnounceCount(0, 1, 1_000, 30_000)).toBe(false);
    expect(shouldAnnounceCount(0, 1, 1_000, 61_000)).toBe(true);
  });
});

describe('the height rule', () => {
  /** An element whose height is one 20px line per 10 characters of its text, as a browser would wrap it. */
  function wrapping(text: string): HTMLElement {
    const el = document.createElement('dd');
    el.textContent = text;
    el.getBoundingClientRect = () => ({ height: Math.ceil((el.textContent ?? '').length / 10) * 20 }) as DOMRect;
    document.body.appendChild(el);
    return el;
  }

  it('holds a change that would wrap onto another line, and lets one that fits through', () => {
    const el = wrapping('$9.50 of $10.00');
    expect(changesHeight(el, '$9.75 of $10.00')).toBe(false);
    expect(changesHeight(el, '$1,234.56 of $2,000.00')).toBe(true);
  });

  it('puts the text back in the same task and keeps the text node React owns', () => {
    const el = wrapping('$9.50 of $10.00');
    const node = el.firstChild;
    changesHeight(el, '$1,234.56 of $2,000.00');
    expect(el.textContent).toBe('$9.50 of $10.00');
    expect(el.firstChild).toBe(node);
  });
});
