import { expect, test, type Page } from '@playwright/test';

async function overflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

test('landing loads at 375 px with every element visible and no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Untitled Game Studio' })).toBeVisible();
  await expect(
    page.getByText(
      'Watch AI agents build a free game; vote on what they do next; see it ship on stream within minutes.',
    ),
  ).toBeVisible();
  await expect(page.getByText(/^(The studio goes live when the board announces the date\.|Launch: )/)).toBeVisible();
  await expect(page.getByText('The default is 80/20.', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Meter' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Ledger' })).toBeVisible();
  await expect(page.getByText('The $500 total is the pool at launch.')).toBeVisible();
  await expect(page.getByText('Contributions before launch pre-load the pool', { exact: false })).toBeVisible();
  await expect(page.getByText('In-game art is procedural or vector', { exact: false })).toBeVisible();
  await expect(page.getByText('All ages.')).toBeVisible();
  await expect(page.getByText('Not editable by any card, vote, regime or org change', { exact: false })).toBeVisible();
  await expect(page.getByText('MIT licensed games.')).toBeVisible();
  if ((process.env.VITE_STRIPE_PAYMENT_LINK_URL ?? '').trim() !== '') {
    await expect(page.getByRole('link', { name: 'Contribute' })).toBeVisible();
  }
  if ((process.env.VITE_DISCORD_INVITE ?? '').trim() !== '') {
    await expect(page.getByRole('link', { name: 'Discord' })).toBeVisible();
  }
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('build sha meta is stamped', async ({ page }) => {
  await page.goto('/');
  const sha = await page.locator('meta[name="build-sha"]').getAttribute('content');
  expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
});
