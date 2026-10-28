import { describe, expect, it } from 'vitest';
import { C } from '../theme';
import {
  chooseStates,
  concatList,
  factsFrom,
  ffmpegArgs,
  INK,
  LIVE,
  MAX_SECONDS,
  MIN_SECONDS,
  MUTED,
  PAPER,
  slideHtml,
  slides,
  span,
  SUIT,
  timelineRows,
  totalSeconds,
  type Capture,
} from './plan';

// A shipped card's replay (docs/specs/replays.md): the facts it states come from the card's public
// document only, its length fits 20 to 30 seconds, and its before and after shows a real change.

const ID = 'e1ee4792-abc0-4dc3-95fa-159b82ac38db';
const doc = (over: { card?: object; milestones?: object; funding?: object | null; spent_usd?: number | string } = {}) => ({
  card: { id: ID, title: 'Gatherers dig faster', stage: 'live', funded_usd: '0.78', ...over.card },
  funding: over.funding === undefined ? { contributors: 3, credited_usd: 0.78 } : over.funding,
  spent_usd: over.spent_usd ?? '0.4213',
  milestones: {
    created_at: '2026-10-11T09:00:00Z',
    started_at: '2026-10-25T10:00:00Z',
    gate_at: '2026-10-25T12:05:00Z',
    gate: 'passed',
    live_at: '2026-10-25T12:20:00Z',
    ...over.milestones,
  },
});
const capture = (states: number[], width = 1280): Capture => ({ commit: 'abc1234', states, sizes: [{ width, height: (width * 9) / 16 }], files: [] });

describe('replay facts', () => {
  it('reads a live card document', () => {
    expect(factsFrom(doc())).toEqual({
      cardId: ID,
      title: 'Gatherers dig faster',
      fundedUsd: 0.78,
      contributors: 3,
      startedAt: '2026-10-25T10:00:00Z',
      gateAt: '2026-10-25T12:05:00Z',
      gate: 'passed',
      liveAt: '2026-10-25T12:20:00Z',
      costUsd: 0.4213,
    });
  });

  it('refuses a card that is not live, or a document that is not a card', () => {
    expect(() => factsFrom(doc({ card: { stage: 'open' } }))).toThrow(/not live/);
    expect(() => factsFrom(doc({ milestones: { live_at: null } }))).toThrow(/not live/);
    expect(() => factsFrom({ cards: [] })).toThrow(/not a card document/);
  });

  it('states each recorded step in order, in plain words', () => {
    expect(timelineRows(factsFrom(doc()))).toEqual([
      { label: 'Funded', value: '$0.78 from 3 players' },
      { label: 'Built', value: 'by an AI agent in 2 hours 5 minutes' },
      { label: 'Checked', value: 'passed every check' },
      { label: 'Live', value: '25 October 2026' },
      { label: 'Cost', value: '$0.42 of agent work' },
    ]);
  });

  it('leaves out a step the document does not record, and never says funded without players', () => {
    const rows = timelineRows(factsFrom(doc({ funding: null, spent_usd: 0, milestones: { started_at: null } })));
    expect(rows.map((r) => r.label)).toEqual(['Checked', 'Live']);
  });

  it('uses no dashes or exclamation marks', () => {
    for (const row of timelineRows(factsFrom(doc()))) expect(`${row.label} ${row.value}`).not.toMatch(/[!\u2013\u2014]| - /);
  });

  it('says a length of time plainly', () => {
    expect(span(60_000)).toBe('1 minute');
    expect(span(40 * 60_000)).toBe('40 minutes');
    expect(span(60 * 60_000)).toBe('1 hour');
    expect(span(26 * 60 * 60_000)).toBe('26 hours');
    expect(span(3 * 24 * 60 * 60_000)).toBe('3 days');
  });
});

describe('replay states', () => {
  it('shows at most two states that differ, earliest first', () => {
    expect(chooseStates(capture([0, 600, 3600]), capture([0, 600, 3600]), 1280, (s) => s !== 0)).toEqual([600, 3600]);
    expect(chooseStates(capture([0, 600, 3600, 21600]), capture([600, 3600, 21600]), 1280, () => true)).toEqual([600, 3600]);
  });

  it('refuses a pair where nothing differs, no state is shared or the width is missing', () => {
    expect(() => chooseStates(capture([600]), capture([600]), 1280, () => false)).toThrow(/nothing to show/);
    expect(() => chooseStates(capture([600]), capture([3600]), 1280, () => true)).toThrow(/share no state/);
    expect(() => chooseStates(capture([600], 390), capture([600]), 1280, () => true)).toThrow(/before capture has no 1280/);
  });
});

describe('replay clip', () => {
  it('runs 20 to 30 seconds, whether one state changed or two', () => {
    for (const states of [[600], [600, 3600]]) {
      const total = totalSeconds(slides(states));
      expect(total).toBeGreaterThanOrEqual(MIN_SECONDS);
      expect(total).toBeLessThanOrEqual(MAX_SECONDS);
    }
  });

  it('alternates before and after, showing one changed state twice', () => {
    expect(slides([600]).map((s) => s.kind)).toEqual(['title', 'before', 'after', 'before', 'after', 'timeline', 'end']);
    expect(slides([600, 3600]).flatMap((s) => ('state' in s ? [s.state] : []))).toEqual([600, 600, 3600, 3600]);
  });

  it('escapes the title and labels each picture', () => {
    const f = factsFrom(doc({ card: { title: 'Carts <b>& mills</b>' } }));
    const size = { width: 1280, height: 720 };
    expect(slideHtml({ kind: 'title', seconds: 3 }, f, size, 'data:font/woff2;base64,')).toContain('Carts &lt;b&gt;&amp; mills&lt;/b&gt;');
    expect(slideHtml({ kind: 'after', seconds: 3, state: 600 }, f, size, 'data:,', 'data:image/png;base64,')).toContain('>After</p>');
    expect(() => slideHtml({ kind: 'before', seconds: 3, state: 600 }, f, size, 'data:,')).toThrow(/needs its picture/);
  });

  it('holds the last slide for its time and quotes paths for ffmpeg', () => {
    expect(concatList([{ path: '/a/0.png', seconds: 3 }, { path: "/a/it's.png", seconds: 6 }])).toBe(
      "file '/a/0.png'\nduration 3\nfile '/a/it'\\''s.png'\nduration 6\nfile '/a/it'\\''s.png'\n",
    );
    expect(ffmpegArgs('list.txt', 'out.mp4')).toEqual(expect.arrayContaining(['-an', '+faststart', 'libx264']));
  });

  it("uses the site's tokens", () => {
    expect([INK, PAPER, MUTED, LIVE, SUIT]).toEqual([C.ink, C.paper, C.muted, C.live, C.suitGame]);
  });
});
