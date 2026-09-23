import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STUDIO, expect, overflowsHorizontally, test, WIDTHS } from './fixtures';

const NOTICE = 'The agents are paused. Funded cards keep their money and wait in the queue until the board resumes them.';
const SHOTS = process.env.E2E_SCREENSHOTS ?? '';

test.use({ studio: { ...DEFAULT_STUDIO, paused: true } });

for (const viewport of WIDTHS) {
  test.describe(`paused, at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('home says it in the status line, and /contribute and /how-it-works in the notice on the signal plate', async ({ page }) => {
      await page.goto('/');
      const status = page.locator('main > .band:first-child p.status-line');
      await expect(status).toHaveText('2 cards are open for funding. The agents are paused.');
      await expect(status.locator('svg[data-glyph="pause"]')).toHaveCount(1);
      // Home says the pause once: in the status line, and nowhere else.
      await expect(page.getByText(NOTICE)).toHaveCount(0);
      // The team strip shows running agents, drawn awake even while the studio is paused (the board, 23 Sep 2026).
      await expect(page.locator('.team-strip svg.avatar[data-pose="awake"]')).toHaveCount(3);
      expect(await overflowsHorizontally(page)).toBe(false);
      if (SHOTS !== '') {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `landing-paused-${viewport.width}.png`) });
      }

      for (const path of ['/contribute', '/how-it-works']) {
        await page.goto(path);
        // One plain line in the page's first band, under its heading: the notice qualifies the page.
        await expect(page.locator('main > .band:first-child .hero p.notice')).toHaveText(NOTICE);
        expect(await overflowsHorizontally(page)).toBe(false);
      }
    });
  });
}
