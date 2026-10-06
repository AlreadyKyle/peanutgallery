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
const RUNNING_ROLES = ['Builder A', 'Builder B', 'Game Designer', 'Game Director', 'Janitor', 'Platform Director', 'QA', 'Studio Head'];
// The running roles that run on a model: all but the code-only Janitor.
const MODEL_ROLES = RUNNING_ROLES.filter((title) => title !== 'Janitor');

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
        'Watch how it works',
        /Pick a card$/,
        /Contribute and choose the split$/,
        /The bar fills$/,
        /The agents build it$/,
        /Checks, then live$/,
        /It shows under Shipped$/,
        'Where the money goes',
        'Holds and refunds',
        'Rules that never change',
        'Who runs it',
        'What code does and what the agents do',
      ]);
      // The board by name, and the worked example from $5.00 paid (docs/specs/copy-pass.md).
      await expect(page.getByRole('region', { name: 'Who runs it', exact: true })).toContainText('Mob Machine is run by AI agents and a board: the people who run the studio and approve what gets built, today Kyle Smith.');
      const worked = main.locator('figure.example').nth(1);
      await expect(worked.locator('figcaption')).toContainText('$5.00 paid, with the default split.');
      await expect(worked.locator('.stat dd')).toHaveText(['$5.00', '$0.46', '$0.45', '$0.82', '$0.16', '$3.11']);
      await expect(worked.locator('ol.example-order li')).toHaveCount(3);
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
        'Platform Builder',
        'Tech Artist',
      ]);
      await expect(starts.locator('#agent-r-platform-builder')).toContainText('Starts when the board opens the studio code lane.');
      await expect(starts.locator('#agent-r-community')).toContainText('Starts once a named moderator is in place for the community channels.');
      await expect(planned.getByRole('heading', { level: 3 })).toHaveText(['Host']);
      // The board block sits at the foot, after every section (docs/specs/copy-pass.md).
      await expect(page.getByRole('main').locator('section h2')).toHaveText(['Running', 'Starts later', 'Planned', 'Who runs it']);
      await expect(page.locator('main > .band').last().getByRole('region', { name: 'Who runs it', exact: true })).toContainText('Kyle Smith');
      const avatars = page.getByRole('main').getByRole('img');
      await expect(avatars).toHaveCount(DEFAULT_STUDIO.roles.length);
      for (const role of DEFAULT_STUDIO.roles) {
        await expect(page.getByRole('img', { name: String(role.species_note) })).toBeVisible();
      }
      // A running role shows its model, its cost from contributions and its ships; a role that does not run shows none,
      // and nor does the code-only Janitor, which says it calls no model.
      await expect(running.getByText('claude-opus-5-5', { exact: false })).toHaveCount(MODEL_ROLES.length);
      await expect(running.locator('#agent-r-janitor')).toHaveAttribute('data-kind', 'code');
      await expect(running.locator('#agent-r-janitor .agent-kind')).toHaveText('Code only');
      await expect(running.locator('#agent-r-janitor .card-meta')).toHaveText('Calls no model. Runs every day, also while the studio is paused.');
      await expect(running.locator('#agent-r-builder-a .card-meta')).toHaveText(
        'claude-opus-5-5 · Spent from contributions $0.00, $0.00 in the last 7 days · Worked on 0 shipped cards',
      );
      for (const region of [starts, planned]) {
        await expect(region.getByText(/\bclaude-/)).toHaveCount(0);
        await expect(region.getByText('Spent from contributions')).toHaveCount(0);
        await expect(region.locator('.card-meta')).toHaveCount(0);
      }
      // The check scripts/live-check.mjs runs on production, on the same locators.
      const models = runningModelsCheck(await running.locator('li.agent:not([data-kind="code"]) .card-meta').allTextContents());
      expect(models).toEqual({ ok: true, message: `/team ${MODEL_ROLES.length} running roles, each on ${RUNNING_MODEL}: ${Array(MODEL_ROLES.length).fill(RUNNING_MODEL).join(', ')}` });
      // Nothing is paused: every avatar is awake and no row says Paused.
      await expect(page.locator('svg.avatar[data-pose="asleep"]')).toHaveCount(DEFAULT_STUDIO.roles.length - RUNNING_ROLES.length);
      await expect(running.locator('li.agent[data-status="paused"]')).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
      await screenshot(page, 'team', viewport.width);
    });

    test('/roadmap lists next and later cards in groups by folder and board work, with no bars or fund links', async ({ page }) => {
      await page.goto('/roadmap');
      await onlyOneH1(page, 'Roadmap');
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 2 })).toHaveText(['Next', 'Later']);
      const board = 'Board work on how the studio runs (not funded by cards)';
      const next = page.getByRole('region', { name: 'Next', exact: true });
      await expect(next.getByRole('heading', { level: 3 })).toHaveText(['The studio', board]);
      await expect(next.getByRole('region', { name: 'Next The studio', exact: true }).getByRole('heading', { level: 4 })).toHaveText([
        'Choose the next card without paying',
        'Board on its own site',
      ]);
      // Board work starts closed; opening it shows its cards (docs/specs/copy-pass.md).
      const disclosure = next.locator('details[data-group="board"]');
      await expect(disclosure).not.toHaveAttribute('open', /.*/);
      await expect(disclosure.getByRole('heading', { level: 4 })).toBeHidden();
      await disclosure.locator('summary').click();
      await expect(disclosure.getByRole('heading', { level: 4 })).toHaveText(['The Studio Head drafts cards from the roadmap']);
      const later = page.getByRole('region', { name: 'Later', exact: true });
      await expect(later.getByRole('heading', { level: 3 })).toHaveText(['For players', board]);
      await expect(later.getByRole('region', { name: 'Later For players', exact: true }).getByRole('heading', { level: 4 })).toHaveText(['A second area in Dust']);
      await expect(main.getByText('Planned and not built yet')).toHaveCount(0);
      await expect(main.getByText(/not funded by cards/)).toHaveCount(2);
      await expect(main.getByRole('progressbar')).toHaveCount(0);
      await expect(main.getByRole('link')).toHaveCount(0);
      await expect(main.getByText('Rename the Gatherer to Sweeper')).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
      await screenshot(page, 'roadmap', viewport.width);
    });
  });
}

// /roadmap as production has it at launch: every BACKLOG entry is marked board: yes, so board work is
// each band's only group. It is drawn open under a line that says so, never as a lone closed summary
// in an otherwise empty band (docs/specs/copy-pass.md, Decisions).
const BOARD_ONLY_STUDIO = {
  ...DEFAULT_STUDIO,
  cards: DEFAULT_STUDIO.cards.map((card) => (card.horizon === 'next' || card.horizon === 'later' ? { ...card, board_work: true } : card)),
};
test.describe('/roadmap with only board work planned', () => {
  test.use({ studio: BOARD_ONLY_STUDIO });
  for (const width of [320, 375, 768, 1440]) {
    test(`draws each band's board work open under a line that says so at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/roadmap');
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 2 })).toHaveText(['Next', 'Later']);
      await expect(main.locator('details')).toHaveCount(0);
      const board = 'Board work on how the studio runs (not funded by cards)';
      for (const [name, titles] of [
        ['Next', ['Choose the next card without paying', 'The Studio Head drafts cards from the roadmap', 'Board on its own site']],
        ['Later', ['A second area in Dust', 'Image adapter for studio pictures']],
      ] as const) {
        const horizon = page.getByRole('region', { name, exact: true });
        await expect(horizon.getByText('No card for players or the studio is here yet. The cards below are board work.')).toBeVisible();
        await expect(horizon.getByRole('heading', { level: 3 })).toHaveText([board]);
        const titlesShown = horizon.getByRole('region', { name: `${name} ${board}`, exact: true }).getByRole('heading', { level: 4 });
        await expect(titlesShown).toHaveText([...titles]);
        for (const title of await titlesShown.all()) await expect(title).toBeVisible();
      }
      await expect(main.getByText(/not funded by cards/)).toHaveCount(2);
      await expect(main.getByRole('link')).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
      await screenshot(page, 'roadmap-board-only', width);
    });
  }
});

// Every path to checkout states the agreement first (docs/specs/legal-copy.md): each Payment Link on
// /, /roadmap and /contribute has the Terms, the Refunds page and the age condition in the one
// agreement line directly under its card grid (the board, 27 Sep 2026: not on every card), or, on
// /contribute, in the agreement line directly under the first choice.
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
        const grid = a.closest('ul.card-grid');
        const underGrid = grid !== null && [grid.nextElementSibling, grid.nextElementSibling?.nextElementSibling].some((el) => el?.classList.contains('fund-agreement') === true && hasAgreement(el));
        const inCard = underGrid;
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
      const models = runningModelsCheck(await running.locator('li.agent:not([data-kind="code"]) .card-meta').allTextContents());
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
      const models = runningModelsCheck(await running.locator('li.agent:not([data-kind="code"]) .card-meta').allTextContents());
      expect(models).toEqual({ ok: false, message: `/team 0 running roles, each on ${RUNNING_MODEL}: none` });
    });
  });
});
