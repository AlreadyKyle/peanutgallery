import { DEFAULT_STUDIO, expect, overflowsHorizontally, test, WIDTHS } from './fixtures';

// The public site shows no paused notice and no paused sentence (docs/PLAN.md §10 decision 62): the
// pause itself still works (studio_state.paused, the board's Pause, the dispatcher), but no public
// page says the agents are paused, whatever the reason.
const PAGES = ['/', '/contribute', '/how-it-works', '/team'];

for (const reason of [null, 'awaiting_credit', 'spend_limit', 'incident', 'board']) {
  test.describe(`paused for ${reason ?? 'no reason'}`, () => {
    test.use({ studio: { ...DEFAULT_STUDIO, paused: true, pauseReason: reason } });

    for (const viewport of reason === null ? WIDTHS : WIDTHS.slice(0, 1)) {
      test(`no page says the agents are paused at ${viewport.width} px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/');
        await expect(page.locator('main > .band:first-child p.status-line')).toHaveText('2 cards are open for funding.');
        await expect(page.locator('p.status-line svg[data-glyph="pause"]')).toHaveCount(0);
        await expect(page.locator('.team-strip svg.avatar[data-pose="awake"]')).toHaveCount(3);
        for (const path of PAGES) {
          await page.goto(path);
          await expect(page.locator('main h1')).toBeVisible();
          await expect(page.locator('main p.notice')).toHaveCount(0);
          await expect(page.locator('main')).not.toContainText(/The agents are paused|The board has paused the agents/);
          await expect(page.locator('li.agent[data-status="paused"]')).toHaveCount(0);
          expect(await overflowsHorizontally(page)).toBe(false);
        }
      });
    }
  });
}
