import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The layers after the units (docs/specs/final-state.md, Games; docs/strategy/game-quality.md):
// the first step on screen, a refused purchase that says why, pressing the pile into gems by
// keyboard (with a confirmation) and buying a perk, axe with the gems panel open, and "Save to
// gallery" beside Save as seed. States are planted as plain JSON under the save key; every file this
// spec imports is a package, never card code (platform/dispatcher/test/frames-kernel.test.ts).

const SAVE_KEY = 'dust.save';
const UNITS = ['gatherer', 'cart', 'mill', 'forge', 'foundry'];
// The live unlocks at or under 4,000,000 lifetime dust, in order.
const OPENED = ['sturdy-broom', 'cart', 'mill', 'weather-vane', 'forge', 'iron-broom', 'foundry', 'sharper-tools', 'pressing-stone', 'wider-paths'];

function ripe() {
  return {
    seed: 11,
    rngState: 4242,
    elapsedSeconds: 2000,
    dust: 4_000_000,
    totalDust: 4_000_000,
    owned: Object.fromEntries(UNITS.map((unit, i) => [unit, [30, 20, 10, 5, 2][i]])),
    unlocked: OPENED.map((id, i) => ({ id, atSeconds: i * 100 })),
  };
}

async function plant(page: Page, state: unknown): Promise<void> {
  await page.addInitScript(([key, value]) => {
    if (window.sessionStorage.getItem('planted') === null) {
      window.localStorage.setItem(key, value);
      window.sessionStorage.setItem('planted', '1');
    }
  }, [SAVE_KEY, JSON.stringify({ version: 1, state })] as const);
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#game canvas').waitFor();
  await expect(page.getByRole('button', { name: 'Strike' })).toBeAttached();
}

async function axeSeriousOrCritical(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

test('a new player sees what to do first, and a refused purchase says why', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  await expect(page.locator('.hud-hint')).toHaveText('Tap the pile to gather dust');
  const gatherer = page.getByRole('button', { name: /^Buy Gatherer: costs 10 dust, 0 owned$/ });
  await expect(gatherer).toHaveAttribute('aria-disabled', 'true');
  await gatherer.click();
  await expect(page.locator('[aria-live="polite"]')).toContainText(/more dust for a Gatherer/);
  await expect(page.locator('.hud-hint')).toContainText(/more dust for a Gatherer/);
});

test('presses the pile by keyboard after confirming, then buys a perk', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await plant(page, ripe());
  await ready(page);
  const press = page.getByRole('button', { name: /^Press the pile for 3 gems\./ });
  await expect(press).toHaveAttribute('aria-disabled', 'false');
  await press.focus();
  await page.keyboard.press('Enter');
  const yes = page.getByRole('group', { name: /^Start season 2 with 3 more gems\?/ }).getByRole('button', { name: 'Press the pile' });
  await expect(yes).toBeFocused();
  expect(await axeSeriousOrCritical(page)).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(page.locator('[aria-live="polite"]')).toContainText('Season 2 begins. You hold 3 gems.');
  await expect(page.getByRole('button', { name: /^Buy Gatherer: costs 10 dust, 0 owned$/ })).toBeAttached();
  await expect(page.locator('.gems-held')).toHaveText('3 gems, production +30%');

  const perk = page.getByRole('button', { name: 'Strong arms: Strikes ×3. Costs 1 gems.' });
  await expect(perk).toHaveAttribute('aria-disabled', 'false');
  await perk.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Strong arms: Strikes ×3. Owned.' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.gems-held')).toHaveText('2 gems, production +20%');
  const saved = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as { state?: { season?: number } }, SAVE_KEY);
  expect(saved.state?.season).toBe(1);
});

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1280, 720],
] as const) {
  test(`the gems panel passes axe and fits the screen (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await plant(page, ripe());
    await ready(page);
    await expect(page.getByRole('button', { name: /^Press the pile for 3 gems\./ })).toBeVisible();
    expect(await axeSeriousOrCritical(page)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
    for (const name of [/^Press the pile/, /^Strong arms/]) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('Save to gallery opens the seed gallery in a new tab with this run', async ({ page }) => {
  await plant(page, ripe());
  await ready(page);
  const link = page.getByRole('link', { name: /^Save to gallery/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await link.hover();
  const href = await link.getAttribute('href');
  const url = new URL(href!);
  expect(url.origin + url.pathname).toBe('https://mobmachine.games/seeds');
  const code = url.searchParams.get('save')!;
  expect(code).toMatch(/^dust:v1:[A-Za-z0-9_-]+$/);
  const body = JSON.parse(Buffer.from(code.slice('dust:v1:'.length), 'base64url').toString('utf8')) as { state: { owned: Record<string, number> } };
  expect(body.state.owned['gatherer']).toBe(30);
  const box = await link.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
