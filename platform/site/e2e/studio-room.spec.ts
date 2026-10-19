import { copy } from '../src/lib/copy';
import { expect, test } from './fixtures';
import { OFFLINE_STUDIO } from './prod-studio';

// The live studio's room (DESIGN.md, The live studio): agents with no card wander the room instead
// of standing still, an agent under the pointer holds still with its role card open, the room draws
// no browser tooltip, and under reduced motion nothing moves.

const transforms = (page: import('@playwright/test').Page) =>
  page.locator('.studio-stage .studio-agent').evaluateAll((els) => els.map((el) => `${el.getAttribute('data-role')} ${el.getAttribute('transform')}`).sort());

test.use({ viewport: { width: 1440, height: 900 } });

test('idle agents wander the room between cards', async ({ page }) => {
  await page.goto('/');
  const agents = page.locator('.studio-stage .studio-agent');
  await expect(agents.first()).toBeVisible();
  // The default studio has agents with no card: they chat, read or rest, and set off on their own.
  await expect(page.locator('.studio-agent[data-activity="chatting"]').first()).toBeAttached();
  const before = await transforms(page);
  await expect.poll(async () => (await transforms(page)).filter((t, i) => t !== before[i]).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('.studio-agent[data-pose="walk"], .studio-agent[data-pose="away"]').first()).toBeAttached({ timeout: 15_000 });
});

test('an agent under the pointer holds still with its role card open', async ({ page }) => {
  await page.goto('/');
  const agent = page.locator('.studio-stage .studio-agent').first();
  await expect(agent).toBeVisible();
  await agent.hover({ force: true });
  await expect(page.locator('.role-card')).toBeVisible();
  const held = await agent.getAttribute('transform');
  await page.waitForTimeout(2500);
  expect(await agent.getAttribute('transform')).toBe(held);
});

test('the room is named for assistive technology without a browser tooltip', async ({ page }) => {
  await page.goto('/');
  // The plate's room; the rail's small map (docs/specs/place.md) is hidden from assistive technology.
  const room = page.locator('.floor-plate svg.room[data-variant="live"]');
  await expect(room).toHaveAttribute('aria-label', /^The studio in its .+ era/);
  await expect(room.locator(':scope > title')).toHaveCount(0);
});

test.describe('under reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('draws every agent still at its place', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.studio-stage .studio-agent').first()).toBeVisible();
    const before = await transforms(page);
    await page.waitForTimeout(3000);
    expect(await transforms(page)).toEqual(before);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

// docs/specs/honest-status.md: while the agents are offline nobody works, but nobody sleeps either (the
// board, 19 October 2026): every agent putters about the room like an idle one, eyes open, with no
// sleep mark, and its role card says the agents are offline.
test.describe('while the agents are offline', () => {
  test.use({ studio: OFFLINE_STUDIO });

  test('every agent putters about awake, and its role card says the agents are offline', async ({ page }) => {
    await page.goto('/');
    const agents = page.locator('.floor-plate .studio-agent');
    await expect(agents.first()).toBeVisible();
    for (const activity of await agents.evaluateAll((els) => els.map((el) => el.getAttribute('data-activity')))) expect(['chatting', 'reading', 'resting']).toContain(activity);
    await expect(page.locator('.floor-plate .avatar-lid')).toHaveCount(0);
    await expect(page.locator('.floor-plate .avatar-eye').first()).toBeAttached();
    const before = await transforms(page);
    await expect.poll(async () => (await transforms(page)).filter((t, i) => t !== before[i]).length, { timeout: 15_000 }).toBeGreaterThan(0);
    await agents.first().hover({ force: true });
    await expect(page.locator('.role-card .role-card-doing')).toHaveText(copy.agentsOffline);
    await expect(agents.first()).toHaveAttribute('aria-label', new RegExp(`\\. ${copy.agentsOffline.replace('.', '\\.')}$`));
  });
});
