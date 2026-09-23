import type { Page } from '@playwright/test';
import { PAYMENT_LINK } from './fixture-env';
import { DEFAULT_STUDIO, expect, fundingOrder, moneyRow, overflowsHorizontally, test, type StudioFixture } from './fixtures';

// The money surfaces (docs/specs/money-surfaces.md): /contribute's choices are the waterfall's order,
// /ledger shows money in, the reconciliation, Not on a card yet, the shortfall, the board's test
// payment and the stopped cards, and a read that fails says so instead of showing a figure.

const [RENAME, QUIET, CART] = DEFAULT_STUDIO.cards as Record<string, unknown>[];
const REFUNDED = { ...CART!, id: '00000000-0000-4000-8000-000000000901', title: 'A card a refund left below its target', stage: 'funded', funded_usd: '2.5000' };
const VETOED = { ...RENAME!, id: '00000000-0000-4000-8000-000000000902', title: 'A card the board vetoed', stage: 'proposed', funded_usd: '0.0000' };

function studio(fields: Partial<StudioFixture> = {}, money: Record<string, unknown> = {}): StudioFixture {
  return { ...DEFAULT_STUDIO, ...fields, money: moneyRow({ ...(DEFAULT_STUDIO.money ?? {}), ...money }) };
}

async function ledgerLine(page: Page, text: string) {
  return page.getByRole('main').getByText(text, { exact: true });
}

test.describe('/contribute follows the funding order', () => {
  test.use({
    studio: {
      ...DEFAULT_STUDIO,
      cards: [...DEFAULT_STUDIO.cards, REFUNDED, VETOED],
      money: moneyRow({ ...DEFAULT_STUDIO.money, funding_order: fundingOrder([REFUNDED.id, QUIET!.id, RENAME!.id]) }),
    },
  });

  test('names the next card in line first, offers exactly the ordered cards with their ids, and the waterfall line under them', async ({ page }) => {
    await page.goto('/contribute');
    const main = page.getByRole('main');
    const first = main.locator('a.choice').first();
    await expect(first).toHaveClass(/choice-primary/);
    await expect(first).toHaveText(`Fund the next card in lineNext in line: ${REFUNDED.title}`);
    await expect(first).toHaveAttribute('href', PAYMENT_LINK);
    const choices = main.locator('ul.choices a.choice');
    await expect(choices).toHaveCount(3);
    expect(await choices.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([
      `${PAYMENT_LINK}?client_reference_id=${REFUNDED.id}`,
      `${PAYMENT_LINK}?client_reference_id=${QUIET!.id}`,
      `${PAYMENT_LINK}?client_reference_id=${RENAME!.id}`,
    ]);
    await expect(main.getByText(String(VETOED.title))).toHaveCount(0);
    await expect(main.locator('ul.choices + p')).toHaveText("Anything beyond a card's target funds the next cards in line.");
    expect(await overflowsHorizontally(page)).toBe(false);
  });

  test('counts and draws on home only the open cards in the order, each with its live Fund this card', async ({ page }) => {
    await page.goto('/');
    const fund = page.getByRole('region', { name: "Fund what's next" });
    await expect(fund.getByRole('heading', { level: 3 })).toHaveCount(2);
    // The vetoed card takes no money: it is not counted as open, and not drawn without a button among
    // cards that have one (that misaligns the row's bars).
    await expect(page.getByRole('main').getByText(String(VETOED.title))).toHaveCount(0);
    await expect(page.locator('p.status-line')).toHaveText(/^2 cards are open for funding\./);
    const links = await fund.getByRole('link', { name: 'Fund this card' }).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(links.sort()).toEqual([`${PAYMENT_LINK}?client_reference_id=${QUIET!.id}`, `${PAYMENT_LINK}?client_reference_id=${RENAME!.id}`].sort());
  });
});

test.describe('/contribute with an empty order', () => {
  test.use({ studio: studio({}, { funding_order: [] }) });

  test('says the money waits in Not on a card yet, and offers no card', async ({ page }) => {
    await page.goto('/contribute');
    const main = page.getByRole('main');
    await expect(main.locator('a.choice-primary')).toContainText('Your contribution waits in Not on a card yet and funds the next card that opens.');
    await expect(main.locator('ul.choices')).toHaveCount(0);
    await expect(main.locator(`a[href^="${PAYMENT_LINK}"]`)).toHaveCount(1);
    // Home agrees: no card is open for funding, and Fund what's next draws none.
    await page.goto('/');
    await expect(page.locator('p.status-line')).toHaveText(/^No card is open for funding right now\./);
    await expect(page.getByRole('region', { name: "Fund what's next" }).locator('li.card')).toHaveCount(0);
  });
});

test.describe('when public_money and public_stopped_cards fail', () => {
  test.use({ studio: { ...DEFAULT_STUDIO, money: null, stopped: null } });

  test('/contribute offers only Fund the next card in line, naming no card, and home draws no Fund this card', async ({ page }) => {
    await page.goto('/contribute');
    const main = page.getByRole('main');
    await expect(main.getByText('Not available right now.')).toBeVisible();
    await expect(main.locator('a.choice-primary')).toHaveText('Fund the next card in lineYour contribution funds whatever the agents build next.');
    await expect(main.locator(`a[href^="${PAYMENT_LINK}"]`)).toHaveCount(1);
    await page.goto('/');
    await expect(page.getByRole('region', { name: "Fund what's next" }).getByRole('heading', { level: 3 }).first()).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Fund this card' })).toHaveCount(0);
  });

  test('/ledger says Not available right now. for each part those reads feed', async ({ page }) => {
    await page.goto('/ledger');
    const funding = page.getByRole('region', { name: 'Funding' });
    // Stacked under its label as a muted line, never in the figure's place (Stat.tsx).
    await expect(funding.locator('.stat.stat-unavailable', { hasText: 'Not on a card yet' }).locator('dd')).toHaveText('Not available right now.');
    const moneyIn = page.getByRole('region', { name: 'Money in' });
    await expect(moneyIn.getByText('Not available right now.')).toBeVisible();
    await expect(moneyIn.locator('.stat')).toHaveCount(0);
    await expect(moneyIn.getByText(/reconciled with Stripe/i)).toHaveCount(0);
    const stopped = page.getByRole('region', { name: 'Stopped cards' });
    await expect(stopped.getByText('Not available right now.')).toBeVisible();
  });
});

test.describe('/ledger Money in', () => {
  test('shows the eight figures, each described, with the count of payments, and one reconciliation line', async ({ page }) => {
    await page.goto('/ledger');
    const moneyIn = page.getByRole('region', { name: 'Money in' });
    await expect(moneyIn.locator('.stat .stat-label')).toHaveText([
      'Received',
      'Stripe fees',
      'Refunded',
      'Disputed',
      'To the reserve',
      'To the studio',
      'To the emergency fund',
      'Agent credit',
    ]);
    await expect(moneyIn.locator('.stat dd')).toHaveText(['$12.00', '$1.40', '$0.00', '$0.00', '$1.06', '$1.91', '$0.38', '$7.25']);
    for (const description of await moneyIn.locator('.stat').evaluateAll((rows) => rows.map((row) => row.querySelector('.stat-description')?.textContent ?? ''))) {
      expect(description).not.toBe('');
    }
    await expect(moneyIn.getByText('from 4 contributions')).toBeVisible();
    await expect(moneyIn.getByText('At checkout they chose 20% on average, weighted by amount, and the default is 20%.', { exact: false })).toBeVisible();
    await expect(moneyIn.getByText(/reconciled with Stripe/i)).toHaveText(['Not yet reconciled with Stripe.']);
  });

  for (const [label, fields, line] of [
    ['never run', { last_run_ok: null, reconciled_at: null }, 'Not yet reconciled with Stripe.'],
    ['failed', { last_run_ok: false, reconciled_at: null }, 'Not yet reconciled with Stripe.'],
    ['passed', { last_run_ok: true, reconciled_at: '2026-09-23T04:00:00Z' }, 'Reconciled with Stripe on 23 Sep 2026.'],
  ] as const) {
    test.describe(`a reconcile that ${label}`, () => {
      test.use({ studio: studio({}, fields) });
      test(`shows exactly "${line}"`, async ({ page }) => {
        await page.goto('/ledger');
        await expect(page.getByRole('main').getByText(/reconciled with Stripe/i)).toHaveText([line]);
      });
    });
  }

  test.describe('with no payments', () => {
    test.use({ studio: studio({}, { payments: 0, received_usd: '0', stripe_fees_usd: '0', reserve_usd: '0', studio_usd: '0', incident_usd: '0', agent_credit_usd: '0', studio_pct_avg: null }) });
    test('says No contributions yet. in place of the figures', async ({ page }) => {
      await page.goto('/ledger');
      const moneyIn = page.getByRole('region', { name: 'Money in' });
      await expect(moneyIn.getByText('No contributions yet.')).toBeVisible();
      await expect(moneyIn.locator('.stat')).toHaveCount(0);
      await expect(moneyIn.getByText(/reconciled with Stripe/i)).toHaveCount(1);
    });
  });

  test.describe('with held money, a correction and no average split', () => {
    test.use({ studio: studio({}, { held_usd: '0.5000', corrections_usd: '-0.2000', studio_pct_avg: null }) });
    test('shows held money and corrections, and leaves the average split out', async ({ page }) => {
      await page.goto('/ledger');
      const moneyIn = page.getByRole('region', { name: 'Money in' });
      await expect(moneyIn.locator('.stat .stat-label')).toHaveText([
        'Received',
        'Stripe fees',
        'Refunded',
        'Disputed',
        'Corrections',
        'To the reserve',
        'To the studio',
        'To the emergency fund',
        'Held for 14 days',
        'Agent credit',
      ]);
      await expect(moneyIn.getByText(/on average/)).toHaveCount(0);
    });
  });
});

test.describe('/ledger Funding: Not on a card yet, the shortfall and the board test payment', () => {
  test('shows Not on a card yet always, and no shortfall or test payment line at zero', async ({ page }) => {
    await page.goto('/ledger');
    const funding = page.getByRole('region', { name: 'Funding' });
    await expect(funding.locator('.stat', { hasText: 'Not on a card yet' }).locator('dd')).toHaveText('$0.30');
    await expect(funding.getByText(/short by/)).toHaveCount(0);
    await expect(funding.getByText(/test payment/)).toHaveCount(0);
  });

  test.describe('short, with the board test payment', () => {
    test.use({ studio: studio({}, { not_on_card_usd: '0.0000', short_usd: '0.4500', board_test_usd: '0.5019' }) });
    test('says waiting cards are short, and names the test payment', async ({ page }) => {
      await page.goto('/ledger');
      const funding = page.getByRole('region', { name: 'Funding' });
      await expect(funding.locator('.stat', { hasText: 'Not on a card yet' }).locator('dd')).toHaveText('$0.00');
      await expect(await ledgerLine(page, 'Waiting cards are short by $0.45 until new money arrives.')).toBeVisible();
      await expect(await ledgerLine(page, "The pool includes $0.50 of the board's own test payment; it funds no card.")).toBeVisible();
    });
  });
});

test.describe('/ledger Stopped cards', () => {
  const paused = {
    card_id: '00000000-0000-4000-8000-000000000911',
    title: 'A card that paused',
    stage: 'paused',
    failing_check: 'ceiling',
    spent_usd: '0.4200',
    funded_usd: '2.0000',
    credited_usd: '2.0000',
    moved: [],
    stopped_at: '2026-09-22T18:00:00Z',
  };
  const rejected = {
    card_id: '00000000-0000-4000-8000-000000000912',
    title: 'A card that did not ship',
    stage: 'rejected',
    failing_check: 'smoke',
    spent_usd: '0.3000',
    funded_usd: '0.0000',
    credited_usd: '1.2000',
    moved: [
      { to_card_id: QUIET!.id, to_title: QUIET!.title, usd: 0.5 },
      { to_card_id: RENAME!.id, to_title: RENAME!.title, usd: 0.3 },
      { to_card_id: null, to_title: null, usd: 0.1 },
    ],
    stopped_at: '2026-09-22T16:00:00Z',
  };
  test.use({
    studio: {
      ...DEFAULT_STUDIO,
      stopped: [paused, rejected],
      funding: [...DEFAULT_STUDIO.funding, { card_id: rejected.card_id, contributors: '2', credited_usd: '1.2000' }],
    },
  });

  test('lists a paused card under Paused and a rejected card under Didn\'t ship, with their reasons and money', async ({ page }) => {
    await page.goto('/ledger');
    const band = page.getByRole('region', { name: 'Stopped cards' });
    const pausedRow = band.getByRole('region', { name: 'Paused' }).getByRole('listitem');
    await expect(pausedRow).toHaveCount(1);
    await expect(pausedRow.getByRole('heading', { level: 4 })).toHaveText('A card that paused');
    await expect(pausedRow.locator('.tag[data-state="paused"]')).toHaveText('Paused');
    await expect(pausedRow.locator('.tag svg[data-glyph="pause"]')).toHaveCount(1);
    await expect(pausedRow.getByText('It reached its spending limit.')).toBeVisible();
    await expect(pausedRow.getByText('$0.42 spent')).toBeVisible();
    await expect(pausedRow.getByText('Its money stays on it until it resumes or the board cancels it.')).toBeVisible();

    const rejectedRow = band.getByRole('region', { name: "Didn't ship" }).getByRole('listitem');
    await expect(rejectedRow).toHaveCount(1);
    await expect(rejectedRow.getByText('The bot that plays the game found a problem with the change.')).toBeVisible();
    await expect(rejectedRow.getByText('$0.30 spent · funded by $1.20 from 2 supporters')).toBeVisible();
    await expect(
      rejectedRow.getByText(`Its unspent money went to ${QUIET!.title} ($0.50), ${RENAME!.title} ($0.30) and Not on a card yet ($0.10).`),
    ).toBeVisible();
    // The codes never show, and stopped cards appear on no other page.
    await expect(band.getByText(/ceiling|smoke/)).toHaveCount(0);
    for (const path of ['/', '/contribute', '/roadmap']) {
      await page.goto(path);
      await expect(page.getByRole('main').getByText('A card that paused')).toHaveCount(0);
      await expect(page.getByRole('main').getByText('A card that did not ship')).toHaveCount(0);
    }
  });
});
