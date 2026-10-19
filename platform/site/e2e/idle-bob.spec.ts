import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { OFFLINE_STUDIO } from './prod-studio';

// The idle bob (DESIGN.md, Motion): home's team strip and the running boxes on /team breathe as an
// idle agent in the live studio does, also while the agents are offline. A role still to come holds
// still, an avatar under the pointer holds still, nothing around a bobbing avatar moves, and under
// reduced motion every avatar is drawn still.

const lifts = (avatars: Locator) => avatars.evaluateAll((els) => els.map((el) => el.querySelector(':scope > g')?.getAttribute('transform') ?? ''));

test.use({ studio: OFFLINE_STUDIO });

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  test(`home's team strip and /team's running boxes bob, and nothing around them moves, at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const [path, selector] of [
      ['/', '.team-strip svg.avatar'],
      ['/team', 'li.agent svg.avatar'],
    ] as const) {
      await page.goto(path);
      const avatars = page.locator(selector);
      await avatars.first().scrollIntoViewIfNeeded();
      await expect(avatars.first()).toHaveAttribute('data-idle', 'true');
      const box = await avatars.first().boundingBox();
      const before = await lifts(avatars);
      await expect.poll(async () => (await lifts(avatars))[0] !== before[0] && (await lifts(avatars))[0] !== '', { timeout: 5_000 }).toBe(true);
      // Only the drawing moves inside its frame: the avatar's box holds its place.
      expect(await avatars.first().boundingBox(), path).toEqual(box);
      // Each agent keeps its own rhythm, so a row never moves as one.
      if (path === '/' && viewport.width === 1440) await expect.poll(async () => new Set(await lifts(avatars)).size).toBe(3);
    }
    await expect(page.locator('li.later-role svg.avatar[data-idle]')).toHaveCount(0);
  });
}

test('a strip avatar under the pointer holds still', async ({ page }) => {
  await page.goto('/');
  const member = page.locator('.team-strip a.member').first();
  await member.scrollIntoViewIfNeeded();
  await member.hover();
  const body = member.locator('svg.avatar > g');
  await page.waitForTimeout(200);
  const held = await body.getAttribute('transform');
  await page.waitForTimeout(1500);
  expect(await body.getAttribute('transform')).toBe(held);
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('every avatar is drawn still', async ({ page }) => {
    for (const path of ['/', '/team']) {
      await page.goto(path);
      const avatars = page.locator('svg.avatar[data-idle]');
      await avatars.last().scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      expect(new Set(await lifts(avatars)), path).toEqual(new Set(['']));
      expect(await page.evaluate(() => document.getAnimations().length), path).toBe(0);
    }
  });
});
