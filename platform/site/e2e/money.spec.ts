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
    await expect(first).toHaveAttribute('href', `${PAYMENT_LINK}?client_reference_id=split20`);
    const choices = main.locator('ul.choices a.choice');
    await expect(choices).toHaveCount(3);
    expect(await choices.evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([
      `${PAYMENT_LINK}?client_reference_id=${REFUNDED.id}_split20`,
      `${PAYMENT_LINK}?client_reference_id=${QUIET!.id}_split20`,
      `${PAYMENT_LINK}?client_reference_id=${RENAME!.id}_split20`,
    ]);
    await expect(main.getByText(String(VETOED.title))).toHaveCount(0);
    await expect(main.locator('ul.choices + p')).toHaveText("Anything beyond a card's target funds the next cards in line.");
    expect(await overflowsHorizontally(page)).toBe(false);
  });

  // docs/specs/machine-presets.md: the preset picked is the amount checkout opens on (Stripe's
  // prefilled_amount, in cents), after the split's reference, on home and /contribute.
  for (const path of ['/', '/contribute']) {
    test(`the Machine card's presets set the amount checkout opens on, on ${path}`, async ({ page }) => {
      await page.goto(path);
      const machine = page.getByRole('main').locator('.machine-card');
      const fund = machine.locator(`a[href^="${PAYMENT_LINK}"]`);
      const reference = path === '/contribute' ? 'client_reference_id=split20&' : '';
      await expect(fund).toHaveText('Fund $10');
      await expect(fund).toHaveAttribute('href', `${PAYMENT_LINK}?${reference}prefilled_amount=1000`);
      for (const usd of [5, 25, 50, 100]) {
        await machine.getByRole('button', { name: `$${usd}`, exact: true }).click();
        await expect(fund).toHaveText(`Fund $${usd}`);
        await expect(fund).toHaveAttribute('href', `${PAYMENT_LINK}?${reference}prefilled_amount=${usd * 100}`);
        await expect(machine).toContainText(`Checkout opens on $${usd}, and you can change it there.`);
      }
      await expect(machine).toContainText("Anything beyond a card's target funds the next cards in line.");
      await expect(machine).not.toContainText('enter $');
    });
  }

  test('counts and draws on home only the open cards in the order, each with its live Fund this card', async ({ page }) => {
    await page.goto('/');
    const fund = page.getByRole('region', { name: 'Pick a card to fund' });
    await expect(fund.locator('ul.fund-grid > li.card h3')).toHaveCount(2);
    // The vetoed card takes no money: it is not counted as open, and not drawn without a button among
    // cards that have one (that misaligns the row's bars).
    await expect(page.getByRole('main').getByText(String(VETOED.title))).toHaveCount(0);
    await expect(page.locator('p.status-line')).toHaveText(/^2 cards are open for funding\./);
    const links = await fund.getByRole('link', { name: 'Fund this card' }).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(links.sort()).toEqual([`${PAYMENT_LINK}?client_reference_id=${QUIET!.id}`, `${PAYMENT_LINK}?client_reference_id=${RENAME!.id}`].sort());
  });
});

// The split slider (docs/specs/split-slider.md): keyboard and pointer move it through the eleven
// splits, its value is read out as words, and every checkout link carries the choice.
test.describe('/contribute split slider', () => {
  test.use({
    studio: {
      ...DEFAULT_STUDIO,
      money: moneyRow({ ...DEFAULT_STUDIO.money, funding_order: fundingOrder([QUIET!.id]) }),
    },
  });

  test('starts at 80/20, steps by ten from the keyboard, and carries the split on every checkout link', async ({ page }) => {
    await page.goto('/contribute');
    const main = page.getByRole('main');
    const slider = main.getByRole('slider', { name: 'Agents and studio split' });
    await expect(slider).toHaveValue('80');
    await expect(slider).toHaveAttribute('aria-valuetext', '80% to the agents, 20% to the studio');
    await expect(main.getByText('Agents 80%', { exact: true })).toBeVisible();
    await expect(main.getByText('Studio 20%', { exact: true })).toBeVisible();
    await expect(main.getByText(/^Fixed, whatever you choose: 10% of every contribution after Stripe's fee is held in reserve before the split, and 5% of the agents' share/)).toBeVisible();

    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveValue('60');
    await expect(slider).toHaveAttribute('aria-valuetext', '60% to the agents, 40% to the studio');
    await expect(main.getByText('Studio 40%', { exact: true })).toBeVisible();
    const hrefs = () => main.locator('a.choice').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(await hrefs()).toEqual([`${PAYMENT_LINK}?client_reference_id=split40`, `${PAYMENT_LINK}?client_reference_id=${QUIET!.id}_split40`]);

    await page.keyboard.press('Home');
    await expect(slider).toHaveValue('0');
    expect((await hrefs())[0]).toBe(`${PAYMENT_LINK}?client_reference_id=split100`);
    await page.keyboard.press('End');
    await expect(slider).toHaveValue('100');
    expect((await hrefs())[1]).toBe(`${PAYMENT_LINK}?client_reference_id=${QUIET!.id}_split0`);

    // A drag lands on one of the eleven stops.
    const box = (await slider.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.mouse.click(box.x + box.width * 0.33, box.y + box.height / 2);
    expect(Number(await slider.inputValue()) % 10).toBe(0);
    expect(await overflowsHorizontally(page)).toBe(false);
  });
});

test.describe('/contribute with an empty order', () => {
  test.use({ studio: studio({}, { funding_order: [] }) });

  test('says the money waits for the next card to open, and offers no card', async ({ page }) => {
    await page.goto('/contribute');
    const main = page.getByRole('main');
    await expect(main.locator('a.choice-primary')).toContainText('Your contribution waits for the next card to open, then funds it.');
    await expect(main.locator('ul.choices')).toHaveCount(0);
    // The Machine card (docs/specs/final-state.md) is a second way into the same checkout, outside
    // the card choices; the choices still offer exactly one link.
    await expect(main.locator(`a[href^="${PAYMENT_LINK}"]:not(.machine-card a)`)).toHaveCount(1);
    await expect(main.locator(`.machine-card a[href^="${PAYMENT_LINK}"]`)).toHaveCount(1);
    // Home agrees: no card is open for funding, and the fund section draws none, only its panel with
    // Contribute, which says where the money waits without repeating the status line.
    await page.goto('/');
    await expect(page.locator('p.status-line')).toHaveText(/^No card is open for funding right now\./);
    const fund = page.getByRole('region', { name: 'Pick a card to fund' });
    await expect(fund.locator('li.card')).toHaveCount(0);
    await expect(fund.locator('.fund-empty')).toContainText('Fund the next card in line');
    await expect(fund.locator('.fund-empty')).toContainText('Your contribution waits for the next card to open, then funds it.');
    await expect(fund.locator('.fund-empty')).not.toContainText('No card is open for funding right now.');
    await expect(fund.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
  });
});

test.describe('when public_money and public_stopped_cards fail', () => {
  test.use({ studio: { ...DEFAULT_STUDIO, money: null, stopped: null } });

  test('/contribute offers only Fund the next card in line, naming no card, and home draws no Fund this card', async ({ page }) => {
    await page.goto('/contribute');
    const main = page.getByRole('main');
    await expect(main.getByText('Not available right now.')).toBeVisible();
    await expect(main.locator('a.choice-primary')).toHaveText('Fund the next card in lineYour contribution funds whatever the agents build next.');
    // The Machine card (docs/specs/final-state.md) is a second way into the same checkout, outside
    // the card choices; the choices still offer exactly one link.
    await expect(main.locator(`a[href^="${PAYMENT_LINK}"]:not(.machine-card a)`)).toHaveCount(1);
    await expect(main.locator(`.machine-card a[href^="${PAYMENT_LINK}"]`)).toHaveCount(1);
    await page.goto('/');
    await expect(page.locator('ul.fund-grid > li.card h3').first()).toBeVisible();
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
    await expect(funding.getByText(/below zero/)).toHaveCount(0);
    await expect(funding.getByText(/test payment/)).toHaveCount(0);
  });

  test.describe('short, with the board test payment', () => {
    test.use({ studio: studio({}, { not_on_card_usd: '0.0000', short_usd: '0.4500', board_test_usd: '0.5019' }) });
    test('says Not on a card yet is below zero, and names the test payment', async ({ page }) => {
      await page.goto('/ledger');
      const funding = page.getByRole('region', { name: 'Funding' });
      await expect(funding.locator('.stat', { hasText: 'Not on a card yet' }).locator('dd')).toHaveText('$0.00');
      await expect(await ledgerLine(page, 'Not on a card yet is $0.45 below zero: agent work spent that before any money on a card covered it, or a refund took back money already spent.')).toBeVisible();
      await expect(await ledgerLine(page, "The pool includes $0.50 of the studio's own test payment; it funds no card.")).toBeVisible();
    });
  });

  // Production on 20 October 2026, after ledger-figures' migration (docs/specs/ledger-figures.md).
  test.describe('the pool made up, with the test payment\'s shares and spend on a card not shown yet', () => {
    test.use({
      studio: studio(
        {
          pool: { ...DEFAULT_STUDIO.pool, balance_usd: '0.4816', reserve_usd: '0.5244', incident_reserve_usd: '0.1887', held_usd: '0.0000' },
          totals: { ...DEFAULT_STUDIO.totals, usd_total: '3.1048', unlisted_usd: '0.2631' },
        },
        {
          reserve_usd: '0.4510',
          incident_usd: '0.1623',
          agent_credit_usd: '3.0845',
          not_on_card_usd: '0.0000',
          short_usd: '0.2631',
          board_test_usd: '0.5019',
          test_paid_usd: '1.0000',
          test_reserve_usd: '0.0734',
          test_incident_usd: '0.0264',
        },
      ),
    });
    test('says how the pool adds up, what the balances hold of the test payment, and the spend on cards not shown yet', async ({ page }) => {
      await page.goto('/ledger');
      await expect(
        await ledgerLine(
          page,
          'In the pool: $3.08 of agent credit and $0.50 from the test payment, less $3.10 of agent spend. That is $0.24 unspent on card bars, $0.50 of the test payment, less the $0.26 by which Not on a card yet is below zero.',
        ),
      ).toBeVisible();
      await expect(
        await ledgerLine(page, "The pool, the reserve and the emergency fund include the studio's own $1.00 test payment: $0.50, $0.07 and $0.03. It funds no card."),
      ).toBeVisible();
      const work = page.getByRole('region', { name: 'Agent work' });
      await expect(work.locator('.stat', { hasText: 'Agent spend' }).locator('dd')).toContainText('$3.10');
      await expect(work.getByText(/Includes \$0\.26 spent on cards not shown on the site yet\./)).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);
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
    await expect(pausedRow.getByText('Its money stays on it until it resumes or is cancelled.')).toBeVisible();

    const rejectedRow = band.getByRole('region', { name: "Didn't ship" }).getByRole('listitem');
    await expect(rejectedRow).toHaveCount(1);
    await expect(rejectedRow.getByText('The bot that plays the game found a problem with the change.')).toBeVisible();
    await expect(rejectedRow.getByText('$0.30 spent · $1.20 reached it from 2 supporters')).toBeVisible();
    await expect(
      rejectedRow.getByText(`Its unspent money went to ${QUIET!.title} ($0.50), ${RENAME!.title} ($0.30) and Not on a card yet ($0.10).`),
    ).toBeVisible();
    // The codes never show, and stopped cards appear on no other page.
    await expect(band.getByText(/ceiling|smoke/)).toHaveCount(0);
    for (const path of ['/', '/contribute']) {
      await page.goto(path);
      await expect(page.getByRole('main').getByText('A card that paused')).toHaveCount(0);
      await expect(page.getByRole('main').getByText('A card that did not ship')).toHaveCount(0);
    }
  });
});
