import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './fixtures';
import { LIVE_STUDIO } from './live-studio';

// Full-page screenshots of every public route at 375, 768 and 1440px with reduced motion, on the
// live-shaped fixture, for a design review (docs/specs/home-and-design.md). Set E2E_ROUTE_SHOTS to a
// folder to save them; without it the test is skipped.
const SHOTS = process.env.E2E_ROUTE_SHOTS ?? '';
const ROUTES: [string, string][] = [
  ['home', '/'],
  ['contribute', '/contribute'],
  ['ledger', '/ledger'],
  ['how-it-works', '/how-it-works'],
  ['team', '/team'],
  ['roadmap', '/roadmap'],
  ['terms', '/terms'],
  ['privacy', '/privacy'],
  ['refunds', '/refunds'],
  ['contact', '/contact'],
  ['not-found', '/no-such-page'],
];

test.use({ studio: LIVE_STUDIO });

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
