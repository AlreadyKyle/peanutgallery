import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STUDIO, expect, overflowsHorizontally, test, WIDTHS } from './fixtures';

// The paused notice and home's status line say the same sentence, pausedSentence: the reason's, or
// the general line when public_studio names none (docs/specs/money-surfaces.md).
const NOTICE = 'The agents are paused. Funded cards keep their money and wait in the queue until the board resumes them.';
const REASONS: Record<string, string> = {
  awaiting_credit:
    "The agents are paused while the studio waits for Stripe to pay out contributions, which buy the agents' model credit. Cards funded now keep their money and wait in the queue.",
  spend_limit:
    'The agents are paused because the studio reached its monthly limit on model usage. Funded cards keep their money and wait in the queue until the board resumes them.',
  incident: 'The agents are paused while the board checks a problem. Funded cards keep their money and wait in the queue until the board resumes them.',
  board: 'The board has paused the agents. Funded cards keep their money and wait in the queue until the board resumes them.',
};
const SHOTS = process.env.E2E_SCREENSHOTS ?? '';

test.describe('paused with no reason', () => {
  test.use({ studio: { ...DEFAULT_STUDIO, paused: true } });

  for (const viewport of WIDTHS) {
    test.describe(`at ${viewport.width} px`, () => {
      test.use({ viewport });

      test('home says it in the status line, and /contribute and /how-it-works in the notice on the signal plate', async ({ page }) => {
        await page.goto('/');
        const status = page.locator('main > .band:first-child p.status-line');
        await expect(status).toHaveText(`2 cards are open for funding. ${NOTICE}`);
        await expect(status.locator('svg[data-glyph="pause"]')).toHaveCount(1);
        // Home says the pause once: in the status line, and nowhere else.
        await expect(page.locator('main p.notice')).toHaveCount(0);
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
});

for (const [reason, sentence] of Object.entries(REASONS)) {
  test.describe(`paused for ${reason}`, () => {
    test.use({ studio: { ...DEFAULT_STUDIO, paused: true, pauseReason: reason } });

    test('home and /contribute say the same sentence', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('main > .band:first-child p.status-line')).toHaveText(`2 cards are open for funding. ${sentence}`);
      await page.goto('/contribute');
      await expect(page.locator('main > .band:first-child .hero p.notice')).toHaveText(sentence);
    });
  });
}

test.describe('not paused, with a stale reason', () => {
  test.use({ studio: { ...DEFAULT_STUDIO, paused: false, pauseReason: 'incident' } });

  test('says nothing about a pause', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main > .band:first-child p.status-line')).toHaveText('2 cards are open for funding.');
    await page.goto('/contribute');
    await expect(page.locator('main p.notice')).toHaveCount(0);
  });
});
