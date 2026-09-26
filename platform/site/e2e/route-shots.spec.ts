import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { legal } from '../src/lib/legal';
import { E2E_ORIGIN } from './fixture-env';
import { expect, test } from './fixtures';
import { isDataRoute, ROUTES } from './routes';
import { SUPPORTER_STUDIO } from './supporter-studio';

// Full-page screenshots of every route in routes.ts at 375, 768 and 1440px with reduced motion, on
// the live-shaped fixture (supporter-studio.ts): the frames the gate's frames job draws on the base
// and on the change, and the Directors' visual review reads (docs/specs/design-review.md). Set
// E2E_ROUTE_SHOTS to a folder to save them as <name>-<width>.png; without it the test is skipped. A
// frame is only a picture of the page when the page drew the fixture: a request to any origin but the
// preview fails the run, and so does a page still loading, or a data route showing its unavailable or
// stale line instead of the fixture's figures, or is still loading.
const SHOTS = process.env.E2E_ROUTE_SHOTS ?? '';
const WIDTHS = [375, 768, 1440];
// Every page's clock reads the fixture's build time, a minute after it, so a page that shows a time
// from the clock (the guide's sample rows) draws the same frame on the base and on the change, and
// the frames job reports only what the change drew differently. Timers keep running.
const SHOT_TIME = new Date('2026-09-22T12:01:00Z');

// What a data route shows in place of its figures when a document did not load (StaleNotice and the
// pages' unavailable states).
// Kernel lines only: the frames job imports no card code into Node (docs/specs/design-review.md).
const UNREADY_LINES = [legal.staleFigures, legal.meterUnavailable, legal.partUnavailable, legal.reportsUnavailable, legal.cardUnavailable];

/**
 * Fails every request to an origin other than the preview's, and returns what was refused, so the
 * test can fail on it: a frame drawn with an outside font, image or script is not the site's.
 */
async function refuseOtherOrigins(page: Page): Promise<string[]> {
  const refused: string[] = [];
  await page.route(
    (url) => url.origin !== E2E_ORIGIN,
    async (route) => {
      refused.push(route.request().url());
      await route.abort('blockedbyclient');
    },
  );
  return refused;
}

/** Loads a route and waits until it is ready to be drawn, or throws saying why it is not. */
async function readyForShot(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  const settled = await page
    .waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, undefined, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  // Other pages may keep a loading line on purpose: the guide shows one as a state, and /thanks waits
  // on a payment that is still being recorded.
  if (isDataRoute(path)) {
    if (!settled) throw new Error(`${path} is still loading: an element has aria-busy="true"`);
    const text = await page.locator('main').innerText();
    const shown = UNREADY_LINES.filter((line) => text.includes(line));
    if (shown.length > 0) throw new Error(`${path} shows ${shown.map((line) => `"${line}"`).join(' and ')} instead of the fixture's figures`);
  }
  await page.waitForTimeout(300);
}

// The launch-shaped studio with the supporter pages' cards, supporters and /thanks answers.
test.use({ studio: SUPPORTER_STUDIO });

test.describe('route screenshots', () => {
  test.skip(SHOTS === '', 'set E2E_ROUTE_SHOTS to save them');
  for (const width of WIDTHS) {
    test(`every route at ${width}px`, async ({ page }) => {
      test.setTimeout(180_000);
      mkdirSync(SHOTS, { recursive: true });
      const refused = await refuseOtherOrigins(page);
      await page.clock.setFixedTime(SHOT_TIME);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of ROUTES) {
        await readyForShot(page, path);
        await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
      }
      expect(refused, 'a page requested an origin other than the preview').toEqual([]);
    });
  }
});

// /reports before the first report (docs/specs/studio-reports.md): its empty state.
test.describe('route screenshots, no report yet', () => {
  test.skip(SHOTS === '', 'set E2E_ROUTE_SHOTS to save them');
  test.use({ studio: { ...SUPPORTER_STUDIO, reports: [] } });
  for (const width of WIDTHS) {
    test(`/reports with none at ${width}px`, async ({ page }) => {
      mkdirSync(SHOTS, { recursive: true });
      const refused = await refuseOtherOrigins(page);
      await page.clock.setFixedTime(SHOT_TIME);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      await readyForShot(page, '/reports');
      await page.screenshot({ path: join(SHOTS, `reports-empty-${width}.png`), fullPage: true });
      expect(refused, 'a page requested an origin other than the preview').toEqual([]);
    });
  }
});

// The checks above, proved on pages that are not ready (these run in every e2e run, with or without
// E2E_ROUTE_SHOTS): a failing /api/live leaves home unavailable, and an outside request is refused.
test.describe('route screenshots refuse a page that did not draw the fixture', () => {
  test('a data route whose /api/live failed fails the screenshot', async ({ page }) => {
    await page.route(/\/api\/live(\?.*)?$/, (route) => route.fulfill({ status: 503, contentType: 'application/json; charset=utf-8', body: '{"error":"unavailable"}' }));
    await expect(readyForShot(page, '/')).rejects.toThrow(/instead of the fixture's figures|is still loading/);
  });

  test('a card whose /api/card document failed fails the screenshot', async ({ page }) => {
    const [, path] = ROUTES.find(([name]) => name === 'card-live')!;
    await page.route(/\/api\/card\//, (route) => route.fulfill({ status: 503, contentType: 'application/json; charset=utf-8', body: '{"error":"unavailable"}' }));
    await expect(readyForShot(page, path)).rejects.toThrow(/instead of the fixture's figures|is still loading/);
  });

  test('a request to another origin is refused and named', async ({ page }) => {
    const refused = await refuseOtherOrigins(page);
    await readyForShot(page, '/how-it-works');
    expect(refused).toEqual([]);
    await page.goto('https://example.com/').catch(() => null);
    expect(refused).toEqual(['https://example.com/']);
  });
});
