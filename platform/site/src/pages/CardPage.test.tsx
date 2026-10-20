import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CardStamp } from '../components/Funding';
import { detailDoc } from '../lib/card-detail.test-fixture';
import { cardDetailFrom, type Milestones } from '../lib/card-source';
import { copy } from '../lib/copy';
import { formatClock, formatDateTime } from '../lib/format';
import { buildClock, commitLine, liveWhen, playFromCard } from './CardPage';

// The card page's state line: a shipped card's stamp and a building or checks card's build clock.

const milestones = (fields: Partial<Milestones>): Milestones => ({
  created_at: '2026-09-21T09:00:00Z',
  started_at: null,
  gate_at: null,
  gate: null,
  live_at: null,
  ...fields,
});

describe('liveWhen', () => {
  it('says how long after work started the card went live, with both times in the reader\'s own time', () => {
    const start = '2026-09-21T14:02:00Z';
    const live = '2026-09-21T15:10:00Z';
    expect(liveWhen(milestones({ started_at: start, live_at: live }))).toBe(
      `Live 68 minutes after work started, ${formatClock(new Date(start))} to ${formatClock(new Date(live))}`,
    );
  });

  it('says 1 minute in the singular', () => {
    expect(liveWhen(milestones({ started_at: '2026-09-21T14:00:00Z', live_at: '2026-09-21T14:00:40Z' }))).toMatch(/^Live 1 minute after work started, /);
  });

  it('writes the dates when the two times fall on different days', () => {
    const start = '2026-09-21T12:00:00Z';
    const live = '2026-09-23T12:00:00Z';
    expect(liveWhen(milestones({ started_at: start, live_at: live }))).toBe(
      `Live 2,880 minutes after work started, ${formatDateTime(start)} to ${formatDateTime(live)}`,
    );
  });

  it('is null until both a start and a live time are recorded, or when live comes before the start', () => {
    expect(liveWhen(milestones({ live_at: '2026-09-21T15:10:00Z' }))).toBeNull();
    expect(liveWhen(milestones({ started_at: '2026-09-21T14:02:00Z' }))).toBeNull();
    expect(liveWhen(milestones({ started_at: '2026-09-21T15:10:00Z', live_at: '2026-09-21T14:02:00Z' }))).toBeNull();
  });
});

describe('buildClock', () => {
  const start = '2026-09-21T14:02:00Z';
  const at = (iso: string) => Date.parse(iso);

  it('counts whole minutes since work started, rounded down, on a building or checks card', () => {
    expect(buildClock('building', start, at('2026-09-21T14:44:59Z'))).toBe('Building, 42 min in');
    expect(buildClock('gated', start, at('2026-09-21T15:02:00Z'))).toBe('Being checked, 60 min in');
    expect(buildClock('building', start, at('2026-09-21T14:02:30Z'))).toBe('Building, 0 min in');
    expect(buildClock('building', start, at('2026-09-22T14:02:00Z'))).toBe('Building, 1,440 min in');
  });

  it('never shows seconds, hours or a countdown', () => {
    for (const template of Object.values(copy.cardPage.buildClock)) expect(template).not.toMatch(/sec|hour|left|remaining/i);
  });

  it('is null on any other stage, before work started, or for a start in the future', () => {
    for (const stage of ['proposed', 'funded', 'live', 'paused', 'rejected']) expect(buildClock(stage, start, at('2026-09-21T15:00:00Z'))).toBeNull();
    expect(buildClock('building', null, at('2026-09-21T15:00:00Z'))).toBeNull();
    expect(buildClock('building', start, at('2026-09-21T14:00:00Z'))).toBeNull();
  });
});

describe('CardStamp (Funding.tsx, kernel)', () => {
  afterEach(() => {
    cleanup();
  });

  it('adds the cost row\'s own figure to the time words', () => {
    const { container } = render(<CardStamp detail={cardDetailFrom(detailDoc())} when="Live 40 minutes after work started, 14:00 to 14:40" />);
    expect(container.querySelector('[data-fact="stamp"]')?.textContent).toBe('Live 40 minutes after work started, 14:00 to 14:40, cost $0.42');
  });

  it('leaves the cost out on a card that cost nothing, as its shipped caption does', () => {
    const { container } = render(<CardStamp detail={cardDetailFrom(detailDoc({ spent_usd: '0' }))} when="Live 2 minutes after work started, 14:00 to 14:02" />);
    expect(container.querySelector('[data-fact="stamp"]')?.textContent).toBe('Live 2 minutes after work started, 14:00 to 14:02');
  });
});

describe('playFromCard', () => {
  it("tags Dust's address as reached from a card page", () => {
    expect(playFromCard('https://play.mobmachine.games')).toBe('https://play.mobmachine.games/?from=card');
  });

  it('is null when the site has no play address', () => {
    expect(playFromCard('')).toBeNull();
  });
});

describe('commitLine', () => {
  it('says a shipped card was merged, and a stopped card was rolled back', () => {
    expect(commitLine(cardDetailFrom(detailDoc()))).toBe(copy.cardPage.merged);
    const stopped = {
      card_id: '00000000-0000-4000-8000-000000000004',
      title: 'A cheaper Cart',
      stage: 'rejected',
      failing_check: null,
      spent_usd: '0.4200',
      funded_usd: '3.0000',
      credited_usd: '3.0000',
      moved: [],
      stopped_at: '2026-09-15T02:00:00Z',
    };
    const card = { ...(detailDoc().card as Record<string, unknown>), stage: 'rejected', live_at: null };
    const line = commitLine(cardDetailFrom(detailDoc({ card, stopped })));
    expect(line).toBe(copy.cardPage.rolledBack);
    expect(line).toMatch(/^Rolled back/);
    expect(line).not.toMatch(/merged/i);
  });
});
