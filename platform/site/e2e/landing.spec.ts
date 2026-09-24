import { DISCORD_INVITE, PAYMENT_LINK, PLAY_URL } from './fixture-env';
import { expect, overflowsHorizontally, test, WIDTHS } from './fixtures';

// Home in the board's order, the top bar and Menu, /contribute and /ledger (docs/specs/home-and-design.md).
for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('home draws the pitch, the status line, the cards, the team, the roadmap and the money, in that order', async ({ page }) => {
      await page.goto('/');
      const main = page.getByRole('main');
      const footer = page.getByRole('contentinfo');

      await expect(page.getByRole('banner').getByRole('link', { name: 'Mob Machine' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Watch AI agents build a game studio and free games.');
      await expect(main.getByText('Fund the card you want built next.')).toBeVisible();
      await expect(main.getByRole('link', { name: 'Play Dust' })).toHaveAttribute('href', PLAY_URL);
      await expect(main.getByRole('link', { name: 'How it works', exact: true })).toHaveAttribute('href', '/how-it-works');
      // The status line, from the fixture: two cards open, nothing building, the agents running.
      await expect(main.locator('p.status-line')).toHaveText('2 cards are open for funding.');
      await expect(main.getByRole('button', { name: 'Pause live updates' })).toBeVisible();
      await expect(main.locator('.updates-button')).toHaveText(/Up to date/);

      await expect(main.getByRole('heading', { level: 2 })).toHaveText([
        "Fund what's next",
        'Queued',
        'The team',
        'Shipped',
        'Planned next',
        'Where the money goes',
      ]);
      // The fund grid lists horizon now cards only, picked first, with fund links, and no studio chip.
      const fund = page.getByRole('region', { name: "Fund what's next" });
      await expect(fund.getByRole('heading', { level: 3 })).toHaveText(['Quiet rooms: one more unlock', 'Rename the Gatherer to Sweeper']);
      const links = await fund.getByRole('link', { name: 'Fund this card' }).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(links).toHaveLength(2);
      for (const href of links) expect(href).toMatch(new RegExp(`^${PAYMENT_LINK}\\?client_reference_id=[0-9a-f-]{36}$`));
      await expect(page.getByRole('group', { name: 'Show cards for' }).getByRole('button')).toHaveText([/^All/, /^Dust/]);
      await expect(page.getByRole('region', { name: 'Queued' }).getByText('A cheaper Cart')).toBeVisible();

      // The team strip: the first three running roles, each linking to its row on /team.
      const team = page.getByRole('region', { name: 'The team' });
      await expect(team.locator('.member-name')).toHaveText(['Builder A', 'Builder B', 'QA']);
      for (const href of await team.locator('a.member').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(href).toMatch(/^\/team#agent-/);
      await expect(team.getByRole('link', { name: 'Meet the whole team' })).toHaveAttribute('href', '/team');

      await expect(page.getByRole('region', { name: 'Shipped' }).getByRole('heading', { level: 3 })).toHaveText([
        'The unlock list fits any number of unlocks',
        'Save progress and resume on reload',
      ]);
      await expect(page.getByRole('region', { name: 'Planned next' }).getByRole('heading', { level: 3 })).toHaveText([
        'Choose the next card without paying',
        'The Studio Head drafts cards from the roadmap',
        'Board on its own site',
      ]);

      const money = page.getByRole('region', { name: 'Where the money goes' });
      await expect(money.locator('.pool-line')).toHaveText('$12.34 in the pool');
      await expect(money.locator('.pool-line svg.coin')).toHaveCount(1);
      await expect(money.getByText('Unless you change it at checkout, 80% goes to the agents and 20% to the studio.', { exact: false })).toBeVisible();
      await expect(money.getByText('These are contributions, not donations.', { exact: false })).toBeVisible();
      await expect(money.locator('ul.rows li')).toHaveCount(3);
      await expect(money.getByRole('link', { name: 'Full ledger' })).toHaveAttribute('href', '/ledger');

      await expect(page.getByText(/\bvot(e|es|ing)\b/i)).toHaveCount(0);
      await expect(page.getByText('kill switch', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await expect(page.locator('a[href^="/card/"]')).toHaveCount(0);
      await expect(footer.getByText('AI agents build free games you can play in a browser.', { exact: false })).toBeVisible();
      await expect(footer.getByText('Everything here is made for all ages.', { exact: false })).toBeVisible();
      await expect(footer.getByRole('link', { name: 'Discord' })).toHaveAttribute('href', DISCORD_INVITE);
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test('the top bar carries the mark, Play, Contribute and the page links', async ({ page }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Site' });
      await expect(nav.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
      const contribute = await nav.getByRole('link', { name: 'Contribute' }).boundingBox();
      expect(contribute?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(nav.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute('href', PLAY_URL);
      const menu = nav.getByRole('button', { name: 'Menu' });
      if (viewport.width < 1024) {
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0);
        await menu.click();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
      } else {
        await expect(menu).toBeHidden();
      }
      for (const [name, href] of [
        ['How it works', '/how-it-works'],
        ['Team', '/team'],
        ['Roadmap', '/roadmap'],
        ['Ledger', '/ledger'],
        ['Discord', DISCORD_INVITE],
      ] as const) {
        await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
      }
      await expect(nav.getByRole('link', { name: 'Home' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Board' })).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test('contribute offers the next card in line first, then each open card', async ({ page }) => {
      await page.goto('/contribute');
      await expect(page.getByRole('heading', { level: 1, name: 'Where should your contribution go?' })).toBeVisible();
      const first = page.getByRole('main').getByRole('link').first();
      await expect(first).toContainText('Fund the next card in line');
      await expect(first).toContainText('Next in line: Quiet rooms: one more unlock');
      await expect(first).toHaveAttribute('href', PAYMENT_LINK);
      await expect(page.getByRole('main').getByText('Rename the Gatherer to Sweeper')).toBeVisible();
      await expect(page.getByRole('main').getByText('Board on its own site')).toHaveCount(0);
      await expect(page.getByRole('main').getByText('All amounts are in US dollars (USD).')).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test('ledger stacks Funding, Money in, Agent work and Deploys, and shows no raw bot output', async ({ page }) => {
      await page.goto('/ledger');
      await expect(page.getByRole('heading', { level: 1, name: 'Ledger' })).toBeVisible();
      // No card has stopped in the default fixture, so the Stopped band is not drawn.
      await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText(['Funding', 'Money in', 'Agent work', 'Deploys']);
      await expect(page.getByRole('region', { name: 'Deploys' }).getByRole('listitem').first()).toContainText('Game 2775bcb passed checks');
      await expect(page.getByText('simulated seconds', { exact: false })).toHaveCount(0);
      // Stacked, one band each: nothing sits beside the long lists.
      const tops = await page.evaluate(() => [...document.querySelectorAll('main > .band')].map((band) => band.getBoundingClientRect().left));
      expect(new Set(tops).size).toBe(1);
      expect(await overflowsHorizontally(page)).toBe(false);
    });
  });
}

test.describe('the Menu on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('opens the page links inline, and Escape closes it and returns focus to the button', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Site' });
    const menu = nav.getByRole('button', { name: 'Menu' });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await nav.getByRole('link', { name: 'Team' }).focus();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0);
    // Moving to another page closes it.
    await menu.click();
    await nav.getByRole('link', { name: 'Roadmap' }).click();
    await expect(page).toHaveURL(/\/roadmap$/);
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  for (const width of [360, 375, 390]) {
    test(`keeps the top bar to one 61px row at ${width}px, Play shown`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const bar = await page.locator('.topbar').boundingBox();
      expect(bar?.height ?? 0).toBeLessThanOrEqual(61);
      await expect(page.locator('.nav-play')).toBeVisible();
    });
  }

  test('moves Play into the Menu below 360px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await expect(page.locator('.nav-play')).toBeHidden();
    const bar = await page.locator('.topbar').boundingBox();
    expect(bar?.height ?? 0).toBeLessThanOrEqual(61);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Play', exact: true })).toHaveAttribute('href', PLAY_URL);
  });
});

test('build sha meta is stamped', async ({ page }) => {
  await page.goto('/');
  const sha = await page.locator('meta[name="build-sha"]').getAttribute('content');
  expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
});
