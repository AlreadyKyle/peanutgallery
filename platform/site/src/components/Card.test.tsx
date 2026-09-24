import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryOf, FACES, type Face } from '../lib/cards';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { books } from '../lib/books.test-fixture';
import { canFund } from '../lib/payment';
import type { Card, Snapshot } from '../lib/source';
import { CardFace } from './Card';
import { Glyph, GLYPH_NAMES, STATE_TAGS, SUITS } from './Glyph';

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
    funded_usd: 1.5,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

/** The cards a goal bar still has room on stand in for the waterfall's order, unless a test names the order. */
function snapshot(cards: Card[], funding: Snapshot['funding'] = {}, order: string[] = cards.filter(canFund).map((c) => c.id)): Snapshot {
  return {
    pool: null,
    cards,
    funding,
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    money: books(order),
    missing: [],
  };
}

function one(c: Card, props: Partial<Parameters<typeof CardFace>[0]> = {}): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <ul>
        <CardFace card={c} snapshot={snapshot([c], { [c.id]: { contributors: 2, credited_usd: 1.5 } })} {...props} />
      </ul>
    </MemoryRouter>,
  );
  return container.querySelector('li.card') as HTMLElement;
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', 'https://buy.stripe.com/test-link');
  vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('suits, from data', () => {
  // A fixture of both folders a card can change: the game and the studio's own site.
  const FOLDERS = ['seed-1', 'platform'];

  it('gives each of the two folders a suit with a label, and no two suits share a glyph', () => {
    const suits = FOLDERS.map((folder) => SUITS[categoryOf(card({ folder }))]);
    expect(suits.map((suit) => suit.label)).toEqual([copy.categories.game, copy.categories.studio]);
    for (const suit of suits) expect(suit.label.trim()).not.toBe('');
    expect(new Set(suits.map((suit) => suit.glyph)).size).toBe(suits.length);
    expect(Object.keys(SUITS).sort()).toEqual(['game', 'studio']);
  });

  it('draws the suit at the start of the index row, with its glyph', () => {
    const box = one(card({ folder: 'platform', title: 'Studio card' }));
    const suit = box.querySelector('.card-index [data-suit]')!;
    expect(suit.getAttribute('data-suit')).toBe('studio');
    expect(suit.textContent).toBe(copy.categories.studio);
    expect(suit.querySelector('svg')?.getAttribute('data-glyph')).toBe('browser');
    expect(suit.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the cartridge only for the game suit and Play buttons', () => {
    const uses = Object.values(SUITS).filter((suit) => suit.glyph === 'cartridge');
    expect(uses).toEqual([SUITS.game]);
    expect(Object.values(STATE_TAGS).some((tag) => tag.glyph === 'cartridge')).toBe(false);
  });
});

describe('the card faces', () => {
  const STAGE: Record<Exclude<Face, 'paused' | 'rejected'>, string> = {
    open: 'proposed',
    picked: 'voted',
    funded: 'funded',
    building: 'building',
    checks: 'gated',
    live: 'live',
  };

  it('renders each state as its word and its own glyph, on the face its stage gives', () => {
    for (const face of FACES) {
      const staged = face === 'paused' || face === 'rejected' ? card() : card({ stage: STAGE[face] });
      const box = one(staged, face === 'paused' || face === 'rejected' ? { face, mode: 'sample' } : {});
      expect(box.getAttribute('data-face'), face).toBe(face);
      const tag = box.querySelector('.card-index [data-state]')!;
      expect(tag.textContent, face).toBe(STATE_TAGS[face].word);
      expect(tag.querySelector('svg')?.getAttribute('data-glyph'), face).toBe(STATE_TAGS[face].glyph);
      cleanup();
    }
    expect(FACES.map((face) => STATE_TAGS[face].word)).toEqual([
      copy.statusOpen,
      copy.statusPicked,
      copy.statusFunded,
      copy.statusBuilding,
      copy.statusGated,
      copy.statusLive,
      copy.statusPaused,
      copy.statusRejected,
    ]);
  });

  it('gives every state glyph a drawing of its own at 16px', () => {
    const drawings = FACES.map((face) => {
      const { container } = render(<Glyph name={STATE_TAGS[face].glyph} />);
      const svg = container.querySelector('svg')!;
      expect([svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox')]).toEqual(['16', '16', '0 0 16 16']);
      const inner = svg.innerHTML;
      cleanup();
      return inner;
    });
    expect(new Set(drawings).size).toBe(FACES.length);
    expect(new Set(GLYPH_NAMES).size).toBe(GLYPH_NAMES.length);
  });

  it('draws every glyph in currentColor, with no colour of its own', () => {
    for (const name of GLYPH_NAMES) {
      const { container } = render(<Glyph name={name} />);
      expect(container.innerHTML, name).not.toMatch(/#[0-9a-f]{3,6}|rgb\(|fill="|stroke="/i);
      cleanup();
    }
  });

  it('shows the bar, the spec rows and Fund this card on an open card, with the button described by the title', () => {
    const box = one(card({ id: 'o', title: 'Open one' }));
    expect(within(box).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1.5');
    const rows = [...box.querySelectorAll('.spec-rows > div')].map((row) => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]);
    expect(rows).toEqual([
      [legal.fundedLabel, '$1.50 of $3.00'],
      [legal.contributorsLabel, '2'],
    ]);
    const fund = within(box).getByRole('link', { name: legal.fundThis });
    expect(fund.getAttribute('href')).toBe('https://buy.stripe.com/test-link?client_reference_id=o');
    expect(fund.getAttribute('aria-describedby')).toBe(within(box).getByRole('heading', { level: 3 }).id);
    expect(box.querySelector('.funding-bar-fill')?.getAttribute('style')).toContain('--fill: 50%');
  });

  it('states the agreement under every live Fund this card link, with the Terms, the Refunds page and the age condition', () => {
    const box = one(card({ id: 'o', title: 'Open one' }));
    const fund = within(box).getByRole('link', { name: legal.fundThis });
    const agreement = fund.nextElementSibling as HTMLElement;
    expect(agreement.tagName).toBe('P');
    expect(agreement.textContent).toBe(legal.fundAgreement.replace('{terms}', legal.footerLinks.terms).replace('{refunds}', legal.refundsPageLink));
    expect(agreement.textContent).toMatch(/adult or have a guardian's permission/);
    expect(within(agreement).getByRole('link', { name: legal.footerLinks.terms }).getAttribute('href')).toBe('/terms');
    expect(within(agreement).getByRole('link', { name: legal.refundsPageLink }).getAttribute('href')).toBe('/refunds');
  });

  it('draws no agreement on a sample or example card, which links nowhere, nor on a card with no Payment Link', () => {
    for (const mode of ['sample', 'example'] as const) {
      const box = one(card(), { mode });
      expect(box.textContent, mode).not.toContain(legal.fundAgreement.slice(0, 20));
      expect(within(box).queryByRole('link'), mode).toBeNull();
      cleanup();
    }
    vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', '');
    const box = one(card());
    expect(box.textContent).not.toContain(legal.fundAgreement.slice(0, 20));
  });

  it('draws no fill for an empty bar, so a zero never shows as a sliver', () => {
    const box = one(card({ funded_usd: 0 }));
    expect(box.querySelector('.funding-bar-fill')).toBeNull();
  });

  it('puts "Waiting for the agents" in the button slot of a funded card, with no link', () => {
    const box = one(card({ stage: 'funded', funded_usd: 3 }));
    expect(within(box).getByText(copy.waitingForAgents).className).toBe('card-waiting');
    expect(within(box).queryByRole('link')).toBeNull();
  });

  it('names the agent building a card and what it has spent, on the work face with no bar', () => {
    const building = card({ stage: 'building', spent_usd: 0.42, executor_role_id: 'r1' });
    const { container } = render(
      <MemoryRouter>
        <ul>
          <CardFace
            card={building}
            snapshot={{
              ...snapshot([building]),
              roles: [{ id: 'r1', name: 'Builder A', title: 'Builder A', description: null, species_note: '', model: '', write_access: true, state: 'active', hired_at: '' }],
            }}
          />
        </ul>
      </MemoryRouter>,
    );
    // The building face links its own page (docs/specs/supporter-pages.md).
    expect(screen.getByRole('link', { name: copy.cardPage.watchBuilt }).getAttribute('href')).toBe(`/card/${building.id}`);
    expect(screen.getByText(`${copy.buildingBy.replace('{name}', 'Builder A')} · $0.42 ${legal.spentSoFar}`)).toBeTruthy();
    expect(container.querySelector('li.card')?.getAttribute('data-face')).toBe('building');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('turns the Live tag into the stamp only when asked, and offers Play the game on a Dust card', () => {
    const live = card({ stage: 'live', shape: 'oneoff', funding_target_usd: 0, live_at: '2026-09-15T10:00:00Z' });
    let box = one(live);
    expect(box.querySelector('.tag-stamp')).toBeNull();
    expect(within(box).getByRole('link', { name: copy.playTheGame }).getAttribute('href')).toBe('https://play.example');
    cleanup();
    box = one(live, { stamp: true });
    expect(box.querySelector('.tag-stamp')?.textContent).toBe(copy.statusLive);
  });

  it('says where a rejected card\'s money went', () => {
    const box = one(card({ shape: 'oneoff', funding_target_usd: 0 }), { face: 'rejected', reason: 'Sample reason.', mode: 'sample' });
    expect(within(box).getByText('Sample reason.')).toBeTruthy();
    expect(within(box).getByText(legal.notBuiltMoney)).toBeTruthy();
  });

  it('draws the Fund button in sample mode as an unavailable button that links nowhere', () => {
    const box = one(card(), { mode: 'sample' });
    expect(within(box).queryByRole('link')).toBeNull();
    expect(within(box).getByRole('button', { name: legal.fundThis }).getAttribute('aria-disabled')).toBe('true');
    expect(box.innerHTML).not.toContain('client_reference_id');
  });

  it('marks a changed spec row with the change rule', () => {
    const box = one(card(), { changed: ['funded'] });
    expect(box.querySelector('[data-row="funded"]')?.className).toBe('changed');
    expect(box.querySelector('[data-row="contributors"]')?.className ?? '').toBe('');
  });
});

describe('the AI-agent byline (docs/specs/agent-workflows.md)', () => {
  const designer = { id: 'r-designer', name: 'Game Designer', title: 'Game Designer', description: null, species_note: 'A small red creature.', model: 'claude-opus-5-5', write_access: true, state: 'active', hired_at: '2026-09-14T00:00:00Z' };

  function face(c: Card, roles: Snapshot['roles']): HTMLElement {
    const snap = { ...snapshot([c], { [c.id]: { contributors: 0, credited_usd: 0 } }), roles };
    const { container } = render(
      <MemoryRouter>
        <ul>
          <CardFace card={c} snapshot={snap} />
        </ul>
      </MemoryRouter>,
    );
    return container.querySelector('li.card')!;
  }

  it('says which role wrote an agent card, under its summary, with the title from the roles loaded', () => {
    const li = face(card({ source: 'agent', summary: 'The gatherer costs one more.', drafter_role_id: 'r-designer' }), [designer]);
    const byline = li.querySelector('.card-byline');
    expect(byline?.textContent).toBe('Written by the Game Designer, an AI agent');
    expect(li.querySelector('.card-summary')?.nextElementSibling).toBe(byline);
  });

  it('says an AI agent wrote it when the roles did not load, and nothing on a card the board filed', () => {
    expect(face(card({ source: 'agent', drafter_role_id: 'r-designer' }), []).querySelector('.card-byline')?.textContent).toBe(copy.writtenByAgent);
    cleanup();
    const board = face(card({ source: 'board', summary: 'Filed by the board.', drafter_role_id: null }), [designer]);
    expect(board.querySelector('.card-byline')).toBeNull();
    expect(board.textContent).not.toContain('AI agent');
  });
});
