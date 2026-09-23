// A card the Game Designer drafted (docs/specs/agent-workflows.md): its face on the fund grid and
// its row on /roadmap carry "Written by the Game Designer, an AI agent", and no card the board filed
// does. Set E2E_SCREENSHOTS to a folder to save each page at each width.
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
const drafted = (fields: Record<string, unknown>) => ({
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

test.use({
  studio: {
    ...DEFAULT_STUDIO,
    cards: [...DEFAULT_STUDIO.cards, DEALT, WAITING],
    money: moneyRow({ ...DEFAULT_STUDIO.money, funding_order: fundingOrder([DEALT.id, QUIET!.id, RENAME!.id]) }),
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
