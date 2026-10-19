import { copy } from '../src/lib/copy';
import { legal } from '../src/lib/legal';
import { PAYMENT_LINK } from './fixture-env';
import { DEFAULT_STUDIO, expect, overflowsHorizontally, test, type StudioFixture } from './fixtures';
import { DRAFTING_STUDIO, EMPTY_STUDIO, OFFLINE_STUDIO, PROD_STUDIO } from './prod-studio';

// Home's card band (docs/specs/home-flow.md), now the studio's floor (docs/specs/place.md): the cards
// to fund as full faces or the panel that funds the next card in line, the first game, the players'
// ideas, then Next up (where the Game Designer's drafts wait), Building and Shipped, and no station is ever
// blank, whatever the studio holds. PROD_STUDIO is production as it was when the home page first
// looked empty: everything shipped, nothing open and the drafts used up.

const LANES = ['Ideas', 'Next up', 'Building', 'Shipped'];
const VIEWPORTS = [320, 390, 768, 1280].map((width) => ({ width, height: 900 }));
const SHOTS = process.env.FLOW_SHOTS === '1';

async function lanes(page: import('@playwright/test').Page) {
  const items = page.locator('.floor-parts > [data-station-part]:not([data-station-part="fund"])');
  await expect(items).toHaveCount(4);
  await expect(items.locator(':scope > h2')).toHaveText(LANES);
  return items;
}

/** Every station holds at least one card or idea, its tile saying what happens next, or (Next up) the Game Designer's line. */
async function neverBlank(items: import('@playwright/test').Locator) {
  for (let i = 0; i < 4; i += 1) {
    const lane = items.nth(i);
    const filled = (await lane.locator('li.card').count()) + (await lane.locator('.flow-empty').count()) + (await lane.locator('.flow-agent').count());
    expect(filled, `lane ${LANES[i]} is blank`).toBeGreaterThan(0);
    await expect(lane.locator('li.card').nth(3)).toHaveCount(0);
  }
}

const CASES: { label: string; studio: StudioFixture }[] = [
  { label: 'the default studio', studio: DEFAULT_STUDIO },
  { label: 'production on 10 Oct 2026', studio: PROD_STUDIO },
  { label: 'while the Game Designer drafts', studio: DRAFTING_STUDIO },
  { label: 'a studio with no cards', studio: EMPTY_STUDIO },
  { label: 'while the agents are offline', studio: OFFLINE_STUDIO },
];

for (const { label, studio } of CASES) {
  test.describe(`home flow, ${label}`, () => {
    test.use({ studio });
    for (const viewport of VIEWPORTS) {
      test(`the cards to fund, Ideas, Next up, Building and Shipped, none blank, at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/');
        const h2 = page.getByRole('main').getByRole('heading', { level: 2 });
        // The live studio is on the plate (docs/specs/final-state.md); the cards to fund open the floor,
        // the first game's tile follows them (decision 70), then the players' ideas.
        await expect(h2.nth(0)).toHaveText('The studio, live');
        await expect(h2.nth(1)).toHaveText(copy.flow.fundTitle);
        await expect(h2.nth(2)).toHaveText(copy.game.title);
        await expect(h2.nth(3)).toHaveText(copy.ideas.title);
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
    await expect(items.nth(2).locator('li.card h4')).toContainText(['A cheaper Cart']);
    await expect(items.nth(2).locator('li.card[data-face="funded"]')).toHaveCount(1);
  });

});

test.describe('home flow, production lanes', () => {
  test.use({ studio: PROD_STUDIO });
  test('production on 10 Oct 2026: shipped cards show, the backlog does not, and the empty lanes say what happens next', async ({ page }) => {
    await page.goto('/');
    const items = await lanes(page);
    // Production's planned cards are all backlog entries, which never show (docs/specs/always-open.md).
    await expect(items.nth(1).locator('li.card')).toHaveCount(0);
    await expect(items.nth(1).locator('.flow-agent')).toHaveText(copy.flow.draftingDone.replace('{n}', '4'));
    const fund = page.getByRole('region', { name: copy.flow.fundTitle });
    await expect(fund.locator('.fund-empty')).toContainText('Fund the next card in line');
    await expect(fund.locator('.fund-empty')).toContainText(legal.fundEmptyBody);
    // Next up says what the Game Designer is doing, so the Fund panel does not say it again.
    await expect(fund.locator('.fund-empty-agent')).toHaveCount(0);
    await expect(fund.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
    await expect(items.nth(2).locator('.flow-empty')).toContainText('Cheaper first Gatherer');
    await expect(items.nth(3).locator('li.card[data-face="live"]')).toHaveCount(3);
    await expect(items.nth(3).locator('li.card h4').first()).toHaveText('Cheaper first Gatherer');
    await expect(page.locator('p.status-line')).toHaveText(copy.status.openNone);
  });
});

test.describe('home flow while drafting', () => {
  test.use({ studio: DRAFTING_STUDIO });
  test('the Ideas station and the status line say the agents are drafting', async ({ page }) => {
    await page.goto('/');
    const items = await lanes(page);
    await expect(items.nth(1).locator('.flow-agent[data-drafting]')).toHaveText(copy.flow.drafting);
    await expect(page.locator('p.status-line')).toHaveText(copy.status.drafting);
  });
});

// docs/specs/honest-status.md (decision 77): while the dispatcher has not checked in for 24 hours, home
// says "The agents are offline." where it says what the studio is doing, in the same place and style.
test.describe('home flow while the agents are offline', () => {
  test.use({ studio: OFFLINE_STUDIO });
  test('the status line, Next up and the funded card say so, and nothing says an agent is working', async ({ page }) => {
    await page.goto('/');
    const items = await lanes(page);
    await expect(page.locator('p.status-line')).toHaveText(`2 cards are open for funding. ${copy.agentsOffline}`);
    await expect(items.nth(1).locator('.flow-agent')).toHaveText(copy.agentsOffline);
    await expect(items.nth(1).locator('.flow-agent[data-drafting]')).toHaveCount(0);
    await expect(items.nth(2).locator('li.card[data-face="funded"] .card-waiting')).toHaveText(copy.agentsOffline);
    const main = page.locator('main');
    for (const working of [copy.flow.drafting, copy.status.drafting, copy.waitingForAgents, copy.flow.lanes.building.empty]) await expect(main).not.toContainText(working);
    // No banner and no new box: the line is the only change, and nothing says paused (decision 62).
    await expect(page.locator('main p.notice')).toHaveCount(0);
    await expect(main).not.toContainText(/The agents are paused|The board has paused the agents/);
    // In the room every agent sleeps.
    const agents = page.locator('.floor-plate .studio-agent');
    await expect(agents.first()).toBeVisible();
    expect(new Set(await agents.evaluateAll((els) => els.map((el) => el.getAttribute('data-activity'))))).toEqual(new Set(['offline']));
  });
});

// docs/specs/supporter-loop.md: the cards shipped since this browser's last visit, from localStorage only.
test.describe('since your last visit', () => {
  const KEY = 'peanutgallery.home.lastVisit';

  test('a first visit shows no strip and stores the visit', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('section[aria-labelledby="fund"]')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Since your last visit' })).toHaveCount(0);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), KEY)).not.toBeNull();
  });

  test('a return visit lists the cards that shipped since, each linking its page', async ({ page }) => {
    await page.addInitScript((key) => {
      if (sessionStorage.getItem('seeded') === null) {
        localStorage.setItem(key, '2026-09-15T09:00:00Z');
        sessionStorage.setItem('seeded', '1');
      }
    }, KEY);
    await page.goto('/');
    const strip = page.getByRole('region', { name: 'Since your last visit' });
    await expect(strip.getByRole('link', { name: 'The unlock list fits any number of unlocks' })).toHaveAttribute('href', /^[/]card[/]/);
    await expect(strip.getByRole('link', { name: 'Save progress and resume on reload' })).toHaveCount(0);
  });
});
