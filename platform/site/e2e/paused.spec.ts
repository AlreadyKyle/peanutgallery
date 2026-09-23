import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STUDIO, expect, overflowsHorizontally, test, WIDTHS } from './fixtures';

const NOTICE = 'The agents are paused. Funded cards keep their money and wait in the queue until the board resumes them.';
const SHOTS = process.env.E2E_SCREENSHOTS ?? '';

test.use({ studio: { ...DEFAULT_STUDIO, paused: true } });

for (const viewport of WIDTHS) {
  test.describe(`paused, at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('the landing, /contribute and /how-it-works say the agents are paused', async ({ page }) => {
      await page.goto('/');
      const panel = page.getByRole('complementary');
      await expect(panel.getByText(NOTICE)).toBeVisible();
      await expect(panel.getByText('Nothing is building while the agents are paused.')).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);
      if (SHOTS !== '') {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `landing-paused-${viewport.width}.png`) });
      }

      await page.goto('/contribute');
      await expect(page.getByRole('main').getByText(NOTICE)).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);

      await page.goto('/how-it-works');
      await expect(page.getByRole('main').getByText(NOTICE)).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);
    });
  });
}
