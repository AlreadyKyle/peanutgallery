import { expect, test } from './fixtures';

// /studio/history's era slider (docs/specs/final-state.md, Studio evolution and history): Earlier, the
// slider and Later in one row where the row is wide enough; on a phone (below 30rem) the two buttons
// left the slider 24px between them at 320px, so it takes a full-width row of its own over them.

const era = (index: number, id: string, name: string, reachedAt: string | null) => ({
  id,
  index,
  name,
  reachedAt,
  unlockedBy: 'Where the studio starts.',
  stations: ['desks', 'whiteboard'],
  decor: [],
});
const ERAS = [era(0, 'garage', 'Garage', '2026-10-01T00:00:00Z'), era(1, 'loft', 'Loft', null), era(2, 'warehouse', 'Warehouse', null)];

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/community\/studio$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ era: ERAS[0], eras: ERAS }) }),
  );
});

for (const width of [320, 375, 414, 1440]) {
  test(`the era slider keeps a usable width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/studio/history');
    const slider = page.getByRole('slider');
    await expect(slider).toBeVisible();
    const box = (await slider.boundingBox())!;
    const earlier = (await page.getByRole('button', { name: 'Earlier' }).boundingBox())!;
    const later = (await page.getByRole('button', { name: 'Later' }).boundingBox())!;
    const stepper = (await page.locator('.era-stepper').boundingBox())!;
    if (width < 480) {
      // Its own row, the stepper's full width, over Earlier and Later.
      expect(Math.abs(box.width - stepper.width)).toBeLessThanOrEqual(1);
      expect(box.y + box.height).toBeLessThanOrEqual(Math.min(earlier.y, later.y));
    } else {
      // One row: Earlier, the slider, Later.
      expect(box.x).toBeGreaterThanOrEqual(earlier.x + earlier.width);
      expect(box.x + box.width).toBeLessThanOrEqual(later.x);
    }
    expect(box.width).toBeGreaterThanOrEqual(120);
    // The slider still moves through the eras.
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', 'Loft');
  });
}
