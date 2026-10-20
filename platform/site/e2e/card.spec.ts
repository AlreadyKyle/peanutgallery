import type { Route } from '@playwright/test';
import { copy } from '../src/lib/copy';
import { expect, mockStudio, test } from './fixtures';
import { OFFLINE_STUDIO } from './prod-studio';
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

  test('counts a Share press as card_share on /api/count, sending no cookie and nothing else (docs/specs/play-counts.md)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    const counted = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/count');
    await page.getByRole('button', { name: 'Share this card' }).click();
    const request = await counted;
    expect(request.method()).toBe('POST');
    expect(request.postData()).toBe('{"event":"card_share"}');
    expect(new URL(request.url()).origin).toBe(new URL(page.url()).origin);
    expect(new URL(request.url()).search).toBe('');
    expect(await request.headerValue('cookie')).toBeNull();
  });

  test('has its title as the one h1, and the facts with the commit and no link', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText([LIVE_TITLE]);
    const facts = page.getByRole('region', { name: 'The facts' });
    await expect(facts.locator('[data-fact="funded"] dd')).toHaveText('$2.00 of $2.00');
    await expect(facts.locator('[data-fact="contributors"] dd')).toHaveText('30');
    await expect(facts.locator('[data-fact="cost"] dd')).toHaveText('$1.24');
    await expect(facts.locator('[data-fact="cost"] dt')).toHaveText('Cost from contributions');
    // The stamp line over the facts says how long the build took and what it cost, in one line; the
    // fixture's times are on the hour in UTC, and the browser runs in its own zone, so only the shape is fixed.
    await expect(facts.locator('[data-fact="stamp"]')).toHaveText(/^Live 40 minutes after work started, \d\d:00 to \d\d:40, cost \$1\.24$/);
    await expect(facts.locator('[data-fact="time"]')).toHaveCount(0);
    await expect(facts.locator('[data-fact="gate"] dd')).toContainText('Passed');
    const commit = facts.locator('[data-fact="commit"]');
    await expect(commit).toHaveText(`Merged as the studio's commit ${COMMIT.slice(0, 7)}`);
    await expect(commit.locator('a')).toHaveCount(0);
  });

  test('says what changed: known config paths in plain words, and counts anything else', async ({ page }) => {
    const changed = page.getByRole('region', { name: 'What changed' });
    await expect(changed.locator('li')).toHaveText(['Gatherer is now called "Sweeper".', 'Gatherer costs 12 dust to build.']);
    // A raw file path means nothing to a reader, so it is counted, never shown (the copy audit of 18 October 2026).
    await expect(changed.locator('.what-changed-rest')).toHaveText("And 1 more value in the game's settings.");
    await expect(changed.locator('code')).toHaveCount(0);
    await expect(changed).not.toContainText('seed-1/config');
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

// The hidden copies that hold the slot's height (Replay.tsx) carry no link or button: nothing that
// could take focus sits inside a list assistive technology is told to skip.
test('the replay slot holders hold nothing focusable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/card/${LIVE_CARD_ID}`);
  await expect(page.getByRole('button', { name: 'Play how this card was built' })).toBeVisible();
  await expect(page.locator('.card-sizer').first()).toBeAttached();
  await expect(page.locator('[aria-hidden="true"] :is(a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]))')).toHaveCount(0);
  // The shipped face's Play the game is still a link on the card itself.
  await expect(page.locator('.replay .card-solo').getByRole('link', { name: 'Play the game' })).toBeVisible();
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
  test('draws the planned state and no face, never Open for funding', async ({ page }) => {
    for (const [id, label, reason] of [
      [PLANNED_CARD_ID, 'Planned and not built yet', null],
      [OPENS_SOON_ID, 'Approved, opens soon', null],
      [VETOED_ID, 'Held by the studio', VETO_REASON],
    ] as const) {
      await page.goto(`/card/${id}`);
      const state = page.locator(`[data-planned="${id}"]`);
      await expect(state.locator('p').first()).toHaveText(label);
      if (reason !== null) await expect(state).toContainText(reason);
      await expect(state.getByRole('link', { name: 'See the cards to fund' })).toHaveAttribute('href', '/');
      await expect(page.locator('main li.card')).toHaveCount(0);
      await expect(page.getByRole('main')).not.toContainText('Open for funding');
      await expect(page.getByRole('link', { name: 'Fund this card' })).toHaveCount(0);
    }
  });
});

test('an open card says each figure once: the face has Funded and Supporters, the facts the rest', async ({ page }) => {
  await page.goto(`/card/${OPEN_CARD_ID}`);
  const face = page.locator('.replay .card-solo li.card');
  await expect(face).toHaveAttribute('data-face', 'open');
  await expect(face.locator('[data-row="funded"]')).toHaveCount(1);
  const facts = page.getByRole('region', { name: 'The facts' });
  await expect(facts.locator('[data-fact="funded"]')).toHaveCount(0);
  await expect(facts.locator('[data-fact="contributors"]')).toHaveCount(0);
  await expect(facts.locator('[data-fact="cost"] dd')).toHaveText('$0.00');
  // Before the build starts, the cost is what drafting the card cost, and its label says so.
  await expect(facts.locator('[data-fact="cost"] dt')).toHaveText('Drafting cost from contributions');
});

// docs/specs/machine-presets.md: under Fund this card, the line /contribute says under its choices.
test("an open card says under Fund this card that anything beyond its target funds the next cards", async ({ page }) => {
  await page.goto(`/card/${OPEN_CARD_ID}`);
  const column = page.locator('.card-face-column');
  await expect(column.getByRole('link', { name: 'Fund this card' })).toHaveCount(1);
  const line = column.locator('p.card-waterfall');
  await expect(line).toHaveText("Anything beyond a card's target funds the next cards in line.");
  await expect(line.locator('+ p.fund-agreement')).toHaveCount(1);
  await page.goto(`/card/${LIVE_CARD_ID}`);
  await expect(page.locator('p.card-waterfall')).toHaveCount(0);
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
  test('building and checks faces on home link their card, and so does each shipped card', async ({ page }) => {
    await page.goto('/');
    for (const id of [BUILDING_CARD_ID, CHECKS_CARD_ID]) {
      const watch = page.locator(`li.card[data-card="${id}"]`).getByRole('link', { name: "Watch how it's built" });
      await expect(watch).toHaveAttribute('href', `/card/${id}`);
    }
    const shipped = page.locator('[data-station-part="shipped"]');
    const links = shipped.getByRole('link', { name: 'Watch how it was built' });
    await expect(links).not.toHaveCount(0);
    await expect(shipped.locator('li.card')).toHaveCount(await links.count());
    for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(href).toMatch(/^\/card\/[0-9a-f-]{36}$/);
    await links.first().click();
    await expect(page).toHaveURL(/\/card\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Not found');
  });
});

// docs/specs/honest-status.md: while the agents are offline a building card says so in its clock's
// place, with no link to play while the agents work, and a funded card in its waiting line's.
test.describe('while the agents are offline', () => {
  test.use({ studio: { ...SUPPORTER_STUDIO, supply: OFFLINE_STUDIO.supply } });

  test('a building card says the agents are offline instead of its build clock', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-21T14:44:59Z'));
    await page.goto(`/card/${BUILDING_CARD_ID}`);
    const facts = page.getByRole('region', { name: 'The facts' });
    await expect(facts.locator('[data-fact="offline"]')).toHaveText(copy.agentsOffline);
    await expect(facts.locator('[data-fact="offline"]')).toHaveClass('card-state');
    await expect(page.locator('[data-fact="clock"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: copy.cardPage.playWhileBuilding })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(copy.buildingBy.replace('{name} ', ''));
  });

  test('a funded card says the agents are offline in its waiting line', async ({ page }) => {
    await mockStudio(page, OFFLINE_STUDIO);
    const funded = OFFLINE_STUDIO.cards.find((card) => card.stage === 'funded')!;
    await page.goto(`/card/${String(funded.id)}`);
    await expect(page.locator('main li.card .card-waiting')).toHaveText(copy.agentsOffline);
    await expect(page.locator('main')).not.toContainText(copy.waitingForAgents);
  });
});

test.describe('the state line and the story', () => {
  test('a building Dust card says its build clock in whole minutes, with a plain link to play Dust and no Fund button', async ({ page }) => {
    // Work on the building card started at 14:02 UTC (supporter-studio.ts).
    await page.clock.setFixedTime(new Date('2026-09-21T14:44:59Z'));
    await page.goto(`/card/${BUILDING_CARD_ID}`);
    const facts = page.getByRole('region', { name: 'The facts' });
    const clock = facts.locator('[data-fact="clock"]');
    await expect(clock).toHaveText('Building, 42 min in');
    const play = facts.getByRole('link', { name: 'Play Dust while the agents work' });
    await expect(play).toHaveAttribute('href', 'https://play.mobmachine.games/?from=card');
    // Plain text: no pill, no colour of its own, nothing that moves, and no money beside it.
    expect(await clock.evaluate((el) => [getComputedStyle(el).borderStyle, getComputedStyle(el).animationName, getComputedStyle(el).color === getComputedStyle(el.parentElement!).color])).toEqual(['none', 'none', true]);
    await expect(page.getByRole('link', { name: 'Fund this card' })).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('a checks card says Being checked with its minutes, and a live card no clock', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-21T15:05:00Z'));
    await page.goto(`/card/${CHECKS_CARD_ID}`);
    await expect(page.locator('[data-fact="clock"]')).toHaveText('Being checked, 60 min in');
    await page.goto(`/card/${LIVE_CARD_ID}`);
    await expect(page.locator('[data-fact="stamp"]')).toBeVisible();
    await expect(page.locator('[data-fact="clock"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Play Dust while the agents work' })).toHaveCount(0);
  });

  test('the clock moves on the live poll, never on its own', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-21T14:44:00Z') });
    await page.goto(`/card/${BUILDING_CARD_ID}`);
    const clock = page.locator('[data-fact="clock"]');
    await expect(clock).toHaveText('Building, 42 min in');
    await page.clock.runFor(60_000);
    await expect(clock).toHaveText('Building, 43 min in');
  });

  test("each of an agent's steps carries its 24px avatar and links its name to its box on /team", async ({ page }) => {
    await page.goto(`/card/${LIVE_CARD_ID}`);
    const rows = page.getByRole('region', { name: 'What the agents did' }).locator('ol.timeline > li');
    await expect(rows.first().locator('.timeline-avatar svg')).toHaveAttribute('width', '24');
    await expect(rows.first().locator('.timeline-avatar')).toHaveAttribute('aria-hidden', 'true');
    const name = rows.first().getByRole('link', { name: 'Builder A' });
    await expect(name).toHaveAttribute('href', /^\/team#agent-/);
    await name.click();
    await expect(page).toHaveURL(/\/team#agent-/);
  });

  test('the brief the agents get is a closed disclosure', async ({ page }) => {
    await page.goto(`/card/${LIVE_CARD_ID}`);
    const brief = page.getByRole('region', { name: 'What the agents are told' });
    await expect(brief.getByText('Fixture intent for the agents.')).toBeHidden();
    const summary = brief.getByText('Read the brief the agents get');
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await summary.click();
    await expect(brief.getByText('Fixture intent for the agents.')).toBeVisible();
  });

  test("the card's title is the page's biggest type, and on a phone the plate leaves it to the face", async ({ page }) => {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/card/${OPEN_CARD_ID}`);
      await expect(page.locator('.replay .card-solo li.card')).toHaveCount(1);
      const sizes = await page.locator('main :is(h1, .section > h2:not(.sr-only))').evaluateAll((hs) => hs.map((h) => parseFloat(getComputedStyle(h).fontSize)));
      const [title, ...headings] = sizes;
      for (const size of headings) expect(size, `${width}px`).toBeLessThan(title!);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);
      const fund = page.locator('.replay .card-solo').getByRole('link', { name: 'Fund this card' });
      if (width === 390) {
        // Read out, not drawn: the face under the plate carries the title, and its Fund this card is in the first screen.
        expect((await h1.boundingBox())!.height).toBeLessThanOrEqual(1);
        expect((await fund.boundingBox())!.y + 44).toBeLessThanOrEqual(844);
      } else {
        expect((await h1.boundingBox())!.height).toBeGreaterThan(30);
      }
    }
    // A planned card draws no face, so it keeps its title on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/card/${PLANNED_CARD_ID}`);
    await expect(page.locator('[data-planned]')).toBeVisible();
    expect((await page.getByRole('heading', { level: 1 }).boundingBox())!.height).toBeGreaterThan(20);
  });
});

test("an open card's page keeps its headings in order: h1, then a hidden h2 before the face's h3", async ({ page }) => {
  await page.goto(`/card/${OPEN_CARD_ID}`);
  await expect(page.locator('.replay .card-solo li.card')).toHaveCount(1);
  const levels = await page.locator('main :is(h1, h2, h3)').evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
  levels.forEach((level, i) => {
    if (i > 0) expect(level - levels[i - 1]!).toBeLessThanOrEqual(1);
  });
  await expect(page.getByRole('heading', { level: 2, name: 'The card' })).toHaveCount(1);
});
