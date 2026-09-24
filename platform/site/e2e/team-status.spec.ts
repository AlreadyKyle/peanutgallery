import { RUNNING_MODEL, runningModelsCheck } from '../scripts/team-models.mjs';
import { DEFAULT_STUDIO, expect, test } from './fixtures';
import { BUILDER_A, OPENS_SOON_ID, QA, SUPPORTER_STUDIO, VETOED_ID, VETO_REASON } from './supporter-studio';

// /team from the roster's own columns through lib/roster.ts teamStatus, and /roadmap's opens-soon and
// held labels (docs/specs/supporter-pages.md).

const AWAITING_CREDIT =
  "The agents are paused while the studio waits for Stripe to pay out contributions, which buy the agents' model credit. Cards funded now keep their money and wait in the queue.";

test.describe('while the studio is paused', () => {
  test.use({ studio: SUPPORTER_STUDIO });

  test('keeps the running roles in Running as paused, says the reason once, draws them awake (the board, 23 Sep 2026), and still shows model, cost and ships', async ({ page }) => {
    await page.goto('/team');
    const running = page.getByRole('region', { name: 'Running', exact: true });
    await expect(running.locator(':scope > p.muted').first()).toContainText(AWAITING_CREDIT);
    const rows = running.locator('li.agent');
    await expect(rows).not.toHaveCount(0);
    await expect(running.locator('li.agent[data-status="paused"]')).toHaveCount(await rows.count());
    await expect(running.locator('li.agent .tag[data-state="paused"]')).toHaveCount(await rows.count());
    await expect(running.locator('svg.avatar[data-pose="awake"]')).toHaveCount(await rows.count());
    // The studio's reason is said once, above the list, not on every row.
    await expect(running.getByText(AWAITING_CREDIT)).toHaveCount(1);
    await expect(page.locator(`#agent-${BUILDER_A} .card-meta`)).toHaveText(
      'claude-opus-5-5 · Spent from contributions $1.24, $0.31 in the last 7 days · Worked on 7 shipped cards',
    );
    await expect(page.locator(`#agent-${QA} .card-meta`)).toHaveText('claude-opus-5-5 · Spent from contributions $0.00, $0.00 in the last 7 days · Worked on 1 shipped card');
    const models = runningModelsCheck(await running.locator('li.agent .card-meta').allTextContents());
    expect(models.ok, models.message).toBe(true);
    // Home's team strip draws the same roles, awake.
    await page.goto('/');
    await expect(page.locator('.team-strip svg.avatar[data-pose="awake"]')).toHaveCount(3);
  });
});

test.describe('the rows of each section', () => {
  test.use({ studio: SUPPORTER_STUDIO });

  test('end their feet together and line up their Paused tags across each row', async ({ page }) => {
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/team');
      await expect(page.locator('li.agent').first()).toBeVisible();
      // Rows of agents side by side, grouped by where each starts; within a row, each foot line's top.
      const misaligned = await page.evaluate(() => {
        const out: string[] = [];
        for (const grid of document.querySelectorAll('.team-grid')) {
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
    // Every other planned card keeps its plain label.
    const others = page.locator(`main li[data-card]:not([data-card="${OPENS_SOON_ID}"]):not([data-card="${VETOED_ID}"])`);
    await expect(others).not.toHaveCount(0);
    for (const text of await others.allTextContents()) {
      expect(text).toContain('Planned and not built yet');
      expect(text).not.toMatch(/Approved, opens soon|Held by the board/);
    }
  });
});
