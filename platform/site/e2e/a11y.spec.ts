import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { LIVE_CARD_ID, SUPPORTER_STUDIO } from './supporter-studio';

// The WCAG 2.2 AA audit's checks: axe on the main public routes at a phone and a desktop width,
// failing on any serious or critical violation, with motion allowed so the explainer's preview loop
// and its pause control are scanned too; the loop's pause (2.2.2), the focus ring's contrast on paper
// and on the dark bands (2.4.7, 1.4.11) and the cards' live region (4.1.3). axe is injected by
// Playwright, which the production CSP would refuse: this runs on the e2e server only, and
// csp.spec.ts still checks the policy itself. SUPPORTER_STUDIO draws every page and the card pages.
test.use({ studio: SUPPORTER_STUDIO });

const ROUTES = ['/', '/how-it-works', '/contribute', '/reports', `/card/${LIVE_CARD_ID}`, '/ledger', '/team', '/privacy'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

/** The relative luminance contrast of two computed rgb() colours. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

for (const [label, width] of [['mobile', 375], ['desktop', 1440]] as const) {
  test(`axe finds no serious or critical violation on the main routes (${label}, ${width}px)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const found: string[] = [];
    for (const path of ROUTES) {
      await settle(page, path);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      for (const v of results.violations) {
        if (v.impact === 'serious' || v.impact === 'critical') {
          found.push(`${path} ${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
}

// Home draws the still only (the board, 18 October 2026: in the small frame the loop read as a blank
// panel), so the loop and its control are How it works' alone.
test("home's explainer is the still, with no loop and no loop control", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page, '/');
  await expect(page.getByRole('button', { name: 'Play the video' })).toBeVisible();
  await expect(page.locator('.explainer-loop')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /the preview/ })).toHaveCount(0);
});

for (const path of ['/how-it-works']) {
  test(`the explainer's preview loop pauses and plays from the keyboard on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page, path);
    const loop = page.locator('.explainer-loop');
    const pause = page.getByRole('button', { name: 'Pause the preview' });
    await expect(pause).toBeVisible();
    await pause.focus();
    await page.keyboard.press('Enter');
    const play = page.getByRole('button', { name: 'Play the preview' });
    await expect(play).toBeFocused();
    await expect.poll(() => loop.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    // Pausing the loop does not start the full video.
    await expect(page.getByRole('button', { name: 'Play the video' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause the preview' })).toBeFocused();
  });
}

for (const path of ['/', '/how-it-works']) {
  test(`under reduced motion the explainer stays a still with no loop control on ${path}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle(page, path);
    await expect(page.locator('.explainer-loop')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /the preview/ })).toHaveCount(0);
  });
}

test('the focus ring keeps 3:1 against the ground on paper and on the dark bands', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page, '/');
  const rings: { where: string; ring: string; ground: string }[] = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab');
    const read = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el === null || el === document.body) return null;
      const style = getComputedStyle(el);
      if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) < 2) return { where: el.outerHTML.slice(0, 80), ring: 'none', ground: '' };
      // The ground the ring is drawn on: the nearest ancestor (or, on the edge, the element) with a fill.
      let node: HTMLElement | null = parseFloat(style.outlineOffset) <= 0 ? el : el.parentElement;
      let ground = 'rgba(0, 0, 0, 0)';
      // An agent in the live studio stands on the room's own paper floor, which the drawing fills, not
      // a box: its ground is the stage's paper.
      const stage = el.closest('svg.room')?.closest<HTMLElement>('.studio-stage');
      if (stage) {
        const probe = document.createElement('span');
        probe.style.background = 'var(--paper)';
        stage.append(probe);
        ground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { where: el.outerHTML.slice(0, 80), ring: style.outlineColor, ground };
      }
      while (node !== null) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          ground = bg;
          break;
        }
        node = node.parentElement;
      }
      return { where: el.outerHTML.slice(0, 80), ring: style.outlineColor, ground };
    });
    if (read !== null) rings.push(read);
  }
  expect(rings.length).toBeGreaterThan(5);
  for (const { where, ring, ground } of rings) {
    expect(ring, where).not.toBe('none');
    expect(contrast(ring, ground), `${where}: ${ring} on ${ground}`).toBeGreaterThanOrEqual(3);
  }
  // The walk crossed a dark ground, so the light ring was checked too.
  expect(rings.some(({ ground }) => contrast(ground, 'rgb(255, 255, 255)') > 3)).toBe(true);
});

test('the cards say once, politely, how many arrived', async ({ page }) => {
  for (const path of ['/', '/contribute']) {
    await settle(page, path);
    const status = page.locator('[data-cards-status]');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveText(/^\d+ cards? loaded\.$/);
  }
});
