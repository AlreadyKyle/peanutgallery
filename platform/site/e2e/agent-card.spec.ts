// A card the Game Designer drafted (docs/specs/agent-workflows.md): its face on the fund grid and
// its row on /roadmap carry "Written by the Game Designer, an AI agent", and no card the board filed
// does; side by side, the byline keeps a track of its own above the funding bar. Set E2E_SCREENSHOTS
// to a folder to save each page at each width.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { DEFAULT_STUDIO, expect, fundingOrder, moneyRow, overflowsHorizontally, test, WIDTHS } from './fixtures';

const SHOTS = process.env.E2E_SCREENSHOTS ?? '';
const BYLINE = 'Written by the Game Designer, an AI agent';

async function screenshot(page: Page, name: string, width: number): Promise<void> {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
}

const designer = DEFAULT_STUDIO.roles.find((role) => role.title === 'Game Designer')!;
const [RENAME, QUIET] = DEFAULT_STUDIO.cards as Record<string, unknown>[];
const drafted = (fields: Record<string, unknown>): Record<string, unknown> => ({
  ...RENAME,
  source: 'agent',
  drafter_role_id: designer.id,
  funding_target_usd: '0.5000',
  funded_usd: '0.0000',
  rank: null,
  ...fields,
});
// Dealt to now and open for funding, first in line.
const DEALT = drafted({ id: '00000000-0000-4000-8000-0000000000a1', title: 'Gatherers cost 11', summary: 'The gatherer costs one more to build.', horizon: 'now' });
// Approved and waiting out the cooling window on next.
const WAITING = drafted({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Sweepers cost 12', summary: 'The sweeper costs one more to build.', horizon: 'next', rank: 4 });
// A fourth open card the board filed, so the drafted card shares its row at two columns and at three.
const FILED = { ...RENAME, id: '00000000-0000-4000-8000-0000000000a3', title: 'Sweepers glow at night', summary: 'The sweeper lights up after dark.', funded_usd: '0.0000', rank: null };

test.use({
  studio: {
    ...DEFAULT_STUDIO,
    cards: [...DEFAULT_STUDIO.cards, DEALT, WAITING, FILED],
    money: moneyRow({ ...DEFAULT_STUDIO.money, funding_order: fundingOrder([DEALT.id, QUIET!.id, RENAME!.id, FILED.id]) }),
  },
});

for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('the drafted card on the fund grid says the Game Designer wrote it, and no other card says so', async ({ page }) => {
      await page.goto('/');
      const face = page.locator(`li.card[data-card="${DEALT.id}"]`);
      await expect(face.locator('.card-byline')).toHaveText(BYLINE);
      await expect(face.locator('.card-summary + .card-byline')).toHaveCount(1);
      await expect(page.locator('.card-byline')).toHaveCount(1);
      expect(await overflowsHorizontally(page)).toBe(false);
      await screenshot(page, 'home-agent-card', viewport.width);
    });

    test('/roadmap shows the line on the waiting agent card only', async ({ page }) => {
      await page.goto('/roadmap');
      const next = page.getByRole('region', { name: 'Next' });
      const row = next.locator('li', { has: page.getByRole('heading', { name: String(WAITING.title) }) });
      await expect(row.locator('.card-byline')).toHaveText(BYLINE);
      await expect(page.locator('.card-byline')).toHaveCount(1);
      expect(await overflowsHorizontally(page)).toBe(false);
      await screenshot(page, 'roadmap-agent-card', viewport.width);
    });
  });
}

// Side by side from 48rem, a card's parts share its row's tracks (styles.css, the card subgrid). The
// byline has a track of its own, so it never sits on the funding bar, and every bar in its row still
// lines up.
for (const viewport of [{ width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
  test(`at ${viewport.width}px the byline ends above the bottom block, and the bars in its row line up`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const face = page.locator(`li.card[data-card="${DEALT.id}"]`);
    await expect(face.locator('.card-byline')).toHaveText(BYLINE);
    const [summary, byline, bottom] = await Promise.all(['.card-summary', '.card-byline', '.card-bottom'].map((part) => face.locator(part).boundingBox()));
    expect(byline!.y).toBeGreaterThanOrEqual(summary!.y + summary!.height);
    expect(byline!.y + byline!.height).toBeLessThanOrEqual(bottom!.y);
    const bars = await page.evaluate((id) => {
      const card = document.querySelector(`li.card[data-card="${id}"]`)!;
      const top = card.getBoundingClientRect().top;
      return [...card.parentElement!.children]
        .filter((other) => Math.abs(other.getBoundingClientRect().top - top) < 1)
        .map((other) => other.querySelector('.card-bottom')!.getBoundingClientRect().top);
    }, String(DEALT.id));
    expect(bars.length, 'the drafted card shares its row').toBeGreaterThan(1);
    for (const bar of bars) expect(Math.abs(bar - bars[0]!)).toBeLessThanOrEqual(1);
    await screenshot(page, 'home-agent-card-row', viewport.width);
  });
}
