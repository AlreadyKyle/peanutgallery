import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { E2E_ORIGIN } from './fixture-env';
import { DEFAULT_STUDIO, expect, overflowsHorizontally, test, type StudioFixture } from './fixtures';
import { LIVE_STUDIO } from './live-studio';

// The design system (docs/specs/design-system.md): the guide page, the bands, the on-ink rules,
// reduced motion and accessibility. The guide is the design-system pull request's mockup.
const GUIDE = '/design-kit-7q4m';
const ROUTES = ['/', '/contribute', '/ledger', '/how-it-works', '/team', '/roadmap', '/terms', '/terms/1', '/privacy', '/refunds', '/refunds/1', '/contact', '/no-such-page', GUIDE];
const WIDTHS = [320, 360, 375, 390, 768, 1024, 1440];
const PAPER = 'rgb(255, 255, 255)';
const INK = 'rgb(17, 17, 17)';
const SIGNAL = 'rgb(26, 47, 200)';
const COIN = 'rgb(217, 164, 65)';
const COIN_DOWN = 'rgb(184, 134, 47)';
const COIN_UP = 'rgb(236, 195, 110)';

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

/**
 * The grounds a page must draw, top to bottom: the top bar and band 1 on signal, band 2 on paper,
 * then ink and paper in turn, and the footer taking the next place (DESIGN.md, Bands).
 */
function expected(bands: number): string[] {
  const band = (i: number) => (i === 0 ? SIGNAL : i % 2 === 1 ? PAPER : INK);
  return [SIGNAL, ...Array.from({ length: bands }, (_, i) => band(i)), bands % 2 === 1 ? PAPER : INK];
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

  test('puts the top bar and band 1 on signal, band 2 on paper, then ink and paper in turn, with the footer continuing', async ({ page }) => {
    await settle(page, GUIDE);
    const drawn = await grounds(page);
    expect(drawn).toEqual(expected(3));
  });

  test('puts no card, funding bar, choice or agent row outside band 2', async ({ page }) => {
    await settle(page, GUIDE);
    const outside = await page.evaluate(
      () => [...document.querySelectorAll('.card, .funding-bar, .choice, .agent')].filter((el) => el.closest('main > .band') !== document.querySelector('main > .band:nth-child(2)')).length,
    );
    expect(outside).toBe(0);
    expect(await page.locator('main > .band:nth-child(2) .card').count()).toBeGreaterThanOrEqual(8);
  });

  test('draws the change marker in the text colour: paper on signal and ink, ink on paper', async ({ page }) => {
    await settle(page, GUIDE);
    const shadows = await page.evaluate(() =>
      [...document.querySelectorAll('main > .band li.changed')].map((el) => [
        getComputedStyle(el.closest('main > .band')!).backgroundColor,
        getComputedStyle(el).boxShadow,
      ]),
    );
    expect(shadows).toEqual([
      [SIGNAL, `${PAPER} 3px 0px 0px 0px inset`],
      [PAPER, `${INK} 3px 0px 0px 0px inset`],
      [INK, `${PAPER} 3px 0px 0px 0px inset`],
    ]);
  });

  test('keeps Contribute ink on coin on the signal plate and on ink, hovering to coin-up on signal and coin-down on ink', async ({ page }) => {
    await settle(page, GUIDE);
    for (const [band, hover] of [
      ['main > .band:nth-child(1)', COIN_UP],
      ['main > .band:nth-child(3)', COIN_DOWN],
    ] as const) {
      const contribute = page.locator(`${band} a.btn-coin`).first();
      await expect(contribute).toHaveCSS('color', INK);
      await expect(contribute).toHaveCSS('background-color', COIN);
      await expect(contribute).toHaveAttribute('href', '/contribute');
      await contribute.hover();
      await expect(contribute).toHaveCSS('background-color', hover);
    }
  });

  test('marks the pressed Pause with a 3px paper border and the check glyph on signal and on ink', async ({ page }) => {
    await settle(page, GUIDE);
    const pause = page.locator('main > .band:nth-child(1) .live-updates').getByRole('button', { name: 'Pause live updates' });
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(pause).toHaveCSS('border-top-width', '3px');
    await expect(pause).toHaveCSS('border-top-color', PAPER);
    await expect(pause.locator('svg[data-glyph="check"]')).toHaveCount(1);
    const onInk = page.locator('main > .band:nth-child(3) [aria-pressed="true"]');
    await expect(onInk).toHaveCSS('border-top-width', '3px');
    await expect(onInk).toHaveCSS('border-top-color', PAPER);
  });

  test('draws the suit tiles on paper, and resets them and the Live mark to the text colour on signal and ink', async ({ page }) => {
    await settle(page, GUIDE);
    const tiles = await page.evaluate(() =>
      [1, 2, 3].map((n) => {
        const band = document.querySelector(`main > .band:nth-child(${n})`)!;
        const tile = band.querySelector('.rows [data-suit="game"] > .suit-tile')!;
        const live = band.querySelector('.rows [data-state="live"] > .glyph')!;
        return [getComputedStyle(tile).backgroundColor, getComputedStyle(live).color];
      }),
    );
    expect(tiles).toEqual([
      ['rgba(0, 0, 0, 0)', PAPER],
      ['rgb(176, 34, 106)', 'rgb(22, 112, 31)'],
      ['rgba(0, 0, 0, 0)', PAPER],
    ]);
  });

  test('keeps the updates button and Pause still when the label changes, and keeps focus after a press', async ({ page }) => {
    await settle(page, GUIDE);
    const band = page.locator('main > .band:nth-child(1)');
    const updates = band.locator('.updates-button');
    const pause = band.locator('.live-updates').getByRole('button', { name: 'Pause live updates' });
    const before = [await place(updates), await place(pause)];
    await band.getByRole('button', { name: 'Add sample updates' }).click();
    await expect(updates).toHaveText(/Show 3 updates/);
    expect([await place(updates), await place(pause)]).toEqual(before);
    await updates.focus();
    await updates.press('Enter');
    await expect(updates).toHaveAttribute('aria-disabled', 'true');
    await expect(updates).toBeFocused();
  });

  test('rings every focused control with 3px at a 2px offset: paper on signal and ink, signal on paper', async ({ page }) => {
    await settle(page, GUIDE);
    for (const [n, colour] of [
      [1, PAPER],
      [2, SIGNAL],
      [3, PAPER],
    ] as const) {
      const rings = await page.evaluate((band) => {
        const controls = [...document.querySelectorAll<HTMLElement>(`main > .band:nth-child(${band}) a[href], main > .band:nth-child(${band}) button`)];
        return controls.map((el) => {
          el.focus({ focusVisible: true } as FocusOptions);
          const style = getComputedStyle(el);
          return [style.outlineColor, style.outlineWidth, style.outlineOffset, style.outlineStyle];
        });
      }, n);
      expect(rings.length, `band ${n}`).toBeGreaterThan(4);
      for (const ring of rings) expect(ring, `band ${n}`).toEqual([colour, '3px', '2px', 'solid']);
    }
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

  test('marks each band edge with a CanvasText rule, fills the Funded glyph and edges the suit tiles under forced colours', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await settle(page, GUIDE);
    const edges = await page.evaluate(() =>
      [...document.querySelectorAll('main > .band + .band'), document.querySelector('.site-footer')].map((el) => getComputedStyle(el!).borderTopWidth),
    );
    expect(edges).toEqual(['1px', '1px', '1px']);
    const funded = page.locator('.card[data-face="funded"] .card-index svg[data-glyph="full-bar"] path').first();
    expect(await funded.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(0, 0, 0)');
    await expect(page.locator('main > .band:nth-child(2) .card .suit-tile').first()).toHaveCSS('border-top-width', '1px');
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
    const nav = page.getByRole('navigation', { name: 'Site' });
    await nav.getByRole('button', { name: 'Menu' }).click();
    await nav.getByRole('link', { name: 'How it works' }).click();
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
  test('draws its bands signal, paper, then ink and paper in turn, the footer continuing, with every card in band 2', async ({ page }) => {
    for (const path of ROUTES) {
      await settle(page, path);
      const drawn = await grounds(page);
      expect(drawn, path).toEqual(expected(drawn.length - 2));
      const outside = await page.evaluate(
        () => [...document.querySelectorAll('.card, .funding-bar, .choice, .agent')].filter((el) => el.closest('main > .band') !== document.querySelector('main > .band:nth-child(2)')).length,
      );
      expect(outside, path).toBe(0);
      // Every band touches the next: no strip of page ground between two grounds.
      const seams = await page.evaluate(() => {
        const stack = [document.querySelector('.topbar')!, ...document.querySelectorAll('main > .band'), document.querySelector('.site-footer')!];
        return stack.slice(1).map((el, i) => Math.abs(el.getBoundingClientRect().top - stack[i]!.getBoundingClientRect().bottom));
      });
      for (const seam of seams) expect(seam, path).toBeLessThanOrEqual(0.5);
    }
  });

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

test.describe('bands with empty data', () => {
  test.use({ studio: { ...DEFAULT_STUDIO, roles: [] } });

  test('keep the order when home draws no team strip and /team has no Running list', async ({ page }) => {
    for (const [path, bands] of [
      ['/', 4],
      ['/team', 2],
    ] as const) {
      await settle(page, path);
      expect(await grounds(page), path).toEqual(expected(bands));
    }
    // With no team strip, Shipped moves onto ink: its suit tiles and Live mark reset to the text colour.
    await settle(page, '/');
    const shipped = page.locator('main > .band:nth-child(3)');
    await expect(shipped.getByRole('heading', { level: 2, name: 'Shipped' })).toBeVisible();
    await expect(shipped.locator('[data-suit] > .suit-tile').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(shipped.locator('[data-state="live"] > .glyph').first()).toHaveCSS('color', PAPER);
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

  test('finds no violation inside the signal plate and the ink band of the guide', async ({ page }) => {
    await settle(page, GUIDE);
    for (const band of ['main > .band:nth-child(1)', 'main > .band:nth-child(3)']) {
      const results = await new AxeBuilder({ page }).include(band).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => v.id), band).toEqual([]);
    }
  });
});

// The money bands (docs/specs/money-surfaces.md): /contribute and /ledger at 375, 768 and 1440 on the
// launch-shaped studio, whose public_money carries the board's test payment and whose stopped cards
// are a paused and a rejected card; then with a shortfall; then with both money reads failing. Each
// variant first shows the parts it audits are drawn, so the checks cannot pass on a page without them.
const MONEY_VARIANTS: [string, StudioFixture][] = [
  ['the launch-shaped studio', LIVE_STUDIO],
  ['a shortfall', { ...LIVE_STUDIO, money: { ...LIVE_STUDIO.money, short_usd: '0.4500' } }],
  ['the money reads failing', { ...LIVE_STUDIO, money: null, stopped: null }],
];

async function moneyBandsDrawn(page: Page, label: string, path: string): Promise<void> {
  const main = page.getByRole('main');
  if (path === '/contribute') {
    const first = main.locator('a.choice-primary .choice-body');
    if (label === 'the money reads failing') {
      await expect(first).toHaveText('Your contribution funds whatever the agents build next.');
      await expect(main.getByText('Not available right now.')).toBeVisible();
    } else {
      await expect(first).toHaveText(/^Next in line: /);
      await expect(main.locator('ul.choices a.choice').first()).toBeVisible();
    }
    return;
  }
  const funding = page.getByRole('region', { name: 'Funding' });
  const stopped = page.getByRole('region', { name: 'Stopped cards' });
  if (label === 'the money reads failing') {
    await expect(funding.locator('.stat.stat-unavailable dd')).toHaveText('Not available right now.');
    await expect(page.getByRole('region', { name: 'Money in' }).getByText('Not available right now.')).toBeVisible();
    await expect(stopped.getByText('Not available right now.')).toBeVisible();
    return;
  }
  await expect(funding.getByText("The pool includes $0.50 of the board's own test payment; it funds no card.")).toBeVisible();
  if (label === 'a shortfall') await expect(funding.getByText('Waiting cards are short by $0.45 until new money arrives.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Money in' }).locator('.stat')).not.toHaveCount(0);
  await expect(stopped.getByRole('region', { name: 'Paused' }).locator('.tag[data-state="paused"]')).toBeVisible();
  await expect(stopped.getByRole('region', { name: "Didn't ship" }).getByRole('heading', { level: 4 })).toHaveCount(1);
}

for (const [label, studio] of MONEY_VARIANTS) {
  test.describe(`the money bands, ${label}`, () => {
    test.use({ studio });
    for (const width of [375, 768, 1440]) {
      test(`find no axe violation, no sideways scroll and no motion under reduced motion at ${width}px`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: 900 });
        for (const path of ['/contribute', '/ledger']) {
          await settle(page, path);
          await moneyBandsDrawn(page, label, path);
          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
          expect(
            results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
            path,
          ).toEqual([]);
          expect(await overflowsHorizontally(page), path).toBe(false);
          expect(await page.evaluate(() => document.getAnimations().length), path).toBe(0);
        }
      });
    }
  });
}

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
