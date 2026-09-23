import { DISCORD_INVITE, PAYMENT_LINK } from './fixture-env';
import { expect, overflowsHorizontally, test, WIDTHS } from './fixtures';

for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('landing loads with every element visible and no horizontal overflow', async ({ page }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Site' });
      const main = page.getByRole('main');
      const footer = page.getByRole('contentinfo');

      await expect(page.getByRole('banner').getByRole('link', { name: 'Peanut Gallery' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Home' })).toHaveCount(0);
      for (const [name, href] of [
        ['How it works', '/how-it-works'],
        ['Team', '/team'],
        ['Roadmap', '/roadmap'],
        ['Ledger', '/ledger'],
        ['Contribute', '/contribute'],
      ] as const) {
        await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
      }
      await expect(nav.getByRole('link', { name: 'Board' })).toHaveCount(0);
      await expect(page.getByRole('banner').getByText('Pool')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Watch AI agents build a game studio and free games.');
      await expect(page.getByText('Fund the card you want built next.')).toBeVisible();
      await expect(page.getByText('These are contributions, not donations.', { exact: false })).toBeVisible();
      // Building now, Queued and Shipped appear only when cards are in those stages.
      const optional = new Set(['Building now', 'Queued', 'Shipped']);
      const order = ['Right now', 'Building now', "Fund what's next", 'Queued', 'Shipped', 'How it works', 'Funding', 'Ledger', 'Fixed rules'];
      const headings = await main.getByRole('heading', { level: 2 }).allTextContents();
      expect(headings).toEqual(order.filter((name) => !optional.has(name) || headings.includes(name)));
      await expect(main.getByRole('link', { name: 'Full ledger' }).first()).toBeVisible();
      await expect(main.getByRole('link', { name: 'More on how it works' })).toHaveAttribute('href', '/how-it-works');
      await expect(page.getByText('Fund a card to grow the studio and its games.', { exact: false })).toBeVisible();
      await expect(page.getByText('Art in the games and the agent avatars is drawn by code.')).toBeVisible();
      await expect(page.getByText('Everything here is made for all ages.')).toBeVisible();
      await expect(page.getByText('Some rules are fixed, and no contribution or card can change them.')).toBeVisible();
      await expect(page.getByText(/\bvot(e|es|ing)\b/i)).toHaveCount(0);
      await expect(page.getByText('kill switch', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(footer.getByText('AI agents build free games you can play in a browser.')).toBeVisible();

      // The Right now panel shows the pool figure and no paused notice while the agents run.
      const panel = page.getByRole('complementary');
      await expect(panel.getByText('In the pool')).toBeVisible();
      await expect(panel.getByText('$12.34')).toBeVisible();
      await expect(page.getByText('The agents are paused.', { exact: false })).toHaveCount(0);

      // The fund board lists horizon now cards only, with fund links, and no studio or next game chip.
      const fund = page.getByRole('region', { name: "Fund what's next" });
      await expect(fund.getByRole('heading', { level: 3 })).toHaveText(['Quiet rooms: one more unlock', 'Rename the Gatherer to Sweeper']);
      const links = await fund.getByRole('link', { name: 'Fund this card' }).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(links).toHaveLength(2);
      for (const href of links) expect(href).toMatch(new RegExp(`^${PAYMENT_LINK}\\?client_reference_id=[0-9a-f-]{36}$`));
      await expect(page.getByRole('group', { name: 'Show cards for' }).getByRole('button')).toHaveText([/^All/, /^Dust/]);
      await expect(page.getByText('Choose the next card without paying')).toHaveCount(0);

      await expect(main.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
      const box = await main.getByRole('link', { name: 'Contribute' }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(nav.getByRole('link', { name: 'Discord' })).toHaveAttribute('href', DISCORD_INVITE);
      await expect(footer.getByRole('link', { name: 'Discord' })).toHaveAttribute('href', DISCORD_INVITE);
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test('contribute page puts Pick for me first without horizontal overflow', async ({ page }) => {
      await page.goto('/contribute');
      await expect(page.getByRole('heading', { level: 1, name: 'Where should your contribution go?' })).toBeVisible();
      const first = page.getByRole('main').getByRole('link').first();
      await expect(first).toContainText('Pick for me');
      await expect(first).toHaveAttribute('href', PAYMENT_LINK);
      await expect(page.getByRole('main').getByText('Rename the Gatherer to Sweeper')).toBeVisible();
      await expect(page.getByRole('main').getByText('Board on its own site')).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test('ledger page loads without horizontal overflow and shows no raw bot output', async ({ page }) => {
      await page.goto('/ledger');
      await expect(page.getByRole('heading', { level: 1, name: 'Ledger' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Funding' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Agent work' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Deploys' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Deploys' }).getByRole('listitem').first()).toContainText('Game 2775bcb passed checks');
      await expect(page.getByText('simulated seconds', { exact: false })).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
    });
  });
}

test('build sha meta is stamped', async ({ page }) => {
  await page.goto('/');
  const sha = await page.locator('meta[name="build-sha"]').getAttribute('content');
  expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
});
