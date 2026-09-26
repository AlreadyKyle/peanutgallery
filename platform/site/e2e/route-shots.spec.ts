import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './fixtures';
import { SUPPORTER_ROUTES, SUPPORTER_STUDIO } from './supporter-studio';

// Full-page screenshots of every public route at 375, 768 and 1440px with reduced motion, on the
// live-shaped fixture (supporter-studio.ts), for a design review (docs/specs/home-and-design.md). Set E2E_ROUTE_SHOTS to a
// folder to save them; without it the test is skipped.
const SHOTS = process.env.E2E_ROUTE_SHOTS ?? '';
const ROUTES: [string, string][] = [
  ['home', '/'],
  ['contribute', '/contribute'],
  ['ledger', '/ledger'],
  ['how-it-works', '/how-it-works'],
  ['team', '/team'],
  ['roadmap', '/roadmap'],
  ['reports', '/reports'],
  ['terms', '/terms'],
  ['privacy', '/privacy'],
  ['refunds', '/refunds'],
  ['contact', '/contact'],
  ['not-found', '/no-such-page'],
  ['guide', '/design-kit-7q4m'],
  ...SUPPORTER_ROUTES,
];

// The launch-shaped studio with the supporter pages' cards, supporters and /thanks answers.
test.use({ studio: SUPPORTER_STUDIO });

test.describe('route screenshots', () => {
  test.skip(SHOTS === '', 'set E2E_ROUTE_SHOTS to save them');
  for (const width of [375, 768, 1440]) {
    test(`every public route at ${width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      mkdirSync(SHOTS, { recursive: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path] of ROUTES) {
        await page.goto(path);
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
      }
    });
  }
});

// /reports before the first report (docs/specs/studio-reports.md): its empty state.
test.describe('route screenshots, no report yet', () => {
  test.skip(SHOTS === '', 'set E2E_ROUTE_SHOTS to save them');
  test.use({ studio: { ...SUPPORTER_STUDIO, reports: [] } });
  for (const width of [375, 768, 1440]) {
    test(`/reports with none at ${width}px`, async ({ page }) => {
      mkdirSync(SHOTS, { recursive: true });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/reports');
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(SHOTS, `reports-empty-${width}.png`), fullPage: true });
    });
  }
});
