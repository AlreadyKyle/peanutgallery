import { DISCORD_INVITE, PAYMENT_LINK, PLAY_URL } from './fixture-env';
import { EMPTY_STUDIO } from './prod-studio';
import { expect, overflowsHorizontally, test, WIDTHS } from './fixtures';

// Home in the board's order, the top bar and Menu, /contribute and /ledger (docs/specs/home-and-design.md,
// docs/specs/place.md: home is the studio's floor, the cards to fund, the first game, Ideas, then Next up, Building and Shipped).
for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('home draws the pitch, the status line, the floor stations, the team and the money, in that order', async ({ page }) => {
      await page.goto('/');
      const main = page.getByRole('main');
      const footer = page.getByRole('contentinfo');

      await expect(page.getByRole('banner').getByRole('link', { name: 'Mob Machine' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Watch AI agents build a game studio and free games.');
      await expect(main.getByText('Fund the card you want built next.')).toBeVisible();
      await expect(main.getByRole('link', { name: 'Play free' })).toHaveAttribute('href', PLAY_URL);
      await expect(main.getByRole('link', { name: 'Fund a card', exact: true })).toHaveAttribute('href', '#fund');
      // The status line, from the fixture: two cards open, nothing building, the agents running.
      await expect(main.locator('p.status-line')).toHaveText('2 cards are open for funding.');
      await expect(main.getByRole('button', { name: 'Pause updates' })).toHaveCount(0);

      // The live studio sits on the plate (docs/specs/final-state.md); the floor's stations follow.
      await expect(main.getByRole('heading', { level: 2 })).toHaveText([
        'The studio, live',
        'Pick a card to fund',
        'Play the first game',
        'Ideas',
        'Next up',
        'Building',
        'Shipped',
        'The team',
        'Where the money goes',
      ]);
      // The first game (docs/specs/home-game-tile.md): a still, its name, one line and Play.
      const game = page.getByRole('region', { name: 'Play the first game' });
      await expect(game.locator('.game-name')).toHaveText('Dust');
      await expect(game.getByRole('img', { name: /^The box art for Dust/ })).toBeVisible();
      expect(await game.locator('img.game-shot').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(game.getByRole('link', { name: 'Play Dust free' })).toHaveAttribute('href', PLAY_URL);
      // The cards to fund come first (docs/specs/home-flow.md): horizon now cards only, picked first,
      // as full faces with fund links. Then Building, which holds the funded card, and Shipped; no
      // filter chips.
      const fund = page.getByRole('region', { name: 'Pick a card to fund' });
      await expect(fund.locator('ul.fund-grid > li.card h3')).toHaveText(['Quiet rooms: one more unlock', 'Rename the Gatherer to Sweeper']);
      const station = (id: string) => main.locator(`[data-station-part="${id}"]`);
      const links = await fund.getByRole('link', { name: 'Fund this card' }).evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(links).toHaveLength(2);
      for (const href of links) expect(href).toMatch(new RegExp(`^${PAYMENT_LINK}\\?client_reference_id=[0-9a-f-]{36}$`));
      await expect(page.getByRole('group', { name: 'Show cards for' })).toHaveCount(0);
      await expect(station('building').getByText('A cheaper Cart')).toBeVisible();

      // The team strip: the first three roles on the team (lib/roster.ts teamStatus), each linking to its row on /team.
      const team = page.getByRole('region', { name: 'The team' });
      await expect(team.locator('.member-name')).toHaveText(['Builder A', 'Builder B', 'Game Designer']);
      for (const href of await team.locator('a.member').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(href).toMatch(/^\/team#agent-/);
      await expect(team.getByRole('link', { name: 'Meet the whole team' })).toHaveAttribute('href', '/team');

      await expect(station('shipped').getByRole('heading', { level: 4 })).toHaveText([
        'The unlock list fits any number of unlocks',
        'Save progress and resume on reload',
      ]);
      // Next up: only approved agent cards waiting to open; the fixture's planned cards are backlog
      // entries and board work, which never show (docs/specs/always-open.md). The Game Designer's line
      // says what it is doing instead.
      await expect(station('next').getByRole('heading', { level: 4 })).toHaveCount(0);
      await expect(station('next').locator('.flow-agent')).toBeVisible();

      const money = page.getByRole('region', { name: 'Where the money goes' });
      await expect(money.locator('.pool-line')).toHaveText('$12.34 in the pool');
      await expect(money.locator('.pool-line svg.coin')).toHaveCount(1);
      await expect(money.getByText('Unless you change it on the Fund a card page, 80% goes to the agents and 20% to the studio.', { exact: false })).toBeVisible();
      await expect(money.getByText("The agents' share pays only for the AI model time that builds funded cards", { exact: false })).toBeVisible();
      await expect(money.getByText('These are contributions, not donations.', { exact: false })).toBeVisible();
      await expect(money.locator('ul.rows li')).toHaveCount(3);
      await expect(money.getByRole('link', { name: 'Full ledger' })).toHaveAttribute('href', '/ledger');

      await expect(page.getByText(/\bvot(e|es|ing)\b/i)).toHaveCount(0);
      await expect(page.getByText('kill switch', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(page.getByRole('complementary')).toHaveCount(0);
      // A card's own page is linked only by the Watch links: here, one per shipped card (docs/specs/supporter-pages.md).
      const shippedCount = await station('shipped').locator('li.card').count();
      // The live studio (docs/specs/final-state.md) also links the cards its agents are working on,
      // in its written facts and its pipe; outside it the rule holds.
      await expect(page.locator('a[href^="/card/"]:not(.live-studio a)')).toHaveCount(shippedCount);
      await expect(page.getByRole('link', { name: 'Watch how it was built' })).toHaveCount(shippedCount);
      await expect(footer.getByText('AI agents build free games you can play in a browser.', { exact: false })).toBeVisible();
      await expect(footer.getByText('Everything here is made for all ages.', { exact: false })).toBeVisible();
      await expect(footer.getByRole('link', { name: 'Discord' })).toHaveAttribute('href', DISCORD_INVITE);
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test('the top bar carries the mark, Play, Contribute and the page links', async ({ page }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Site' });
      await expect(nav.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
      const contribute = await nav.getByRole('link', { name: 'Contribute' }).boundingBox();
      expect(contribute?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(nav.getByRole('link', { name: 'Play', exact: true })).toHaveAttribute('href', PLAY_URL);
      const menu = nav.getByRole('button', { name: 'Menu' });
      if (viewport.width < 1024) {
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0);
        await menu.click();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
      } else {
        await expect(menu).toBeHidden();
      }
      for (const [name, href] of [
        ['How it works', '/how-it-works'],
        ['Team', '/team'],
        ['Ideas', '/suggest'],
        ['FAQ', '/faq'],
        ['Ledger', '/ledger'],
      ] as const) {
        await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
      }
      // The you slot (docs/specs/place.md): Sign in beside the wordmark, or on a phone the menu's
      // Your desk.
      if (viewport.width < 480) await expect(nav.getByRole('link', { name: 'Your desk', exact: true })).toHaveAttribute('href', '/me');
      else await expect(nav.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/me');
      // Discord, goals and seeds are in the footer, not the top bar (docs/specs/brand.md).
      await expect(nav.getByRole('link', { name: 'Discord' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Home' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Board' })).toHaveCount(0);
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test('contribute offers the next card in line first, then each open card', async ({ page }) => {
      await page.goto('/contribute');
      await expect(page.getByRole('heading', { level: 1, name: 'Fund a card' })).toBeVisible();
      const first = page.getByRole('main').getByRole('link').first();
      await expect(first).toContainText('Fund the next card in line');
      await expect(first).toContainText('Next in line: Quiet rooms: one more unlock');
      await expect(first).toHaveAttribute('href', `${PAYMENT_LINK}?client_reference_id=split20`);
      await expect(page.getByRole('main').getByText('Rename the Gatherer to Sweeper')).toBeVisible();
      await expect(page.getByRole('main').getByText('Board on its own site')).toHaveCount(0);
      await expect(page.getByRole('main').getByText('All amounts are in US dollars (USD).')).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);
    });

    test('ledger stacks Funding, Money in, Agent work and Deploys, and shows no raw bot output', async ({ page }) => {
      await page.goto('/ledger');
      await expect(page.getByRole('heading', { level: 1, name: 'Ledger' })).toBeVisible();
      // No card has stopped in the default fixture, so the Stopped band is not drawn.
      await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText(['Funding', 'Money in', 'Agent work', 'Deploys']);
      await expect(page.getByRole('region', { name: 'Deploys' }).getByRole('listitem').first()).toContainText('Game 2775bcb passed checks');
      await expect(page.getByText('simulated seconds', { exact: false })).toHaveCount(0);
      // Stacked, one band each: nothing sits beside the long lists.
      const tops = await page.evaluate(() => [...document.querySelectorAll('main > .band')].map((band) => band.getBoundingClientRect().left));
      expect(new Set(tops).size).toBe(1);
      expect(await overflowsHorizontally(page)).toBe(false);
    });
  });
}

test.describe('the Menu on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('opens the page links inline, and Escape closes it and returns focus to the button', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Site' });
    const menu = nav.getByRole('button', { name: 'Menu' });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await nav.getByRole('link', { name: 'Team' }).focus();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0);
    // Moving to another page closes it.
    await menu.click();
    await nav.getByRole('link', { name: 'Team' }).click();
    await expect(page).toHaveURL(/\/team$/);
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  for (const width of [360, 375, 390]) {
    test(`keeps the top bar to one 61px row at ${width}px, Play shown`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      const bar = await page.locator('.topbar').boundingBox();
      expect(bar?.height ?? 0).toBeLessThanOrEqual(61);
      await expect(page.locator('.nav-play')).toBeVisible();
    });
  }

  test('moves Play into the Menu below 360px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await expect(page.locator('.nav-play')).toBeHidden();
    const bar = await page.locator('.topbar').boundingBox();
    expect(bar?.height ?? 0).toBeLessThanOrEqual(61);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Play', exact: true })).toHaveAttribute('href', PLAY_URL);
  });
});

// Home's plate is one picture (the board, 18 October 2026): one headline, the room whole and in view
// when the page opens at common laptop sizes. On the floor (docs/specs/place.md) the room takes the
// wider left side, the pitch hangs from the room's top and the pipe's foot sits on the room's foot, so
// no column leaves a hollow. The agents' written facts are for screen readers and the keyboard only.
for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 810 },
]) {
  test(`shows the whole room beside the pitch above the fold at ${size.width} by ${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    const studio = page.locator('.live-studio');
    await expect(studio.locator('.studio-agent').first()).toBeVisible();
    const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
    const stage = await box('.floor-plate .studio-stage');
    expect(stage.y + stage.height).toBeLessThanOrEqual(size.height);
    // One headline: the lede is the lead size, not a second display line.
    await expect(page.locator('main h1')).toHaveCount(1);
    expect(await page.locator('.hero-home .lede').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(20);
    // The pitch starts level with the room's top, beside it; the pipe sits on the pitch's text edge.
    // The paper screen keeps the room's own height rather than stretching to the right column, so
    // the room fills it (the product pass's design review: an empty screen under the room).
    const h1 = await box('.hero-home h1');
    expect(Math.abs(h1.y - stage.y)).toBeLessThanOrEqual(1);
    expect(h1.x).toBeGreaterThan(stage.x + stage.width);
    const pipe = await box('.home .pipe');
    expect(Math.abs(pipe.x - h1.x)).toBeLessThanOrEqual(1);
    const room = await box('.floor-plate .studio-stage svg.room');
    expect(room.height).toBeGreaterThan(stage.height * 0.75);
    // The room is the wider side.
    expect(stage.width).toBeGreaterThan(pipe.width);
    // The plate draws no how-to line and no pipe intro: both are read out, not shown (the board,
    // 18 October 2026: the plate read as wordy).
    for (const quiet of ['.live-studio-head > p:not(.twitch)', '.home .pipe-intro']) {
      expect((await box(quiet)).height).toBeLessThanOrEqual(1);
    }
    // The newest rows that sit beside the room; the ledger keeps the rest.
    await expect(page.locator('.home .pipe .pipe-row')).toHaveCount(2);
    const facts = studio.getByRole('list', { name: 'What each agent is doing' });
    await expect(facts).toHaveCount(1);
    expect((await facts.boundingBox())!.height).toBeLessThanOrEqual(1);
  });
}

// A feed that answers with nothing yet still shows the cards' own story, never an empty pipe.
test('tells the snapshot in the pipe while the feed is empty', async ({ page }) => {
  await page.route(/\/api\/community\/feed/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [], next: null }) }));
  await page.goto('/');
  const pipe = page.locator('.home .pipe');
  await expect(pipe.locator('.pipe-row')).toHaveCount(2);
  await expect(pipe.locator('.pipe-empty')).toHaveCount(0);
});

test.describe('a studio with no cards', () => {
  test.use({ studio: EMPTY_STUDIO });

  test("draws one quiet slot where the pipe's rows will land", async ({ page }) => {
    await page.route(/\/api\/community\/feed/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [], next: null }) }));
    await page.goto('/');
    await expect(page.locator('.home .pipe .pipe-empty')).toHaveText('Quiet so far. Every coin, new card and shipment lands here as it happens.');
  });
});

test('build sha meta is stamped', async ({ page }) => {
  await page.goto('/');
  const sha = await page.locator('meta[name="build-sha"]').getAttribute('content');
  expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
});

// The whole card funds (the board, 27 Sep 2026; styles.css): a press anywhere on an open card goes to
// checkout, and on hover it lifts straight up with a thicker edge while its Fund button takes its
// hover colour.
test.describe('an open card on a wide screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('lifts on hover and funds from a press anywhere on it', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('.fund-grid li.card').first();
    const fund = card.locator('a.card-fund');
    const href = await fund.getAttribute('href');
    expect(href).toMatch(new RegExp(`^${PAYMENT_LINK}`));
    const before = await fund.evaluate((a) => getComputedStyle(a).backgroundColor);
    await card.hover({ position: { x: 20, y: 20 } });
    await expect(card).toHaveCSS('outline-width', '1px');
    await expect.poll(() => card.evaluate((li) => new DOMMatrix(getComputedStyle(li).transform).m42)).toBe(-4);
    expect(await fund.evaluate((a) => getComputedStyle(a).backgroundColor)).not.toBe(before);
    // The title is under the link's cover, so a press on it follows the Fund link.
    const target = await card.locator('h3').evaluate((h) => {
      const r = h.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + 10, r.y + r.height / 2);
      return el?.closest('a')?.getAttribute('href') ?? null;
    });
    expect(target).toBe(href);
  });
});
