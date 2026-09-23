import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { E2E_ORIGIN } from './fixture-env';
import { expect, overflowsHorizontally, test } from './fixtures';

// The design system (docs/specs/design-system.md): the guide page, the bands, the on-ink rules,
// reduced motion and accessibility. The guide is the design-system pull request's mockup.
const GUIDE = '/design-kit-7q4m';
const ROUTES = ['/', '/contribute', '/ledger', '/how-it-works', '/team', '/roadmap', '/terms', '/privacy', '/refunds', '/contact', '/no-such-page', GUIDE];
const WIDTHS = [320, 360, 375, 390, 768, 1024, 1440];
const PAPER = 'rgb(255, 255, 255)';
const INK = 'rgb(17, 17, 17)';
const COIN = 'rgb(217, 164, 65)';

// Set E2E_SCREENSHOTS to a folder to save full-page screenshots of the guide and home.
const SHOTS = process.env.E2E_SCREENSHOTS ?? '';

async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

/** Where an element sits on the page, not in the viewport, so a scroll between two reads moves nothing. */
async function place(locator: Locator): Promise<number[]> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [r.left + window.scrollX, r.top + window.scrollY, r.width, r.height];
  });
}

/** The grounds of the drawn bands, top to bottom: the top bar, each band in main, the footer. */
async function grounds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const drawn = [document.querySelector('.topbar'), ...document.querySelectorAll('main > .band'), document.querySelector('.site-footer')];
    return drawn.map((el) => getComputedStyle(el!).backgroundColor);
  });
}

test.describe('the design guide', () => {
  for (const width of WIDTHS) {
    test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await settle(page, GUIDE);
      expect(await overflowsHorizontally(page)).toBe(false);
    });
  }

  test('asks not to be indexed and is linked from nowhere on the site', async ({ page }) => {
    await settle(page, GUIDE);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    for (const path of ['/', '/how-it-works', '/team', '/roadmap', '/contribute', '/ledger']) {
      await settle(page, path);
      await expect(page.locator(`a[href="${GUIDE}"]`)).toHaveCount(0);
    }
  });

  test('alternates its bands from ink, with the top bar on the first band and the footer continuing', async ({ page }) => {
    await settle(page, GUIDE);
    const drawn = await grounds(page);
    expect(drawn[0]).toBe(INK);
    expect(drawn.slice(1, -1)).toEqual([INK, PAPER, INK]);
    expect(drawn.at(-1)).toBe(PAPER);
    for (let i = 2; i < drawn.length; i += 1) expect(drawn[i], `band ${i}`).not.toBe(drawn[i - 1]);
  });

  test('puts no card, funding bar, choice or agent row in an ink band', async ({ page }) => {
    await settle(page, GUIDE);
    const onInk = await page.evaluate(
      () =>
        [...document.querySelectorAll('.card, .funding-bar, .choice, .agent')].filter(
          (el) => getComputedStyle(el.closest('main > .band')!).backgroundColor === 'rgb(17, 17, 17)',
        ).length,
    );
    expect(onInk).toBe(0);
    expect(await page.locator('main > .band:nth-child(2) .card').count()).toBeGreaterThanOrEqual(8);
  });

  test('draws the change marker in paper on ink and in ink on paper', async ({ page }) => {
    await settle(page, GUIDE);
    const shadows = await page.evaluate(() =>
      [...document.querySelectorAll('main > .band li.changed')].map((el) => [
        getComputedStyle(el.closest('main > .band')!).backgroundColor,
        getComputedStyle(el).boxShadow,
      ]),
    );
    expect(shadows).toEqual([
      ['rgb(17, 17, 17)', 'rgb(255, 255, 255) 3px 0px 0px 0px inset'],
      ['rgb(255, 255, 255)', 'rgb(17, 17, 17) 3px 0px 0px 0px inset'],
    ]);
  });

  test('keeps Contribute ink on coin inside an ink band', async ({ page }) => {
    await settle(page, GUIDE);
    const contribute = page.locator('main > .band:nth-child(1) a.btn-coin');
    await expect(contribute).toHaveCSS('color', INK);
    await expect(contribute).toHaveCSS('background-color', COIN);
    await expect(contribute).toHaveAttribute('href', '/contribute');
  });

  test('marks the pressed Pause on ink with a 3px paper border and the check glyph', async ({ page }) => {
    await settle(page, GUIDE);
    const pause = page.locator('main > .band:nth-child(1)').getByRole('button', { name: 'Pause live updates' });
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(pause).toHaveCSS('border-top-width', '3px');
    await expect(pause).toHaveCSS('border-top-color', PAPER);
    await expect(pause.locator('svg[data-glyph="check"]')).toHaveCount(1);
  });

  test('keeps the updates button and Pause still when the label changes, and keeps focus after a press', async ({ page }) => {
    await settle(page, GUIDE);
    const band = page.locator('main > .band:nth-child(1)');
    const updates = band.locator('.updates-button');
    const pause = band.getByRole('button', { name: 'Pause live updates' });
    const before = [await place(updates), await place(pause)];
    await band.getByRole('button', { name: 'Add sample updates' }).click();
    await expect(updates).toHaveText(/Show 3 updates/);
    expect([await place(updates), await place(pause)]).toEqual(before);
    await updates.focus();
    await updates.press('Enter');
    await expect(updates).toHaveAttribute('aria-disabled', 'true');
    await expect(updates).toBeFocused();
  });

  test('rings every focused control in an ink band with 3px paper at a 2px offset', async ({ page }) => {
    await settle(page, GUIDE);
    const rings = await page.evaluate(async () => {
      const band = document.querySelector('main > .band:nth-child(1)')!;
      const controls = [...band.querySelectorAll<HTMLElement>('a[href], button')];
      return controls.map((el) => {
        el.focus({ focusVisible: true } as FocusOptions);
        const style = getComputedStyle(el);
        return [style.outlineColor, style.outlineWidth, style.outlineOffset, style.outlineStyle];
      });
    });
    expect(rings.length).toBeGreaterThan(4);
    for (const ring of rings) expect(ring).toEqual([PAPER, '3px', '2px', 'solid']);
  });

  test('loads its font from its own origin', async ({ page }) => {
    const fonts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'font') fonts.push(request.url());
    });
    await settle(page, GUIDE);
    expect(fonts.length).toBeGreaterThan(0);
    for (const url of fonts) expect(url.startsWith(`${E2E_ORIGIN}/fonts/`)).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('16px "Atkinson Hyperlegible Next"'))).toBe(true);
  });

  test('marks each band edge with a CanvasText rule under forced colours', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await settle(page, GUIDE);
    const edges = await page.evaluate(() =>
      [...document.querySelectorAll('main > .band + .band'), document.querySelector('.site-footer')].map((el) => getComputedStyle(el!).borderTopWidth),
    );
    expect(edges).toEqual(['1px', '1px', '1px']);
  });
});

test.describe('motion', () => {
  test('plays nothing under reduced motion: getAnimations() stays empty through every demo', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle(page, GUIDE);
    for (const name of ['Play the deal', 'Play a fund tick', 'Play the flip', 'Play the slam']) {
      await page.getByRole('button', { name }).click();
      expect(await page.evaluate(() => document.getAnimations().length), name).toBe(0);
    }
    // The fund tick still lands: the figures change at once.
    await expect(page.locator('main').getByText('$1.25 of $1.50')).toBeVisible();
  });

  test('is still on first load and after a route change when motion is allowed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await settle(page, '/');
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'How it works' }).click();
    await page.waitForURL('**/how-it-works');
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test('flips a card in place: the same slot and no Fund button moves', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await settle(page, GUIDE);
    const card = page.locator('.demo').filter({ has: page.getByRole('button', { name: 'Play the flip' }) }).locator('li.card');
    const before = await place(card);
    await page.getByRole('button', { name: 'Play the flip' }).click();
    await expect(card).toHaveAttribute('data-face', 'funded');
    await page.waitForFunction(() => document.getAnimations().length === 0);
    expect((await place(card)).slice(0, 3)).toEqual(before.slice(0, 3));
  });
});

test.describe('every route', () => {
  for (const width of WIDTHS) {
    test(`has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ROUTES) {
        await settle(page, path);
        expect(await overflowsHorizontally(page), path).toBe(false);
      }
    });
  }

  test('has no horizontal scroll at 375px with 200% text', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of ROUTES) {
      await settle(page, path);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      expect(await overflowsHorizontally(page), path).toBe(false);
    }
  });
});

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  for (const width of [375, 1440]) {
    test(`finds no violation on the guide and every page at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ROUTES) {
        await settle(page, path);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        expect(
          results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
          path,
        ).toEqual([]);
      }
    });
  }

  test('finds no violation inside each ink band of the guide', async ({ page }) => {
    await settle(page, GUIDE);
    for (const band of ['main > .band:nth-child(1)', 'main > .band:nth-child(3)']) {
      const results = await new AxeBuilder({ page }).include(band).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => v.id), band).toEqual([]);
    }
  });
});

test.describe('screenshots', () => {
  test.skip(SHOTS === '', 'set E2E_SCREENSHOTS to save them');
  for (const width of [375, 1440]) {
    test(`the guide and home at ${width}px`, async ({ page }) => {
      mkdirSync(SHOTS, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of [
        ['guide', GUIDE],
        ['home', '/'],
      ] as const) {
        await settle(page, path);
        await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
      }
    });
  }
});
