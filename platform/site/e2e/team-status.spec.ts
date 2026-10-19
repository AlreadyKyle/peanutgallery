import { RUNNING_MODEL, runningModelsCheck, runningRoleRows } from '../scripts/team-models.mjs';
import { DEFAULT_STUDIO, expect, test } from './fixtures';
import { BUILDER_A, OPENS_SOON_ID, QA, SUPPORTER_STUDIO, VETOED_ID, VETO_REASON } from './supporter-studio';

// /team from the roster's own columns through lib/roster.ts teamStatus, and home's Ideas station with an
// opens-soon and a held card (docs/specs/supporter-pages.md, docs/specs/always-open.md).

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
    await expect(running.locator('svg.avatar')).toHaveCount(await rows.count());
    await expect(running.locator('svg.avatar .avatar-lid')).toHaveCount(0);
    // The code-only Janitor says it calls no model.
    const code = running.locator('li.agent[data-kind="code"]');
    await expect(code).toHaveCount(1);
    await expect(code).toHaveAttribute('data-status', 'running');
    await expect(code.locator('.tag')).toHaveCount(0);
    await expect(code.locator('.card-meta')).toHaveText('Calls no model. Runs every day on its own.');
    await expect(page.locator('main')).not.toContainText('waits for Stripe');
    await expect(page.locator(`#agent-${BUILDER_A} .card-meta`)).toHaveText(
      'claude-opus-5-5 · Spent from contributions $1.24, $0.31 in the last 7 days · Worked on 7 shipped cards',
    );
    // A zero figure is left out, so a row of zeros never reads as an idle studio.
    await expect(page.locator(`#agent-${QA} .card-meta`)).toHaveText('claude-opus-5-5 · Worked on 1 shipped card');
    const models = runningModelsCheck(await runningRoleRows(running));
    expect(models.ok, models.message).toBe(true);
    // Home's team strip draws the same roles, awake.
    await page.goto('/');
    await expect(page.locator('.team-strip svg.avatar')).toHaveCount(3);
    await expect(page.locator('.team-strip svg.avatar .avatar-lid')).toHaveCount(0);
  });
});

test.describe("the running team's boxes", () => {
  test.use({ studio: SUPPORTER_STUDIO });

  test('end their feet together and line up their Paused tags across each row', async ({ page }) => {
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/team');
      await expect(page.locator('li.agent').first()).toBeVisible();
      // Rows of agents side by side, grouped by where each starts; within a row, each foot line's top.
      const misaligned = await page.evaluate(() => {
        const grids = document.querySelectorAll('.team-grid');
        // Only Running is a team grid of boxes; the roles still to come are a compact list (S25).
        const out: string[] = grids.length === 1 ? [] : [`${grids.length} team grids`];
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

// The board, 26 Sep 2026 (PLAN §10 decision 49): every running member of the team in the same box,
// one to a grid cell, one width at every breakpoint and, from 768px, one height. The roles still to
// come are a compact list under them (the full pass, S25): an entry per role between hairlines, one
// column on a phone and two equal columns from 768px, each entry shorter than any box. The
// default fixture draws all three sections.
test.describe('every member of the team', () => {
  test.use({ studio: DEFAULT_STUDIO });

  test('runs in one box size, and the roles still to come sit in a compact list of one or two columns', async ({ page }) => {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/team');
      await expect(page.locator('li.agent').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const sections = await page.evaluate(() =>
        [...document.querySelectorAll('main section')]
          .filter((section) => section.querySelector('li.agent, li.later-role') !== null)
          .map((section) => ({
            heading: section.querySelector('h2')?.textContent ?? '',
            lists: [...section.querySelectorAll('ul')].map((ul) => ul.className),
            items: [...section.querySelectorAll('ul > li')].map((li) => {
              const r = li.getBoundingClientRect();
              return { className: li.className, left: Math.round(r.left), top: Math.round(r.top), width: r.width, height: r.height };
            }),
          })),
      );
      expect(sections.map((section) => [section.heading, section.lists]), `${width}px`).toEqual([
        ['Running', ['team-grid']],
        ['Starts later', ['team-later']],
        ['Planned', ['team-later']],
      ]);
      const [running, ...later] = sections;
      expect(new Set(running!.items.map((item) => item.className)), `${width}px`).toEqual(new Set(['agent']));
      const widths = running!.items.map((b) => b.width);
      expect(Math.max(...widths) - Math.min(...widths), `${width}px box widths ${widths.join(', ')}`).toBeLessThanOrEqual(1);
      if (width >= 768) {
        const heights = running!.items.map((b) => b.height);
        expect(Math.max(...heights) - Math.min(...heights), `Running at ${width}px heights ${heights.join(', ')}`).toBeLessThanOrEqual(1);
      }
      const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const runningMean = mean(running!.items.map((b) => b.height));
      for (const section of later) {
        expect(new Set(section.items.map((item) => item.className)), `${section.heading} at ${width}px`).toEqual(new Set(['later-role']));
        // One column on a phone, two equal columns from 768px, each entry starting a row or beside one.
        const columns = [...new Set(section.items.map((item) => item.left))];
        expect(columns.length, `${section.heading} at ${width}px columns ${columns.join(', ')}`).toBe(width < 768 ? 1 : Math.min(2, section.items.length));
        const entryWidths = section.items.map((item) => item.width);
        expect(Math.max(...entryWidths) - Math.min(...entryWidths), `${section.heading} at ${width}px entry widths`).toBeLessThanOrEqual(1);
        // The pair in a row shares its top and its height, so their hairlines line up.
        const rows = new Map<number, number[]>();
        for (const item of section.items) rows.set(item.top, [...(rows.get(item.top) ?? []), item.height]);
        for (const [top, heights] of rows) expect(Math.max(...heights) - Math.min(...heights), `${section.heading} row at ${top} at ${width}px`).toBeLessThanOrEqual(1);
        // Compact: an entry is shorter than a running box on average. On a phone a long description can
        // wrap past the shortest box, since the entry's text runs beside its avatar.
        expect(mean(section.items.map((item) => item.height)), `${section.heading} entries at ${width}px`).toBeLessThan(runningMean);
      }
    }
  });
});

test.describe('with one role paused by the board', () => {
  const reason = 'Paused while its checks are rewritten.';
  test.use({
    studio: { ...DEFAULT_STUDIO, roles: DEFAULT_STUDIO.roles.map((role) => (role.id === QA ? { ...role, paused: true, paused_reason: reason } : role)) },
  });

  test('shows that role paused with its own reason, and the rest running, every one awake', async ({ page }) => {
    await page.goto('/team');
    const running = page.getByRole('region', { name: 'Running', exact: true });
    const qa = running.locator(`#agent-${QA}`);
    await expect(qa).toHaveAttribute('data-status', 'paused');
    await expect(qa).toContainText('Paused');
    await expect(qa).toContainText(reason);
    await expect(qa.locator('svg.avatar .avatar-eye').first()).toBeAttached();
    await expect(qa.locator('svg.avatar')).toHaveAttribute('data-idle', 'true');
    await expect(qa.locator('.card-meta')).toContainText(RUNNING_MODEL);
    await expect(running.locator('li.agent[data-status="running"]')).toHaveCount((await running.locator('li.agent').count()) - 1);
    await expect(running.locator('svg.avatar .avatar-lid')).toHaveCount(0);
    await expect(running.getByText(reason)).toHaveCount(1);
  });
});

test.describe("home's Ideas station, where drafted cards wait", () => {
  test.use({ studio: SUPPORTER_STUDIO });

  test('shows an approved card waiting to be dealt as "Approved, opens soon" and leaves a vetoed one out', async ({ page }) => {
    await page.goto('/');
    const next = page.locator('[data-station-part="next"]');
    const opening = next.locator(`li[data-card="${OPENS_SOON_ID}"]`);
    await expect(opening).toContainText('Approved, opens soon');
    await expect(next.locator(`li[data-card="${VETOED_ID}"]`)).toHaveCount(0);
    await expect(page.getByText(VETO_REASON)).toHaveCount(0);
  });
});
