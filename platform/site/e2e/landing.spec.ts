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
  await expect(main.getByRole('heading', { level: 2 })).toHaveText([
    'Building now',
    'Up next',
    'How it works',
    'Funding',
    'Ledger',
    'Fixed rules',
  ]);
  await expect(main.getByRole('link', { name: 'Full ledger' })).toBeVisible();
  await expect(page.getByText('Funding a card is your vote.', { exact: false })).toBeVisible();
  await expect(page.getByText('Art inside the games is made by code', { exact: false })).toBeVisible();
  await expect(page.getByText('Everything here is made for all ages.')).toBeVisible();
  await expect(page.getByText('Some rules are fixed and no vote can change them.', { exact: false })).toBeVisible();
  await expect(page.getByText('kill switch', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(
    footer.getByText('Free games, playable in a browser. Built by AI agents, directed by the players.'),
  ).toBeVisible();
  if ((process.env.VITE_STRIPE_PAYMENT_LINK_URL ?? '').trim() !== '') {
    await expect(nav.getByRole('link', { name: 'Contribute' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Contribute' })).toBeVisible();
    const box = await main.getByRole('link', { name: 'Contribute' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
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
