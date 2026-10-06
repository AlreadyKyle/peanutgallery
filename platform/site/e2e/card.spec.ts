import type { Route } from '@playwright/test';
import { expect, mockStudio, test } from './fixtures';
import {
  BUILDER_B,
  BUILDING_CARD_ID,
  CHECKS_CARD_ID,
  COMMIT,
  LIVE_CARD_ID,
  LIVE_TITLE,
  OPEN_CARD_ID,
  OPENS_SOON_ID,
  PAUSED_CARD_ID,
  PLANNED_CARD_ID,
  REJECTED_CARD_ID,
  SUPPORTER_STUDIO,
  VETO_REASON,
  VETOED_ID,
} from './supporter-studio';

// /card/:id (docs/specs/supporter-pages.md): the face and Play, the facts, what changed, the
// supporters and the event lines, the stopped words for a rejected card, and the Watch links that
// lead here from home and /ledger.
test.use({ studio: SUPPORTER_STUDIO });

test.describe('a live card', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/card/${LIVE_CARD_ID}`);
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  });

  test('has its title as the one h1, and the facts with the commit and no link', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText([LIVE_TITLE]);
    const facts = page.getByRole('region', { name: 'The facts' });
    await expect(facts.locator('[data-fact="funded"] dd')).toHaveText('$2.00 of $2.00');
    await expect(facts.locator('[data-fact="contributors"] dd')).toHaveText('30');
    await expect(facts.locator('[data-fact="cost"] dd')).toHaveText('$1.24');
    await expect(facts.locator('[data-fact="time"] dd')).toHaveText('40 minutes');
    await expect(facts.locator('[data-fact="gate"] dd')).toContainText('Passed');
    const commit = facts.locator('[data-fact="commit"]');
    await expect(commit).toHaveText(`Merged as the studio's commit ${COMMIT.slice(0, 7)}`);
    await expect(commit.locator('a')).toHaveCount(0);
  });

  test('says what changed: scalar values as checked, anything else "changed"', async ({ page }) => {
    const changed = page.getByRole('region', { name: 'What changed' });
    await expect(changed.locator('li')).toHaveText([
      'seed-1/config/game.json buildings[id=gatherer].name: "Sweeper"',
      'seed-1/config/game.json buildings[id=gatherer].baseCost: 12',
      'seed-1/config/game.json unlocks[0].labels: changed',
    ]);
  });

  test('lists the supporters in number order, the first 24 then "and 6 more", with no amount', async ({ page }) => {
    const supporters = page.getByRole('region', { name: 'Supporters' });
    const names = await supporters.locator('li').allTextContents();
    expect(names).toHaveLength(24);
    expect(names.slice(0, 6)).toEqual([
      'Supporter 1',
      'Supporter 2',
      'Supporter 3',
      'Supporter 4',
      'Supporter 5',
      'Supporter 6',
    ]);
    expect(names.at(-1)).toBe('Supporter 24');
    await expect(supporters).toContainText('and 6 more');
    expect(await supporters.textContent()).not.toContain('$');
  });

  test('collapses consecutive lines into one with a count, and never shows a message or a tool result', async ({ page }) => {
    const lines = page.getByRole('region', { name: 'What the agents did' }).locator('ol li .row-strong');
    await expect(lines).toHaveText([
      'Builder A started work',
      'Builder A read 12 files',
      'Builder A edited 2 files',
      'Builder A ran a command',
      'Builder A handed in its change',
      'Builder A passed the checks',
      'Builder A shipped it',
    ]);
  });

  test('under reduced motion has no Play button, plays nothing and shows the end state', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Play|Replay/ })).toHaveCount(0);
    const face = page.locator('.replay .card-solo li.card');
    await expect(face).toHaveAttribute('data-face', 'live');
    await expect(face.locator('.tag-stamp')).toHaveCount(1);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

test('Play steps through the recorded milestones within 30 seconds, then reads Replay', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/card/${LIVE_CARD_ID}`);
  const play = page.getByRole('button', { name: 'Play how this card was built' });
  await expect(play).toHaveText('Play');
  const faces: string[] = [];
  await page.exposeFunction('recordFace', (face: string) => faces.push(face));
  await page.evaluate(() => {
    const card = document.querySelector('.replay .card-solo')!;
    new MutationObserver(() => {
      const face = card.querySelector('li.card')?.getAttribute('data-face') ?? '';
      (window as unknown as { recordFace: (face: string) => void }).recordFace(face);
    }).observe(card, { subtree: true, attributes: true, attributeFilter: ['data-face'], childList: true });
  });
  const started = Date.now();
  await play.click();
  await expect(page.getByRole('button', { name: 'Replay how this card was built' })).toHaveText('Replay', { timeout: 30_000 });
  expect(Date.now() - started).toBeLessThan(30_000);
  // Opened, funded, started, the gate and shipped, in order, then the card as it is now.
  expect([...new Set(faces)]).toEqual(['open', 'funded', 'building', 'checks', 'live']);
  await expect(page.locator('.replay [data-announcer]')).toHaveText('It went live.');
  await expect(page.locator('.replay .card-solo li.card')).toHaveAttribute('data-face', 'live');
});

test('Play holds the slot: neither the Play button nor anything under the card moves', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/card/${LIVE_CARD_ID}`);
    const play = page.locator('.replay-actions button');
    await expect(play).toBeVisible();
    // The Play button's top and the facts heading's, with the face shown.
    const sample = () =>
      page.evaluate(() => ({
        face: document.querySelector('.replay .card-solo li.card')!.getAttribute('data-face'),
        play: Math.round(document.querySelector('.replay-actions button')!.getBoundingClientRect().top + window.scrollY),
        below: Math.round(document.querySelector('#card-facts')!.getBoundingClientRect().top + window.scrollY),
      }));
    const before = await sample();
    await play.click();
    const seen = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      await page.waitForTimeout(250);
      const now = await sample();
      seen.add(String(now.face));
      expect({ play: now.play, below: now.below }, `${width}px, ${now.face} face`).toEqual({ play: before.play, below: before.below });
    }
    // Every face the replay draws was measured, not just the first.
    expect(seen.size, [...seen].join(', ')).toBeGreaterThanOrEqual(4);
    await expect(page.getByRole('button', { name: 'Replay how this card was built' })).toBeVisible({ timeout: 10_000 });
  }
});

test('the title renders once, where it stays, while the card loads', async ({ page }) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Registered after the fixture's handler, so it runs first and holds the card's document back.
    const hold = async (route: Route) => {
      await held;
      await route.fallback();
    };
    await page.route(/\/api\/card\//, hold);
    await page.goto(`/card/${LIVE_CARD_ID}`);
    await expect(page.locator('main [aria-busy="true"]')).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });
    const loading = await heading.boundingBox();
    release();
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
    await expect(heading).toHaveText(LIVE_TITLE);
    const ready = await heading.boundingBox();
    expect(Math.round(ready!.y), `${width}px`).toBe(Math.round(loading!.y));
    await page.unroute(/\/api\/card\//, hold);
  }
});

test.describe('a planned card', () => {
  test('draws the roadmap state and no face, never Open for funding', async ({ page }) => {
    for (const [id, label, reason] of [
      [PLANNED_CARD_ID, 'Planned and not built yet', null],
      [OPENS_SOON_ID, 'Approved, opens soon', null],
      [VETOED_ID, 'Held by the board', VETO_REASON],
    ] as const) {
      await page.goto(`/card/${id}`);
      const state = page.locator(`[data-planned="${id}"]`);
      await expect(state.locator('p').first()).toHaveText(label);
      if (reason !== null) await expect(state).toContainText(reason);
      await expect(state.getByRole('link', { name: 'See the roadmap' })).toHaveAttribute('href', '/roadmap');
      await expect(page.locator('main li.card')).toHaveCount(0);
      await expect(page.getByRole('main')).not.toContainText('Open for funding');
      await expect(page.getByRole('link', { name: 'Fund this card' })).toHaveCount(0);
    }
  });
});

test('an open card says each figure once: the face has Funded and Contributors, the facts the rest', async ({ page }) => {
  await page.goto(`/card/${OPEN_CARD_ID}`);
  const face = page.locator('.replay .card-solo li.card');
  await expect(face).toHaveAttribute('data-face', 'open');
  await expect(face.locator('[data-row="funded"]')).toHaveCount(1);
  const facts = page.getByRole('region', { name: 'The facts' });
  await expect(facts.locator('[data-fact="funded"]')).toHaveCount(0);
  await expect(facts.locator('[data-fact="contributors"]')).toHaveCount(0);
  await expect(facts.locator('[data-fact="cost"] dd')).toHaveText('$0.00');
});

test('the supporters line up in columns at every width', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/card/${LIVE_CARD_ID}`);
    const names = page.getByRole('region', { name: 'Supporters' }).locator('li');
    await expect(names).toHaveCount(24);
    const lefts = await names.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().left)));
    // Each name starts at a column's edge: two names either share a left edge or sit at least a
    // column (9.5rem) apart, never at a ragged offset. A phone holds two columns.
    const columns = [...new Set(lefts)].sort((a, b) => a - b);
    expect(columns.length, `${width}px: ${columns.join(', ')}`).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < columns.length; i += 1) expect(columns[i]! - columns[i - 1]!, `${width}px: ${columns.join(', ')}`).toBeGreaterThanOrEqual(152);
    // Filled down, then across, in number order.
    const firstColumn = lefts.filter((left) => left === columns[0]).length;
    expect(firstColumn, `${width}px`).toBeGreaterThanOrEqual(Math.ceil(24 / columns.length));
  }
});

test('a card with no supporters says so', async ({ page }) => {
  await page.goto(`/card/${OPEN_CARD_ID}`);
  await expect(page.getByRole('region', { name: 'Supporters' })).toContainText('No supporters yet.');
});

test('a rejected card shows the same reason words and money trail as its /ledger row', async ({ page }) => {
  await page.goto('/ledger');
  const row = page.locator(`li[data-card="${REJECTED_CARD_ID}"]`);
  const ledger = {
    reason: await row.locator('[data-stopped="reason"]').textContent(),
    money: await row.locator('[data-stopped="money"]').textContent(),
    moved: await row.locator('[data-stopped="moved"]').textContent(),
  };
  expect(ledger.reason).not.toBe('');
  await row.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/card/${REJECTED_CARD_ID}$`));
  const stopped = page.getByRole('region', { name: 'Why it stopped' });
  await expect(stopped.locator('[data-stopped="reason"]')).toHaveText(ledger.reason!);
  await expect(stopped.locator('[data-stopped="money"]')).toHaveText(ledger.money!);
  await expect(stopped.locator('[data-stopped="moved"]')).toHaveText(ledger.moved!);
  await expect(page.locator('.replay .card-solo li.card')).toHaveAttribute('data-face', 'rejected');
});

test('each Stopped row on /ledger links its card', async ({ page }) => {
  await page.goto('/ledger');
  for (const id of [PAUSED_CARD_ID, REJECTED_CARD_ID]) {
    await expect(page.locator(`li[data-card="${id}"] h4 a`)).toHaveAttribute('href', `/card/${id}`);
  }
});

test('an unknown or malformed id shows the not found content', async ({ page }) => {
  for (const id of ['20000000-0000-4000-8000-00000000dead', 'not-a-card', '1%27%20or%201%3D1']) {
    await page.goto(`/card/${id}`);
    await expect(page.getByText('There is no card at this address.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not found');
  }
});

test('a card being built shows a new line at the end after the live poll', async ({ page }) => {
  const studio = { ...SUPPORTER_STUDIO, events: [...SUPPORTER_STUDIO.events] };
  await mockStudio(page, studio);
  await page.clock.install();
  await page.goto(`/card/${BUILDING_CARD_ID}`);
  const lines = page.getByRole('region', { name: 'What the agents did' }).locator('ol li .row-strong');
  await expect(lines).toHaveText(['Builder B started work', 'Builder B read 2 files']);
  studio.events.push({ id: 'sb-04', card_id: BUILDING_CARD_ID, role_id: BUILDER_B, type: 'tool_call', created_at: '2026-09-21T14:30:00.000Z', payload: { name: 'Edit' } });
  await page.clock.runFor(60_000);
  await expect(lines).toHaveText(['Builder B started work', 'Builder B read 2 files', 'Builder B edited a file']);
});

test.describe('the Watch links', () => {
  test('building and checks faces on home link their card, and so does each shipped row', async ({ page }) => {
    await page.goto('/');
    for (const id of [BUILDING_CARD_ID, CHECKS_CARD_ID]) {
      const watch = page.locator(`li.card[data-card="${id}"]`).getByRole('link', { name: "Watch how it's built" });
      await expect(watch).toHaveAttribute('href', `/card/${id}`);
    }
    const shipped = page.getByRole('region', { name: 'Shipped' });
    const links = shipped.getByRole('link', { name: 'Watch how it was built' });
    await expect(links).not.toHaveCount(0);
    await expect(shipped.locator('li')).toHaveCount(await links.count());
    for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(href).toMatch(/^\/card\/[0-9a-f-]{36}$/);
    await links.first().click();
    await expect(page).toHaveURL(/\/card\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Not found');
  });
});
