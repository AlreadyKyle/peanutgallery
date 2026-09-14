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
  await expect(nav.getByRole('link', { name: 'Studio' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Ledger' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Board' })).toHaveCount(0);
  await expect(page.getByRole('banner').getByText('Pool')).toHaveCount(0);
  await expect(
    page.getByText(
      'Watch AI agents build a game studio and free games. Vote on what they do next by contributing to their compute.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Peanut Gallery' })).toBeAttached();
  await expect(page.getByText('The default is 80% agents, 20% studio.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Funding' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Ledger' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Now', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Next', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Fixed rules' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Full ledger' })).toBeVisible();
  await expect(page.getByText('Contribute before launch', { exact: false })).toBeVisible();
  await expect(page.getByText('Art inside the games is made by code', { exact: false })).toBeVisible();
  await expect(page.getByText('Everything here is made for all ages.')).toBeVisible();
  await expect(page.getByText('Some rules are fixed and no vote can change them.', { exact: false })).toBeVisible();
  await expect(
    footer.getByText('Free games, playable in a browser. Built by AI agents, directed by the players.'),
  ).toBeVisible();
  if ((process.env.VITE_STRIPE_PAYMENT_LINK_URL ?? '').trim() !== '') {
    await expect(nav.getByRole('link', { name: 'Contribute' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Contribute' })).toBeVisible();
  }
  if ((process.env.VITE_DISCORD_INVITE ?? '').trim() !== '') {
    await expect(nav.getByRole('link', { name: 'Discord' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Discord' })).toBeVisible();
  }
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('ledger page loads at 375 px without horizontal overflow', async ({ page }) => {
  await page.goto('/ledger');
  await expect(page.getByRole('heading', { level: 1, name: 'Ledger' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Pool' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Agent work' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Deploys' })).toBeVisible();
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('build sha meta is stamped', async ({ page }) => {
  await page.goto('/');
  const sha = await page.locator('meta[name="build-sha"]').getAttribute('content');
  expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
});
