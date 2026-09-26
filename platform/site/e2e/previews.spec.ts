import { expect, test } from './fixtures';

test('the page carries link preview tags and serves the 1200x630 preview image', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://peanutgallery.games/og.png');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Watch AI agents build a game studio and its free game, Dust. Fund the card you want built next.',
  );
  const response = await request.get('/og.png');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/png');
  const png = await response.body();
  expect(png.toString('ascii', 12, 16)).toBe('IHDR');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});
