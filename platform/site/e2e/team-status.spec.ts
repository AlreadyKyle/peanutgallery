import { RUNNING_MODEL, runningModelsCheck } from '../scripts/team-models.mjs';
import { DEFAULT_STUDIO, expect, test } from './fixtures';
import { BUILDER_A, OPENS_SOON_ID, QA, SUPPORTER_STUDIO, VETOED_ID, VETO_REASON } from './supporter-studio';

// /team from the roster's own columns through lib/roster.ts teamStatus, and /roadmap's opens-soon and
// held labels (docs/specs/supporter-pages.md).

test.describe('while the studio is paused', () => {
  test.use({ studio: SUPPORTER_STUDIO });

  test('shows the running roles as running, with no paused line (decision 62), awake, with model, cost and ships', async ({ page }) => {
    await page.goto('/team');
    const running = page.getByRole('region', { name: 'Running', exact: true });
    await expect(running.locator(':scope > p.muted').first()).not.toContainText(/paused|Paused/);
    const rows = running.locator('li.agent');
    await expect(rows).not.toHaveCount(0);
    await expect(running.locator('li.agent[data-status="paused"]')).toHaveCount(0);
    await expect(running.locator('li.agent .tag[data-state="paused"]')).toHaveCount(0);
    await expect(running.locator('svg.avatar[data-pose="awake"]')).toHaveCount(await rows.count());
    // The code-only Janitor says it calls no model.
    const code = running.locator('li.agent[data-kind="code"]');
    await expect(code).toHaveCount(1);
    await expect(code).toHaveAttribute('data-status', 'running');
    await expect(code.locator('.tag')).toHaveCount(0);
    await expect(code.locator('.card-meta')).toHaveText('Calls no model. Runs every day, also while the studio is paused.');
    await expect(page.locator('main')).not.toContainText('waits for Stripe');
    await expect(page.locator(`#agent-${BUILDER_A} .card-meta`)).toHaveText(
      'claude-opus-5-5 · Spent from contributions $1.24, $0.31 in the last 7 days · Worked on 7 shipped cards',
    );
    await expect(page.locator(`#agent-${QA} .card-meta`)).toHaveText('claude-opus-5-5 · Spent from contributions $0.00, $0.00 in the last 7 days · Worked on 1 shipped card');
    const models = runningModelsCheck(await running.locator('li.agent:not([data-kind="code"]) .card-meta').allTextContents());
    expect(models.ok, models.message).toBe(true);
    // Home's team strip draws the same roles, awake.
    await page.goto('/');
    await expect(page.locator('.team-strip svg.avatar[data-pose="awake"]')).toHaveCount(3);
  });
});

test.describe('the boxes of each section', () => {
  test.use({ studio: SUPPORTER_STUDIO });

  test('end their feet together and line up their Paused tags across each row, in all three sections', async ({ page }) => {
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/team');
      await expect(page.locator('li.agent').first()).toBeVisible();
      // Rows of agents side by side, grouped by where each starts; within a row, each foot line's top.
      const misaligned = await page.evaluate(() => {
        const grids = document.querySelectorAll('.team-grid');
        // Running, Starts later and Planned: every section is a team grid of boxes.
        const out: string[] = grids.length === 3 ? [] : [`${grids.length} team grids`];
        for (const grid of grids) {
          const rows = new Map<number, Element[]>();
          for (const agent of grid.querySelectorAll(':scope > li.agent')) {
            const top = Math.round(agent.getBoundingClientRect().top);
            rows.set(top, [...(rows.get(top) ?? []), agent]);
          }
          for (const agents of rows.values()) {
            if (agents.length < 2) continue;
            // Each agent's last line ends at the row's foot, and the Paused tags start on one line.
            for (const [part, edge] of [
              [':scope > :last-child', 'bottom'],
              ['.tag[data-state="paused"]', 'top'],
            ] as const) {
              const at = agents.map((agent) => agent.querySelector(part)).filter((el) => el !== null).map((el) => Math.round(el!.getBoundingClientRect()[edge]));
              if (at.length > 1 && Math.max(...at) - Math.min(...at) > 1) out.push(`${part} ${edge}: ${at.join(', ')}`);
            }
          }
        }
        return out;
      });
      expect(misaligned, `${width}px`).toEqual([]);
    }
  });
});

// The board, 26 Sep 2026 (PLAN §10 decision 49): every member of the team in the same box, one to a
// grid cell. One width for every box on the page at every breakpoint; from 768px every box in a
// section as tall as the tallest in it. The default fixture draws all three sections.
test.describe('every member of the team', () => {
  test.use({ studio: DEFAULT_STUDIO });

  test('sits in one box size: one width on the page, one height in each section from 768px', async ({ page }) => {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/team');
      await expect(page.locator('li.agent').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const sections = await page.evaluate(() =>
        [...document.querySelectorAll('main section')]
          .filter((section) => section.querySelector('li.agent') !== null)
          .map((section) => ({
            heading: section.querySelector('h2')?.textContent ?? '',
            lists: [...section.querySelectorAll('ul')].map((ul) => ul.className),
            boxes: [...section.querySelectorAll('li.agent')].map((li) => {
              const r = li.getBoundingClientRect();
              return { width: r.width, height: r.height, parent: li.parentElement?.className ?? '' };
            }),
          })),
      );
      expect(sections.map((section) => section.heading), `${width}px`).toEqual(['Running', 'Starts later', 'Planned']);
      const widths = sections.flatMap((section) => section.boxes.map((b) => b.width));
      expect(Math.max(...widths) - Math.min(...widths), `${width}px box widths ${widths.join(', ')}`).toBeLessThanOrEqual(1);
      for (const section of sections) {
        expect(section.lists, `${section.heading} at ${width}px`).toEqual(['team-grid']);
        expect(new Set(section.boxes.map((b) => b.parent)), `${section.heading} at ${width}px`).toEqual(new Set(['team-grid']));
        if (width < 768) continue;
        const heights = section.boxes.map((b) => b.height);
        expect(Math.max(...heights) - Math.min(...heights), `${section.heading} at ${width}px heights ${heights.join(', ')}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

test.describe('with one role paused by the board', () => {
  const reason = 'Paused while its checks are rewritten.';
  test.use({
    studio: { ...DEFAULT_STUDIO, roles: DEFAULT_STUDIO.roles.map((role) => (role.id === QA ? { ...role, paused: true, paused_reason: reason } : role)) },
  });

  test('shows that role paused with its own reason, and the rest running and awake', async ({ page }) => {
    await page.goto('/team');
    const running = page.getByRole('region', { name: 'Running', exact: true });
    const qa = running.locator(`#agent-${QA}`);
    await expect(qa).toHaveAttribute('data-status', 'paused');
    await expect(qa).toContainText('Paused');
    await expect(qa).toContainText(reason);
    await expect(qa.locator('svg.avatar')).toHaveAttribute('data-pose', 'asleep');
    await expect(qa.locator('.card-meta')).toContainText(RUNNING_MODEL);
    await expect(running.locator('li.agent[data-status="running"]')).toHaveCount((await running.locator('li.agent').count()) - 1);
    await expect(running.locator(`#agent-${BUILDER_A} svg.avatar`)).not.toHaveAttribute('data-pose', 'asleep');
    await expect(running.getByText(reason)).toHaveCount(1);
  });
});

test.describe('/roadmap', () => {
  test.use({ studio: SUPPORTER_STUDIO });

  test('labels an approved card waiting to be dealt "Approved, opens soon" and a vetoed one "Held by the board" with its reason', async ({ page }) => {
    await page.goto('/roadmap');
    const opening = page.locator(`li[data-card="${OPENS_SOON_ID}"]`);
    await expect(opening).toContainText('Approved, opens soon');
    await expect(opening).not.toContainText('Held by the board');
    const held = page.locator(`li[data-card="${VETOED_ID}"]`);
    await expect(held).toContainText('Held by the board');
    await expect(held).toContainText(VETO_REASON);
    await expect(held).not.toContainText('Approved, opens soon');
    // Every other planned card carries no state label: its group's line says planned once
    // (docs/specs/copy-pass.md).
    const others = page.locator(`main li[data-card]:not([data-card="${OPENS_SOON_ID}"]):not([data-card="${VETOED_ID}"])`);
    await expect(others).not.toHaveCount(0);
    for (const text of await others.allTextContents()) {
      expect(text).not.toMatch(/Planned and not built yet|Approved, opens soon|Held by the board/);
    }
    for (const group of await page.locator('main .roadmap-group').all()) {
      expect(((await group.textContent()) ?? '').match(/planned/gi) ?? []).toHaveLength(1);
    }
  });
});
