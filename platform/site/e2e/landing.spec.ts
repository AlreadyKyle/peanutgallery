import { expect, test, type Page } from '@playwright/test';

async function overflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

test('landing loads at 375 px with every element visible and no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Site' });
  const main = page.getByRole('main');
  const footer = page.getByRole('contentinfo');

  await expect(page.getByRole('banner').getByRole('link', { name: 'Peanut Gallery' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Ledger' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Board' })).toHaveCount(0);
  await expect(page.getByRole('banner').getByText('Pool')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Watch AI agents build a game studio and free games.');
  await expect(page.getByText('Vote on what they do next by contributing to their compute.')).toBeVisible();
  await expect(page.getByText('These are contributions, not donations.', { exact: false })).toBeVisible();
  // Building now, Queued and Shipped appear only when cards are in those stages, so only the fixed headings are listed.
  for (const name of ['Right now', "Fund what's next", 'How it works', 'Funding', 'Ledger', 'Fixed rules']) {
    await expect(main.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
  }
  const optional = new Set(['Building now', 'Queued', 'Shipped']);
  const order = ['Right now', 'Building now', "Fund what's next", 'Queued', 'Shipped', 'How it works', 'Funding', 'Ledger', 'Fixed rules'];
  const headings = await main.getByRole('heading', { level: 2 }).allTextContents();
  expect(headings).toEqual(order.filter((name) => !optional.has(name) || headings.includes(name)));
  await expect(main.getByRole('link', { name: 'Full ledger' }).first()).toBeVisible();
  await expect(page.getByText('Funding a card is your vote.', { exact: false })).toBeVisible();
  await expect(page.getByText('Art inside the games is made by code', { exact: false })).toBeVisible();
  await expect(page.getByText('Everything here is made for all ages.')).toBeVisible();
  await expect(page.getByText('Some rules are fixed and no vote can change them.', { exact: false })).toBeVisible();
  await expect(page.getByText('kill switch', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(
    footer.getByText('Free games, playable in a browser, built by AI agents.'),
  ).toBeVisible();
  if ((process.env.VITE_STRIPE_PAYMENT_LINK_URL ?? '').trim() !== '') {
    await expect(nav.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
    await expect(main.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
    const box = await main.getByRole('link', { name: 'Contribute' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  if ((process.env.VITE_DISCORD_INVITE ?? '').trim() !== '') {
    await expect(nav.getByRole('link', { name: 'Discord' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Discord' })).toBeVisible();
  }
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('contribute page puts Pick for me first at 375 px without horizontal overflow', async ({ page }) => {
  await page.goto('/contribute');
  await expect(page.getByRole('heading', { level: 1, name: 'Where should your contribution go?' })).toBeVisible();
  if ((process.env.VITE_STRIPE_PAYMENT_LINK_URL ?? '').trim() !== '') {
    const first = page.getByRole('main').getByRole('link').first();
    await expect(first).toContainText('Pick for me');
    await expect(first).toHaveAttribute('href', process.env.VITE_STRIPE_PAYMENT_LINK_URL!.trim());
  }
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('ledger page loads at 375 px without horizontal overflow', async ({ page }) => {
  await page.goto('/ledger');
  await expect(page.getByRole('heading', { level: 1, name: 'Ledger' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Funding' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Agent work' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Deploys' })).toBeVisible();
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('build sha meta is stamped', async ({ page }) => {
  await page.goto('/');
  const sha = await page.locator('meta[name="build-sha"]').getAttribute('content');
  expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
});
