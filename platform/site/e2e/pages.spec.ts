import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { RUNNING_MODEL, runningModelsCheck } from '../scripts/team-models.mjs';
import { PAYMENT_LINK } from './fixture-env';
import { DEFAULT_STUDIO, expect, overflowsHorizontally, test, WIDTHS } from './fixtures';

// Set E2E_SCREENSHOTS to a folder to save a full-page screenshot of each new page at each width.
const SHOTS = process.env.E2E_SCREENSHOTS ?? '';

async function screenshot(page: Page, name: string, width: number): Promise<void> {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
}

async function onlyOneH1(page: Page, title: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText([title]);
  await expect(page).toHaveTitle(`${title} · Peanut Gallery`);
}

for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('/how-it-works shows six labelled examples, no payment link and no overflow', async ({ page }) => {
      await page.goto('/how-it-works');
      await onlyOneH1(page, 'How it works');
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 2 })).toHaveText([
        /Pick a card$/,
        /Contribute and choose the split$/,
        /The bar fills$/,
        /The agents build it$/,
        /Checks, then live$/,
        /It shows under Shipped$/,
        'Where the money goes',
        'Holds and refunds',
        'Rules that never change',
      ]);
      const examples = main.locator('figure.example');
      await expect(examples).toHaveCount(6);
      for (const label of await examples.locator('figcaption').allTextContents()) expect(label).toMatch(/^Example/);
      // Real records where they exist: the fixture's open, queued and shipped cards, its events and deploys.
      await expect(examples.nth(0)).toContainText('Quiet rooms: one more unlock');
      await expect(examples.nth(2)).toContainText('A cheaper Cart');
      await expect(examples.nth(5)).toContainText('The unlock list fits any number of unlocks');
      // Nothing on the page can start a payment or leave for the game.
      const html = await page.content();
      expect(html).not.toContain(PAYMENT_LINK);
      expect(html).not.toContain('client_reference_id');
      await expect(examples.locator('a, button, details')).toHaveCount(0);
      await expect(main.getByText('Fund this card')).toHaveCount(0);
      await expect(page.getByText(/\bvot(e|es|ing)\b/i)).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
      await screenshot(page, 'how-it-works', viewport.width);
    });

    test('/team lists the running agents and the ones not running yet, with code-drawn avatars', async ({ page }) => {
      await page.goto('/team');
      await onlyOneH1(page, 'The team');
      const running = page.getByRole('region', { name: 'Running', exact: true });
      const waiting = page.getByRole('region', { name: 'Not running yet', exact: true });
      await expect(running.getByRole('heading', { level: 3 })).toHaveText(['Builder A', 'Builder B', 'QA']);
      await expect(waiting.getByRole('heading', { level: 3 })).toHaveText([
        'Biz Dev',
        'Community',
        'Game Designer',
        'Game Director',
        'Head of Finance',
        'Head of Product',
        'Host',
        'HR',
        'Janitor',
        'Platform Builder',
        'Platform Director',
        'Studio Head',
        'Tech Artist',
      ]);
      const avatars = page.getByRole('main').getByRole('img');
      await expect(avatars).toHaveCount(DEFAULT_STUDIO.roles.length);
      for (const role of DEFAULT_STUDIO.roles) {
        await expect(page.getByRole('img', { name: String(role.species_note) })).toBeVisible();
      }
      // A running role shows its model; a role that does not run shows none.
      await expect(running.getByText('claude-opus-5-5', { exact: false })).toHaveCount(3);
      await expect(waiting.getByText('claude-', { exact: false })).toHaveCount(0);
      // The check scripts/live-check.mjs runs on production, on the same locators.
      const models = runningModelsCheck(await running.locator('li.agent .card-meta').allTextContents());
      expect(models).toEqual({ ok: true, message: `/team 3 running roles, each on ${RUNNING_MODEL}: ${Array(3).fill(RUNNING_MODEL).join(', ')}` });
      await expect(waiting.getByText(/\bclaude-/)).toHaveCount(0);
      await expect(running.getByText('2 cards shipped', { exact: false })).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);
      await screenshot(page, 'team', viewport.width);
    });

    test('/roadmap lists next and later cards as planned, with no bars or fund links', async ({ page }) => {
      await page.goto('/roadmap');
      await onlyOneH1(page, 'Roadmap');
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 2 })).toHaveText(['Next', 'Later']);
      await expect(page.getByRole('region', { name: 'Next', exact: true }).getByRole('heading', { level: 3 })).toHaveText([
        'Choose the next card without paying',
        'The Studio Head drafts cards from the roadmap',
        'Board on its own site',
      ]);
      await expect(page.getByRole('region', { name: 'Later', exact: true }).getByRole('heading', { level: 3 })).toHaveText([
        'A second area in Dust',
        'Image adapter for studio pictures',
      ]);
      await expect(main.getByText('Planned and not built yet')).toHaveCount(5);
      await expect(main.getByRole('progressbar')).toHaveCount(0);
      await expect(main.getByRole('link')).toHaveCount(0);
      await expect(main.getByText('Rename the Gatherer to Sweeper')).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
      await screenshot(page, 'roadmap', viewport.width);
    });
  });
}

// The /team check live-check.mjs runs on production (scripts/team-models.mjs), on rosters it must fail.
const CARD_ROLES = new Set(['Builder A', 'Builder B', 'QA', 'Platform Builder']);

test.describe('the production /team model check', () => {
  test.describe('after a re-seed that left the builders on an older model', () => {
    test.use({
      studio: { ...DEFAULT_STUDIO, roles: DEFAULT_STUDIO.roles.map((role) => (CARD_ROLES.has(String(role.title)) ? { ...role, model: 'claude-sonnet-5' } : role)) },
    });

    test('fails, naming the model it found', async ({ page }) => {
      await page.goto('/team');
      const running = page.getByRole('region', { name: 'Running', exact: true });
      await expect(running.getByRole('heading', { level: 3 })).toHaveText(['Builder A', 'Builder B', 'QA']);
      const models = runningModelsCheck(await running.locator('li.agent .card-meta').allTextContents());
      expect(models).toEqual({ ok: false, message: `/team 3 running roles, each on ${RUNNING_MODEL}: claude-sonnet-5, claude-sonnet-5, claude-sonnet-5` });
    });
  });

  test.describe('with no role running', () => {
    test.use({
      studio: { ...DEFAULT_STUDIO, roles: DEFAULT_STUDIO.roles.map((role) => (CARD_ROLES.has(String(role.title)) ? { ...role, state: 'retired' } : role)) },
    });

    test('fails, since the Running section is missing', async ({ page }) => {
      await page.goto('/team');
      await expect(page.getByRole('region', { name: 'Not running yet', exact: true })).toBeVisible();
      const running = page.getByRole('region', { name: 'Running', exact: true });
      await expect(running).toHaveCount(0);
      const models = runningModelsCheck(await running.locator('li.agent .card-meta').allTextContents());
      expect(models).toEqual({ ok: false, message: `/team 0 running roles, each on ${RUNNING_MODEL}: none` });
    });
  });
});
