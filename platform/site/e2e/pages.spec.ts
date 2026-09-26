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

// The roles the roster marks running whose lane is open, in /team's order (by title).
const RUNNING_ROLES = ['Builder A', 'Builder B', 'Game Designer', 'Game Director', 'Platform Director', 'QA', 'Studio Head'];

async function onlyOneH1(page: Page, title: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText([title]);
  await expect(page).toHaveTitle(`${title} · Mob Machine`);
}

// /how-it-works steps 1 and 3 draw one example card in a dashed frame. The card is one three-column
// cell wide (at most 23rem, docs/specs/grid-boxes.md Behaviour 5) and the frame hugs it, so the card
// fills the frame's inner width and no empty column runs beside it inside the dashed edge.
for (const width of [375, 768, 1024, 1440]) {
  test(`/how-it-works: each example card fills its dashed frame at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/how-it-works');
    const frames = page.locator('figure.example:has(> ul.card-grid)');
    await expect(frames).toHaveCount(2);
    for (const frame of await frames.all()) {
      const measure = await frame.evaluate((el) => {
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        const inner = b.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { inner, card: el.querySelector('li.card')!.getBoundingClientRect().width };
      });
      expect(Math.abs(measure.inner - measure.card), JSON.stringify(measure)).toBeLessThanOrEqual(2);
      expect(measure.card).toBeLessThanOrEqual(368.5);
    }
  });
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

    test('/team puts each role in Running, Starts later or Planned from the roster columns, with code-drawn avatars', async ({ page }) => {
      await page.goto('/team');
      await onlyOneH1(page, 'The team');
      const running = page.getByRole('region', { name: 'Running', exact: true });
      const starts = page.getByRole('region', { name: 'Starts later', exact: true });
      const planned = page.getByRole('region', { name: 'Planned', exact: true });
      await expect(running.getByRole('heading', { level: 3 })).toHaveText(RUNNING_ROLES);
      // Every starts role with its trigger; the Platform Builder waits on the platform code lane.
      await expect(starts.getByRole('heading', { level: 3 })).toHaveText([
        'Biz Dev',
        'Community',
        'Head of Finance',
        'Head of Product',
        'HR',
        'Janitor',
        'Platform Builder',
        'Tech Artist',
      ]);
      await expect(starts.locator('#agent-r-platform-builder')).toContainText('Starts when the board opens the studio code lane.');
      await expect(starts.locator('#agent-r-community')).toContainText('Starts once a named moderator is in place for the community channels.');
      await expect(planned.getByRole('heading', { level: 3 })).toHaveText(['Host']);
      const avatars = page.getByRole('main').getByRole('img');
      await expect(avatars).toHaveCount(DEFAULT_STUDIO.roles.length);
      for (const role of DEFAULT_STUDIO.roles) {
        await expect(page.getByRole('img', { name: String(role.species_note) })).toBeVisible();
      }
      // A running role shows its model, its cost from contributions and its ships; a role that does not run shows none.
      await expect(running.getByText('claude-opus-5-5', { exact: false })).toHaveCount(RUNNING_ROLES.length);
      await expect(running.locator('#agent-r-builder-a .card-meta')).toHaveText(
        'claude-opus-5-5 · Spent from contributions $0.00, $0.00 in the last 7 days · Worked on 0 shipped cards',
      );
      for (const region of [starts, planned]) {
        await expect(region.getByText(/\bclaude-/)).toHaveCount(0);
        await expect(region.getByText('Spent from contributions')).toHaveCount(0);
        await expect(region.locator('.card-meta')).toHaveCount(0);
      }
      // The check scripts/live-check.mjs runs on production, on the same locators.
      const models = runningModelsCheck(await running.locator('li.agent .card-meta').allTextContents());
      expect(models).toEqual({ ok: true, message: `/team ${RUNNING_ROLES.length} running roles, each on ${RUNNING_MODEL}: ${Array(RUNNING_ROLES.length).fill(RUNNING_MODEL).join(', ')}` });
      // Nothing is paused: every avatar is awake and no row says Paused.
      await expect(page.locator('svg.avatar[data-pose="asleep"]')).toHaveCount(DEFAULT_STUDIO.roles.length - RUNNING_ROLES.length);
      await expect(running.locator('li.agent[data-status="paused"]')).toHaveCount(0);
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

// Every path to checkout states the agreement first (docs/specs/legal-copy.md): each Payment Link on
// /, /roadmap and /contribute has the Terms, the Refunds page and the age condition in its own card,
// or, on /contribute, in the agreement line directly under the first choice.
for (const path of ['/', '/roadmap', '/contribute']) {
  test(`${path}: every Payment Link carries the agreement`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    const missing = await page.evaluate((link) => {
      const out: string[] = [];
      const hasAgreement = (box: Element | null) =>
        box !== null &&
        box.querySelector('a[href="/terms"]') !== null &&
        box.querySelector('a[href="/refunds"]') !== null &&
        /adult/.test(box.textContent ?? '') &&
        /guardian/.test(box.textContent ?? '');
      const first = document.querySelector('main a.choice-primary');
      const firstAgreement = first?.nextElementSibling ?? null;
      for (const a of document.querySelectorAll(`main a[href^="${link}"]`)) {
        const inCard = hasAgreement(a.closest('li.card'));
        const onContribute = location.pathname === '/contribute' && hasAgreement(firstAgreement) && firstAgreement?.tagName === 'P';
        if (!inCard && !onContribute) out.push(`${a.textContent?.trim()} -> ${a.getAttribute('href')}`);
      }
      return out;
    }, PAYMENT_LINK);
    expect(missing).toEqual([]);
    if (path === '/contribute') await expect(page.locator(`main a[href^="${PAYMENT_LINK}"]`)).not.toHaveCount(0);
    if (path === '/') await expect(page.getByRole('main').getByRole('link', { name: 'Fund this card' })).not.toHaveCount(0);
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
      await expect(running.getByRole('heading', { level: 3 })).toHaveText(RUNNING_ROLES);
      const models = runningModelsCheck(await running.locator('li.agent .card-meta').allTextContents());
      expect(models.ok).toBe(false);
      expect(models.message).toContain('claude-sonnet-5, claude-sonnet-5');
    });
  });

  test.describe('with no role running', () => {
    test.use({
      studio: { ...DEFAULT_STUDIO, roles: DEFAULT_STUDIO.roles.map((role) => (role.status === 'running' ? { ...role, state: 'retired' } : role)) },
    });

    test('fails, since the Running section is missing', async ({ page }) => {
      await page.goto('/team');
      await expect(page.getByRole('region', { name: 'Starts later', exact: true })).toBeVisible();
      const running = page.getByRole('region', { name: 'Running', exact: true });
      await expect(running).toHaveCount(0);
      const models = runningModelsCheck(await running.locator('li.agent .card-meta').allTextContents());
      expect(models).toEqual({ ok: false, message: `/team 0 running roles, each on ${RUNNING_MODEL}: none` });
    });
  });
});
