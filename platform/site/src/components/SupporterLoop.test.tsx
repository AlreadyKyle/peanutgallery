import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { books } from '../lib/books.test-fixture';
import { changedLines, idName, plainCheck } from '../lib/config-words';
import { LAST_VISIT_KEY, readLastVisit, shippedSince, SINCE_LIMIT, writeLastVisit } from '../lib/last-visit';
import { legal } from '../lib/legal';
import type { Card, Snapshot } from '../lib/source';
import { currentStep } from '../pages/Thanks';
import { CardFace } from './Card';
import { closestToFunded, leftLine } from './Funding';
import { SinceLastVisit } from './SinceLastVisit';

// docs/specs/supporter-loop.md: the closest card's left note, the since-your-last-visit strip, What
// changed in plain words and /thanks's next step.

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c',
    title: 'A card',
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
    funding_target_usd: 3,
    funded_usd: 0,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

function snapshot(cards: Card[], order: string[] | null = cards.map((c) => c.id)): Snapshot {
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
    money: order === null ? null : books(order),
    missing: order === null ? ['money'] : [],
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('the closest card to fully funded', () => {
  const a = card({ id: 'a', funded_usd: 1, funding_target_usd: 3 });
  const b = card({ id: 'b', funded_usd: 2.25, funding_target_usd: 3 });
  const c = card({ id: 'c', funded_usd: 0, funding_target_usd: 1 });

  it('is the card in the order with the least left to raise', () => {
    expect(closestToFunded(snapshot([a, b, c]))).toBe('b');
  });

  it('takes the earlier card in the order on a tie, and skips a card outside the order or already full', () => {
    const d = card({ id: 'd', funded_usd: 2.25, funding_target_usd: 3 });
    expect(closestToFunded(snapshot([a, b, d], ['a', 'd', 'b']))).toBe('d');
    expect(closestToFunded(snapshot([a, b], ['a']))).toBe('a');
    const full = card({ id: 'f', funded_usd: 3, funding_target_usd: 3 });
    expect(closestToFunded(snapshot([full, a]))).toBe('a');
  });

  it('is none when the order did not load', () => {
    expect(closestToFunded(snapshot([a, b], null))).toBeNull();
  });

  it('says what is left as a plain fact, on that card only', () => {
    expect(leftLine(b)).toBe('$0.75 left to fund it.');
    const shot = snapshot([a, b]);
    const { container } = render(
      <MemoryRouter>
        <ul>
          <CardFace card={a} snapshot={shot} />
          <CardFace card={b} snapshot={shot} />
        </ul>
      </MemoryRouter>,
    );
    const notes = container.querySelectorAll('[data-note="left"]');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.closest('li')!.getAttribute('data-card')).toBe('b');
    expect(notes[0]!.textContent).toBe('$0.75 left to fund it.');
  });

  it('carries no countdown, deadline or bonus words', () => {
    expect(legal.leftToFund).not.toMatch(/hurry|only|soon|ends|hours?|minutes?|days?|bonus|extra|now|last chance/i);
  });
});

describe('since your last visit', () => {
  function store(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      data,
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
  }
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };

  it('reads nothing on a first visit, a bad value or blocked storage, and writes the visit', () => {
    expect(readLastVisit(store())).toBeNull();
    expect(readLastVisit(store({ [LAST_VISIT_KEY]: 'not a date' }))).toBeNull();
    expect(readLastVisit(throwing)).toBeNull();
    expect(readLastVisit(null)).toBeNull();
    expect(() => writeLastVisit(throwing, new Date())).not.toThrow();
    const s = store();
    writeLastVisit(s, new Date('2026-10-01T00:00:00Z'));
    expect(readLastVisit(s)).toBe(Date.parse('2026-10-01T00:00:00Z'));
  });

  const since = Date.parse('2026-10-01T00:00:00Z');
  const old = card({ id: 'old', stage: 'live', live_at: '2026-09-30T00:00:00Z', title: 'Old' });
  const fresh = card({ id: 'fresh', stage: 'live', live_at: '2026-10-02T00:00:00Z', title: 'Fresh' });
  const newer = card({ id: 'newer', stage: 'live', live_at: '2026-10-03T00:00:00Z', title: 'Newer' });
  const building = card({ id: 'b', stage: 'building', updated_at: '2026-10-03T00:00:00Z' });

  it('lists live cards shipped after the last visit, newest first, and none on a first visit', () => {
    expect(shippedSince([old, fresh, newer, building], since).map((c) => c.id)).toEqual(['newer', 'fresh']);
    expect(shippedSince([old, fresh, newer], null)).toEqual([]);
    const many = Array.from({ length: SINCE_LIMIT + 2 }, (_, i) => card({ id: `m${i}`, stage: 'live', live_at: `2026-10-0${i + 2}T00:00:00Z` }));
    expect(shippedSince(many, since)).toHaveLength(SINCE_LIMIT);
  });

  it('links each card to its own page, and draws nothing when none shipped', () => {
    const { container } = render(
      <MemoryRouter>
        <SinceLastVisit cards={[old, fresh]} since={since} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Since your last visit' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fresh' }).getAttribute('href')).toBe('/card/fresh');
    expect(container.querySelectorAll('li')).toHaveLength(1);
    cleanup();
    const empty = render(
      <MemoryRouter>
        <SinceLastVisit cards={[old]} since={since} />
      </MemoryRouter>,
    );
    expect(empty.container.innerHTML).toBe('');
    cleanup();
    const first = render(
      <MemoryRouter>
        <SinceLastVisit cards={[fresh]} since={null} />
      </MemoryRouter>,
    );
    expect(first.container.innerHTML).toBe('');
  });
});

describe('What changed in plain words', () => {
  it('reads the game config paths it knows', () => {
    expect(plainCheck({ file: 'seed-1/config/spawn-table.json', path: 'rows[id=mill].baseCost', value: '1500' })).toBe('Mill costs 1500 dust to build.');
    expect(plainCheck({ file: 'seed-1/config/spawn-table.json', path: 'rows[id=cart].rate', value: '2' })).toBe('Each Cart makes 2 dust a second.');
    expect(plainCheck({ file: 'seed-1/config/game.json', path: 'buildings[id=gatherer].name', value: '"Sweeper"' })).toBe(
      'Gatherer is now called "Sweeper".',
    );
    expect(plainCheck({ file: 'seed-1/config/unlocks.json', path: 'unlocks[id=sharper-tools].atTotalDust', value: '400000' })).toBe(
      'Sharper tools unlocks at 400000 total dust.',
    );
    expect(idName('wider-paths')).toBe('Wider paths');
  });

  it('counts anything else, or a value it cannot show, instead of showing the raw path', () => {
    const plain = { file: 'seed-1/config/game.json', path: 'buildings[id=gatherer].baseCost', value: '12' };
    const raw = [
      { file: 'seed-1/config/game.json', path: 'unlocks[0].labels', value: null },
      { file: 'x.json', path: 'rows[id=mill].colour', value: '"red"' },
      { file: 'x.json', path: 'rows[id=mill].baseCost', value: null },
    ];
    expect(changedLines([plain])).toEqual({ lines: ['Gatherer costs 12 dust to build.'], rest: null });
    expect(changedLines([plain, raw[0]!])).toEqual({ lines: ['Gatherer costs 12 dust to build.'], rest: "And 1 more value in the game's settings." });
    expect(changedLines([plain, ...raw])).toEqual({ lines: ['Gatherer costs 12 dust to build.'], rest: "And 3 more values in the game's settings." });
    expect(changedLines([raw[0]!])).toEqual({ lines: [], rest: "1 value in the game's settings changed." });
    expect(changedLines(raw)).toEqual({ lines: [], rest: "3 values in the game's settings changed." });
  });

  it('counts, never throws on, a collection or field named like an Object.prototype key', () => {
    const odd = ['constructor[id=mill].name', 'rows[id=mill].toString', 'rows[id=mill].constructor'].map((path) => ({ file: 'x.json', path, value: '1' }));
    expect(changedLines(odd)).toEqual({ lines: [], rest: "3 values in the game's settings changed." });
  });

  it('shows a value with $ characters as written, not as a replacement pattern', () => {
    expect(plainCheck({ file: 'seed-1/config/game.json', path: 'buildings[id=gatherer].name', value: '"$& Mill"' })).toBe('Gatherer is now called "$& Mill".');
  });
});

describe("/thanks's next step", () => {
  it('maps a stage to drafting, building, the gate or live, and an open card to none', () => {
    expect(currentStep('funded')).toBe('drafting');
    expect(currentStep('building')).toBe('building');
    expect(currentStep('gated')).toBe('gate');
    expect(currentStep('live')).toBe('live');
    expect(currentStep('proposed')).toBeNull();
    expect(currentStep(undefined)).toBeNull();
  });
});
