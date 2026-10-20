import { expect, test, WIDTHS } from './fixtures';

// The top bar stays at the top of the window however far the page scrolls (DESIGN.md, Top bar; the
// board, 18 October 2026: the bar went away once the page scrolled), and nothing that sticks below it
// slides under it.
const PAGES = ['/', '/how-it-works', '/suggest', '/ledger', '/faq'];

for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    for (const path of PAGES) {
      test(`the top bar stays at the top of ${path} while it scrolls and after it stops`, async ({ page }) => {
        await page.goto(path);
        const bar = page.getByRole('banner');
        await expect(bar).toBeVisible();
        const top = () => bar.evaluate((el) => Math.round(el.getBoundingClientRect().top));
        expect(await top()).toBe(0);

        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 300);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
        expect(await top()).toBe(0);
        // Still there once the page has come to rest.
        await page.waitForTimeout(600);
        expect(await top()).toBe(0);
        await expect(bar.getByRole('link', { name: 'Mob Machine' })).toBeInViewport();

        // Whatever sticks below the bar holds at its foot or lower, never under it.
        const under = await page.evaluate(() => {
          const foot = document.querySelector('.topbar')!.getBoundingClientRect().bottom;
          return [...document.querySelectorAll<HTMLElement>('main *')]
            .filter((el) => getComputedStyle(el).position === 'sticky' && el.offsetParent !== null)
            .map((el) => ({ el, top: parseFloat(getComputedStyle(el).top) }))
            .filter(({ top }) => Number.isFinite(top) && top < foot - 0.5)
            .map(({ el }) => el.className);
        });
        expect(under).toEqual([]);
      });
    }
  });
}

// Home's studio shrinks onto the rail's map as the page scrolls, from 64rem and with motion allowed
// (docs/specs/place.md, The floor; DESIGN.md, Motion).
test.describe('home studio shrink', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('runs from the plate to the rail and back, and lands with the map in charge', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const main = page.getByRole('main');
    const room = main.locator('.floor-plate .studio-frame');
    await expect(main.locator('.floor-plate .studio-agent').first()).toBeVisible();
    await expect(main).toHaveAttribute('data-morph', 'start');

    const end = await page.evaluate(() => {
      const floor = document.querySelector('.floor')!;
      const rail = document.querySelector('.floor-rail')!;
      return floor.getBoundingClientRect().top + window.scrollY - parseFloat(getComputedStyle(rail).top);
    });
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(end / 2));
    await expect(main).toHaveAttribute('data-morph', 'on');
    await expect(room).toHaveCSS('transform', /matrix/);

    await page.evaluate((y) => window.scrollTo(0, y), Math.round(end) + 200);
    await expect(main).toHaveAttribute('data-morph', 'done');
    await expect(room).toHaveAttribute('inert', '');
    await expect(room).toHaveCSS('opacity', '0');
    await expect(main.locator('.floor-map')).toHaveCSS('opacity', '1');
    // Landed, the big room sits exactly over the map.
    const [big, small] = await Promise.all([room.boundingBox(), main.locator('.floor-map .studio-frame').boundingBox()]);
    expect(Math.abs(big!.x - small!.x)).toBeLessThan(1.5);
    expect(Math.abs(big!.y - small!.y)).toBeLessThan(1.5);
    expect(Math.abs(big!.width - small!.width)).toBeLessThan(1.5);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(main).toHaveAttribute('data-morph', 'start');
    await expect(room).not.toHaveAttribute('inert', '');
    await expect(room).toHaveCSS('opacity', '1');
  });

  test('stays still under reduced motion and below 64rem', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const main = page.getByRole('main');
    await expect(main.locator('.floor-plate .studio-agent').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(main).not.toHaveAttribute('data-morph', /.*/);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 768, height: 1000 });
    // A fresh navigation rather than page.reload(), once the first load has settled: on main's gate a
    // reload here once aborted (net::ERR_ABORTED, frame detached) though the same code passed before.
    await page.waitForLoadState('load');
    await page.goto(page.url(), { waitUntil: 'load' });
    await expect(main.locator('.floor-plate .studio-agent').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(main).not.toHaveAttribute('data-morph', /.*/);
  });
});
