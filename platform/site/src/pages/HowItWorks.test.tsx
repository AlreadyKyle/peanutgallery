import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import type { Card, Snapshot, StudioSource } from '../lib/source';
import { SourceProvider } from '../lib/studio';
import { EXAMPLE_PAID_USD } from '../components/Funding';
import { exampleFee, exampleFromPaid, exampleSplit, STRIPE_EXAMPLE_FEE } from '../lib/payment';
import { formatUsd } from '../lib/format';
import { HowItWorks } from './HowItWorks';

const STRIPE = 'https://buy.stripe.com/test-link';
const page = copy.howItWorksPage;
const money = legal.howMoneyMoves;

function card(overrides: Partial<Card>): Card {
  return {
    id: 'c',
    title: 'A card',
    summary: null,
    intent: 'Edit the config.',
    source: 'board',
    stage: 'proposed',
    shape: 'goal',
    bucket: 'game',
    folder: 'seed-1',
    horizon: 'now',
    rank: null,
    executor_role_id: null,
    funding_target_usd: 3,
    funded_usd: 1,
    spent_usd: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    live_at: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    pool: null,
    cards: [],
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles: [],
    cardTitles: {},
    missing: [],
    ...overrides,
  };
}

function renderPage(source: StudioSource | null) {
  return render(
    <SourceProvider source={source}>
      <MemoryRouter>
        <HowItWorks />
      </MemoryRouter>
    </SourceProvider>,
  );
}

function sourceOf(value: Snapshot): StudioSource {
  return { load: () => Promise.resolve(value) };
}

function figures(): HTMLElement[] {
  return [...document.querySelectorAll('figure.example')] as HTMLElement[];
}

beforeEach(() => {
  vi.stubEnv('VITE_STRIPE_PAYMENT_LINK_URL', STRIPE);
  vi.stubEnv('VITE_PLAY_URL', 'https://play.example');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('How it works', () => {
  it('shows six steps, each beside a labelled example, then where the money goes, holds and refunds, the rules, who runs it and what code does', () => {
    renderPage(null);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([page.title]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      legal.explainer.heading,
      ...money.blocks.map((block) => block.heading),
      ...money.sections.map((section) => section.heading),
      page.rulesHeading,
      legal.whoRuns.heading,
      page.codeHeading,
    ]);
    expect(figures()).toHaveLength(6);
    for (const figure of figures()) expect(figure.querySelector('figcaption')?.textContent).toMatch(/^Example/);
    for (const rule of legal.fixedRules) expect(screen.getByText(rule)).toBeTruthy();
    expect(screen.getByText(legal.artPolicy)).toBeTruthy();
    // Holds and refunds links to the Refunds page.
    expect(screen.getByRole('link', { name: legal.refundsPageLink }).getAttribute('href')).toBe('/refunds');
  });

  it('says where money on no card waits, and the one case where it goes to a card that is not the next to open', () => {
    renderPage(null);
    const section = screen.getByRole('region', { name: 'Where the money goes' });
    const paragraph = within(section).getByText(/waits in Not on a card yet for the next card to open\./).textContent;
    expect(paragraph).toContain(legal.notOnCardTopUp);
    // The waterfall's order (docs/specs/money-logic.md): the next cards in line come before Not on a card yet.
    expect(paragraph).toMatch(/goes to the next cards in line, each up to its target\. What no card can take waits in Not on a card yet/);
    // The resume rule's numbers (docs/specs/agent-system-core.md): once, first ceiling pause, 1.5 times the cost so far.
    expect(legal.notOnCardTopUp).toMatch(/spending limit for the first time/);
    expect(legal.notOnCardTopUp).toMatch(/once, to spend up to 1\.5 times what it has cost so far/);
  });

  it('never renders a Payment Link, a fund button or a Play link, even with real open cards and the link set', async () => {
    const open = card({ id: '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', title: 'Real open card', funding_target_usd: 5, funded_usd: 2 });
    const live = card({ id: 'l1', title: 'Real shipped card', stage: 'live', live_at: '2026-09-15T00:00:00Z' });
    const { container } = renderPage(sourceOf(snapshot({ cards: [open, live] })));
    await waitFor(() => expect(screen.getByText('Real open card')).toBeTruthy());
    expect(container.innerHTML).not.toContain(STRIPE);
    expect(container.innerHTML).not.toContain('buy.stripe.com');
    expect(container.innerHTML).not.toContain('client_reference_id');
    expect(screen.queryByText(legal.fundThis)).toBeNull();
    expect(screen.queryByText(copy.playTheGame)).toBeNull();
    expect(container.querySelectorAll('figure.example a, figure.example button, figure.example details')).toHaveLength(0);
  });

  it('uses real public records where they exist and labels them, and made-up figures where none does', async () => {
    const open = card({ id: 'o1', title: 'Real open card' });
    const live = card({ id: 'l1', title: 'Real shipped card', stage: 'live', live_at: '2026-09-15T00:00:00Z' });
    renderPage(
      sourceOf(
        snapshot({
          cards: [open, live],
          events: [{ id: 'e1', card_id: 'o1', role_id: null, type: 'start', created_at: '2026-09-15T00:00:00Z' }],
          cardTitles: { o1: 'Real open card' },
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText('Real shipped card')).toBeTruthy());
    const labels = figures().map((figure) => figure.querySelector('figcaption')?.firstChild?.textContent);
    expect(labels).toEqual([
      page.exampleReal, // the real open card
      page.exampleMadeUp, // the split is worked arithmetic
      page.exampleMadeUp, // no card is queued
      page.exampleReal, // the real agent action
      page.exampleMadeUp, // no deploy yet
      page.exampleReal, // the real shipped card
    ]);
  });

  it('draws the made-up visuals from the example card when the studio has no data', () => {
    renderPage(null);
    expect(screen.getAllByRole('heading', { level: 3, name: page.exampleCard.title }).length).toBeGreaterThan(0);
    expect(figures().every((figure) => figure.querySelector('figcaption')?.textContent?.startsWith('Example'))).toBe(true);
  });

  it('works the split exactly as apply_contribution does', () => {
    expect(exampleSplit(10)).toEqual({ reserve: 1, remainder: 9, studio: 1.8, agents: 7.2, incident: 0.36, credit: 6.84 });
  });

  it('starts the example at $5.00 paid, with every figure from payment.ts and the fee labelled about (docs/specs/copy-pass.md)', () => {
    expect(EXAMPLE_PAID_USD).toBe(5);
    // The fee: Stripe Canada's 2.9% and 2% conversion on the amount, and CA$0.30 in US dollars.
    expect(STRIPE_EXAMPLE_FEE).toEqual({ pct: 2.9, conversionPct: 2, fixedUsd: 0.2121 });
    expect(exampleFee(5)).toBe(0.4571);
    expect(exampleFee(1)).toBe(0.2611);
    const worked = exampleFromPaid(5);
    expect(worked).toEqual({ paid: 5, fee: 0.4571, net: 4.5429, reserve: 0.4543, remainder: 4.0886, studio: 0.8177, agents: 3.2709, incident: 0.1635, credit: 3.1074 });
    // Nothing is lost or made up: the parts add back to what was paid.
    expect(Math.round((worked.fee + worked.reserve + worked.studio + worked.incident + worked.credit) * 10_000) / 10_000).toBe(5);
    renderPage(null);
    const example = figures()[1]!;
    expect(example.querySelector('figcaption')?.textContent).toBe(`${page.exampleMadeUp}${money.exampleCaption}`);
    expect(money.exampleCaption).toMatch(/^\$5\.00 paid/);
    const rows = [...example.querySelectorAll('.stat')].map((row) => [row.querySelector('.stat-label')?.textContent, row.querySelector('dd')?.textContent]);
    expect(rows).toEqual([
      [money.exampleRows.paid, formatUsd(worked.paid)],
      [money.exampleRows.fee, formatUsd(worked.fee)],
      [money.exampleRows.reserve, formatUsd(worked.reserve)],
      [money.exampleRows.studio, formatUsd(worked.studio)],
      [money.exampleRows.incident, formatUsd(worked.incident)],
      [money.exampleRows.credit, formatUsd(worked.credit)],
    ]);
    expect(rows.map(([, value]) => value)).toEqual(['$5.00', '$0.46', '$0.45', '$0.82', '$0.16', '$3.11']);
    expect(money.exampleRows.fee).toBe("Stripe's fee (about)");
    const notes = [...example.querySelectorAll('.stat-description')].map((note) => note.textContent);
    expect(notes).toContain("10% of the $4.54 left after Stripe's fee.");
    expect(notes).toContain('20% of the $4.09 left after the reserve.');
    expect(notes).toContain("5% of the agents' $3.27, until the fund holds $500.");
    // The fee names Stripe Canada's pricing: the rate, the fixed fee, conversion and the card surcharge.
    expect(money.exampleRows.feeNote).toMatch(/2\.9% plus CA\$0\.30.*2% to convert US dollars.*0\.8% more for a card from outside Canada/);
    // Then the waterfall's order, and no operations step.
    expect([...example.querySelectorAll('ol.example-order li')].map((li) => li.textContent)).toEqual([...money.exampleOrder]);
    expect(money.exampleOrder[0]).toMatch(/^The card the supporter picked/);
    expect(money.exampleOrder[1]).toMatch(/next cards in line/);
    expect(money.exampleOrder[2]).toMatch(/Not on a card yet/);
    expect(example.textContent).not.toMatch(/operations/i);
  });

  it('names the board, what it can do, what it files and its standing duties, and what code and the agents do (docs/specs/copy-pass.md)', () => {
    renderPage(null);
    const who = screen.getByRole('region', { name: legal.whoRuns.heading });
    const text = who.textContent ?? '';
    expect(text).toContain('Mob Machine is run by AI agents and a board: the people who run the studio and approve what gets built, today Kyle Smith.');
    expect(text).toMatch(/pause the agents, cancel, veto or move a card, and change the spending caps/);
    expect(text).toMatch(/The board files the cards: every entry on the roadmap and every card it opens for funding\./);
    // PLAN.md §4 The Board's standing duties, one item each.
    expect(within(who).getAllByRole('listitem')).toHaveLength(6);
    for (const duty of [/model credit/, /within 14 days/, /bank dispute/, /emergency fund/, /merge/, /price of each new model/]) expect(text).toMatch(duty);
    expect(within(who).getByRole('link', { name: legal.contactEmail }).getAttribute('href')).toBe(`mailto:${legal.contactEmail}`);
    const code = screen.getByRole('region', { name: page.codeHeading });
    expect(within(code).getAllByRole('listitem').map((li) => li.textContent)).toEqual([...page.code]);
    expect(code.textContent).toMatch(/dispatcher schedules the cards/);
    expect(code.textContent).toMatch(/gate runs the tests/);
    expect(code.textContent).toMatch(/goes live only when the gate passes it/);
    expect(code.textContent).toMatch(/rolled back/);
    expect(code.textContent).toMatch(/design, build and review the cards/);
    // No public list of the board's actions exists, so nothing says they are published.
    for (const region of [who, code]) expect(region.textContent).not.toMatch(/publish|public list|with (its|their) reasons?/i);
  });

  it('shows no paused notice while the board has paused the agents (decision 62)', async () => {
    renderPage(sourceOf(snapshot({ paused: true, pauseReason: 'incident' })));
    await screen.findAllByRole('heading', { level: 2 });
    expect(document.querySelector('p.notice')).toBeNull();
    expect(screen.queryByText(/The agents are paused/)).toBeNull();
  });
});
