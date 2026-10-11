import { copy } from '../src/lib/copy';
import { legal } from '../src/lib/legal';
import { PAYMENT_LINK } from './fixture-env';
import { DEFAULT_STUDIO, expect, overflowsHorizontally, test, type StudioFixture } from './fixtures';
import { DRAFTING_STUDIO, EMPTY_STUDIO, PROD_STUDIO } from './prod-studio';

// Home's card band (docs/specs/home-flow.md): the cards to fund first, as full faces or the panel
// that funds the next card in line, then three lanes in the order a card moves, and no lane is ever
// blank, whatever the studio holds. PROD_STUDIO is production as it was when the home page first
// looked empty: everything shipped, nothing open and the drafts used up.

const LANES = ['Next up', 'Building', 'Shipped'];
const VIEWPORTS = [320, 390, 768, 1280].map((width) => ({ width, height: 900 }));
const SHOTS = process.env.FLOW_SHOTS === '1';

async function lanes(page: import('@playwright/test').Page) {
  const flow = page.getByRole('region', { name: 'How the cards move' });
  await expect(flow).toBeVisible();
  const items = flow.locator('ol.flow-lanes > li.flow-lane');
  await expect(items).toHaveCount(3);
  await expect(items.locator('h3.flow-title')).toHaveText(LANES.map((name) => new RegExp(`^${name} `)));
  return items;
}

/** Every lane holds at least one card or its tile saying what happens next. */
async function neverBlank(items: import('@playwright/test').Locator) {
  for (let i = 0; i < 3; i += 1) {
    const lane = items.nth(i);
    const filled = (await lane.locator('li.card').count()) + (await lane.locator('.flow-empty').count());
    expect(filled, `lane ${LANES[i]} is blank`).toBeGreaterThan(0);
    await expect(lane.locator('li.card').nth(3)).toHaveCount(0);
  }
}

const CASES: { label: string; studio: StudioFixture }[] = [
  { label: 'the default studio', studio: DEFAULT_STUDIO },
  { label: 'production on 10 Oct 2026', studio: PROD_STUDIO },
  { label: 'while the Game Designer drafts', studio: DRAFTING_STUDIO },
  { label: 'a studio with no cards', studio: EMPTY_STUDIO },
];

for (const { label, studio } of CASES) {
  test.describe(`home flow, ${label}`, () => {
    test.use({ studio });
    for (const viewport of VIEWPORTS) {
      test(`the cards to fund first, then three lanes, none blank, at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/');
        const h2 = page.getByRole('main').getByRole('heading', { level: 2 });
        await expect(h2.nth(1)).toHaveText(copy.flow.fundTitle); // after the first game's tile (decision 68)
        const items = await lanes(page);
        const fund = page.getByRole('region', { name: copy.flow.fundTitle });
        expect((await fund.locator('ul.fund-grid > li.card').count()) + (await fund.locator('.fund-empty').count())).toBeGreaterThan(0);
        await neverBlank(items);
        expect(await overflowsHorizontally(page)).toBe(false);
        // Cards sit only in the flow, the page's second band.
        expect(await page.locator('main > .band:nth-child(2) li.card').count()).toBe(await page.locator('li.card').count());
        if (SHOTS) await page.screenshot({ path: `test-results/flow-${label.replace(/\W+/g, '-')}-${viewport.width}.png`, fullPage: true });
      });
    }
  });
}

test.describe('home flow lanes', () => {
  test('the default studio: open cards fund through Stripe as full faces, building holds the queued card', async ({ page }) => {
    await page.goto('/');
    const items = await lanes(page);
    const fund = page.getByRole('region', { name: copy.flow.fundTitle });
    await expect(fund.locator('ul.fund-grid li.card h3')).toHaveText(['Quiet rooms: one more unlock', 'Rename the Gatherer to Sweeper']);
    await expect(fund.locator('li.card[data-compact]')).toHaveCount(0);
    const links = await fund.getByRole('link', { name: 'Fund this card' }).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(links).toHaveLength(2);
    for (const href of links) expect(href).toMatch(new RegExp(`^${PAYMENT_LINK}\\?client_reference_id=[0-9a-f-]{36}$`));
    await expect(items.nth(1).locator('li.card h4')).toContainText(['A cheaper Cart']);
    await expect(items.nth(1).locator('li.card[data-face="funded"]')).toHaveCount(1);
  });

});

test.describe('home flow, production lanes', () => {
  test.use({ studio: PROD_STUDIO });
  test('production on 10 Oct 2026: planned and shipped cards show, and the empty lanes say what happens next', async ({ page }) => {
    await page.goto('/');
    const items = await lanes(page);
    await expect(items.nth(0).locator('li.card[data-face="planned"]')).toHaveCount(3);
    await expect(items.nth(0).locator('.flow-agent')).toHaveText(copy.flow.draftingDone.replace('{n}', '4'));
    const fund = page.getByRole('region', { name: copy.flow.fundTitle });
    await expect(fund.locator('.fund-empty')).toContainText('Fund the next card in line');
    await expect(fund.locator('.fund-empty')).toContainText(legal.fundEmptyBody);
    await expect(fund.locator('.fund-empty-agent')).toHaveText(copy.flow.draftingDone.replace('{n}', '4'));
    await expect(fund.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
    await expect(items.nth(1).locator('.flow-empty')).toContainText('Cheaper first Gatherer');
    await expect(items.nth(2).locator('li.card[data-face="live"]')).toHaveCount(3);
    await expect(items.nth(2).locator('li.card h4').first()).toHaveText('Cheaper first Gatherer');
    await expect(page.locator('p.status-line')).toHaveText(copy.status.openNone);
  });
});

test.describe('home flow while drafting', () => {
  test.use({ studio: DRAFTING_STUDIO });
  test('the Next up lane and the status line say the agents are drafting', async ({ page }) => {
    await page.goto('/');
    const items = await lanes(page);
    await expect(items.nth(0).locator('.flow-agent[data-drafting]')).toHaveText(copy.flow.drafting);
    await expect(page.locator('p.status-line')).toHaveText(copy.status.drafting);
  });
});
