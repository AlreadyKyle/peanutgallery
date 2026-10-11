import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The game's accessible DOM layer (render/controls.ts, index.html): a main landmark and heading, the
// canvas hidden from assistive technology, real buttons for Strike and each unit, and a polite live
// region. This spec plays with the keyboard only and runs axe at a phone and a desktop width. Every
// file this spec imports is a package, never card code. A fresh page has no save, so play starts at 0.

async function axeSeriousOrCritical(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#game canvas').waitFor();
  await expect(page.getByRole('button', { name: 'Strike' })).toBeAttached();
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1280, 720],
] as const) {
  test(`axe finds no serious or critical violation (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await ready(page);
    expect(await axeSeriousOrCritical(page)).toEqual([]);
    // Again with the control panel open, as a keyboard user sees it.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Strike' })).toBeFocused();
    expect(await axeSeriousOrCritical(page)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  });
}

test('the page has a main landmark, a level-one heading and a hidden canvas', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Dust' })).toHaveCount(1);
  await expect(page.locator('#game')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('link', { name: 'See what players are funding next' })).toHaveAttribute(
    'href',
    'https://mobmachine.games/contribute',
  );
});

test('plays with the keyboard only: strike, then buy a Gatherer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  const strike = page.getByRole('button', { name: 'Strike' });
  const gatherer = page.getByRole('button', { name: /^Buy Gatherer: costs 10 dust, 0 owned$/ });
  await expect(gatherer).toHaveAttribute('aria-disabled', 'true');

  // Tab from the top of the page reaches Strike before any link: the controls come first in the DOM.
  for (let i = 0; i < 5 && !(await strike.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(strike).toBeFocused();
  // Every control is a 44px touch target at 375px.
  const box = await strike.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Strike with Enter and Space until a Gatherer is affordable (the rate adds dust too).
  for (let i = 0; i < 40 && (await gatherer.getAttribute('aria-disabled')) === 'true'; i += 1) {
    await page.keyboard.press(i % 2 === 0 ? 'Enter' : 'Space');
  }
  await expect(gatherer).toHaveAttribute('aria-disabled', 'false');

  await page.keyboard.press('Tab');
  await expect(gatherer).toBeFocused();
  await page.keyboard.press('Enter');
  const bought = page.getByRole('button', { name: /^Buy Gatherer: costs 13 dust, 1 owned$/ });
  await expect(bought).toBeAttached();
  // The button keeps focus after the purchase, and the live region says what happened.
  await expect(bought).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Bought a Gatherer, 1 owned.' })).toHaveCount(1);
  await expect(page.locator('[aria-live="polite"]')).toContainText('Bought a Gatherer, 1 owned.');
});
