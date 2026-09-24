import type { Page } from '@playwright/test';
import { DISCORD_INVITE } from './fixture-env';
import { expect, mockStudio, test } from './fixtures';
import { BUILDING_CARD_ID, LIVE_CARD_ID, OPEN_CARD_ID, SESSIONS, SUPPORTER_STUDIO } from './supporter-studio';

// /thanks, where Stripe's redirect lands (docs/specs/supporter-pages.md): the session leaves the
// address at once, a pending answer asks again every 5 seconds and gives up at 3 minutes, and each
// recorded state says what the payment did with no amount, email or name.
test.use({ studio: SUPPORTER_STUDIO });

/** Every POST /api/thanks the page makes, with the session it sent. */
function thanksRequests(page: Page): string[] {
  const sent: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/thanks') sent.push(String((request.postDataJSON() as { session?: unknown }).session));
  });
  return sent;
}

async function open(page: Page, session: string): Promise<void> {
  await page.goto(`/thanks?session=${session}`);
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
}

test('takes the session out of the address as soon as it is read, and asks about it', async ({ page }) => {
  const sent = thanksRequests(page);
  await page.goto(`/thanks?session=${SESSIONS.recorded}`);
  await expect(page).toHaveURL(/\/thanks$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you');
  expect(sent).toContain(SESSIONS.recorded);
  // A reload asks about the stored session, with nothing in the address.
  await page.reload();
  await expect(page.getByText('You are Supporter 12.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/thanks$/);
});

test('keeps the title where it first renders when the payment goes from recording to recorded', async ({ page }) => {
  const studio = { ...SUPPORTER_STUDIO, thanks: { ...SUPPORTER_STUDIO.thanks } };
  await mockStudio(page, studio);
  await page.clock.install();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const session = `cs_test_recordsLater${width}0000`;
    await page.goto(`/thanks?session=${session}`);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('Recording your payment…');
    const pending = await heading.boundingBox();
    studio.thanks[session] = SUPPORTER_STUDIO.thanks![SESSIONS.recorded]!;
    await page.clock.runFor(5_000);
    await expect(heading).toHaveText('Thank you');
    const recorded = await heading.boundingBox();
    expect(Math.round(recorded!.y), `${width}px`).toBe(Math.round(pending!.y));
  }
});

test('drops a malformed session from the address and asks nothing', async ({ page }) => {
  const sent = thanksRequests(page);
  await page.goto('/thanks?session=not-a-session');
  await expect(page).toHaveURL(/\/thanks$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you');
  await expect(page.getByText('Thank you for supporting the studio.', { exact: true })).toBeVisible();
  expect(sent).toEqual([]);
});

test('while not recorded asks every 5 seconds, then says Stripe has the payment at 3 minutes', async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install();
  const sent = thanksRequests(page);
  await page.goto(`/thanks?session=${SESSIONS.pending}`);
  await expect(page).toHaveURL(/\/thanks$/);
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Recording your payment…');
  await expect(page.locator('main [aria-busy="true"]')).toBeVisible();
  await expect.poll(() => sent.length).toBe(1);
  // One more request every 5 seconds, each after the last answer, up to 170 seconds.
  for (let seconds = 5; seconds <= 170; seconds += 5) {
    await page.clock.runFor(5_000);
    await expect.poll(() => sent.length).toBe(1 + seconds / 5);
  }
  await expect(heading).toHaveText('Recording your payment…');
  // By 180 seconds it stops asking and says Stripe has the payment.
  await page.clock.runFor(5_000);
  await page.clock.runFor(5_000);
  await expect(page.getByText("Stripe has taken your payment and emailed your receipt. It can take a few minutes to reach the studio's books.")).toBeVisible();
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  const asked = sent.length;
  expect(asked).toBeGreaterThanOrEqual(36);
  expect(asked).toBeLessThanOrEqual(37);
  await page.clock.runFor(30_000);
  expect(sent.length).toBe(asked);
});

test('a recorded payment names the supporter, the cards it reached (named first) and the terms it is under', async ({ page }) => {
  await open(page, SESSIONS.recorded);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you');
  await expect(page.getByText('You are Supporter 12.', { exact: true })).toBeVisible();
  const reached = page.getByRole('region', { name: 'Where your money went' });
  await expect(reached.locator('li h3 a')).toHaveText(['A cheaper Cart', String(SUPPORTER_STUDIO.cards.find((c) => c.id === OPEN_CARD_ID)!.title), 'The Gatherer is now the Sweeper']);
  expect(await reached.locator('li h3 a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([
    `/card/${BUILDING_CARD_ID}`,
    `/card/${OPEN_CARD_ID}`,
    `/card/${LIVE_CARD_ID}`,
  ]);
  await expect(reached.locator('li').nth(0)).toContainText('Being built now.');
  await expect(reached.locator('li').nth(1)).toContainText('Open for funding');
  await expect(reached.locator('li').nth(1).getByRole('progressbar')).toHaveCount(1);
  await expect(reached.locator('li').nth(2)).toContainText('Live.');
  // The terms line links the stamped version's Terms and Refunds.
  const terms = page.locator('[data-note="terms"]');
  await expect(terms).toContainText('Your contribution is under version 2 of the Terms');
  expect(await terms.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(['/terms/2', '/refunds/2']);
  // Follow along: the named card and the Discord invite with its age line.
  const follow = page.getByRole('region', { name: 'Follow along' });
  await expect(follow.getByRole('link', { name: 'Watch this card' })).toHaveAttribute('href', `/card/${BUILDING_CARD_ID}`);
  await expect(follow.getByRole('link', { name: 'Get told when it ships' })).toHaveAttribute('href', DISCORD_INVITE);
  await expect(follow).toContainText('Discord is for ages 13 and over.');
  // The studio is paused in this fixture: the paused notice shows under the heading.
  await expect(page.locator('main > .band').first()).toContainText('paused');
  // No amount anywhere in the supporter area.
  expect(await page.locator('main').textContent()).not.toContain('$');
});

test('a founding supporter reads Founding supporter', async ({ page }) => {
  await open(page, SESSIONS.founding);
  await expect(page.getByText('You are Founding supporter 3.', { exact: true })).toBeVisible();
  expect(await page.locator('main').textContent()).not.toContain('$');
});

test('a held payment says until when, a partly unplaced one says it waits', async ({ page }) => {
  await open(page, SESSIONS.held);
  await expect(page.locator('[data-note="held"]')).toHaveText('Your contribution is held before it counts, until 26 Sep 2026.');
  await expect(page.locator('[data-note="waiting"]')).toHaveCount(0);
  await open(page, SESSIONS.waiting);
  await expect(page.locator('[data-note="waiting"]')).toHaveText(
    'Part of your contribution waits as Not on a card yet and goes to the next card that opens.',
  );
  await expect(page.locator('[data-note="held"]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Where your money went' }).locator('li')).toHaveCount(1);
});

test('a refunded or disputed payment reaches no card', async ({ page }) => {
  await open(page, SESSIONS.reversed);
  await expect(page.getByText('This payment was refunded or disputed, so nothing from it is on a card.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Where your money went' }).locator('li')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Watch this card' })).toHaveCount(0);
});

test('with no stamped terms version there is no terms line', async ({ page }) => {
  await open(page, SESSIONS.unstamped);
  await expect(page.getByText('You are Supporter 12.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-note="terms"]')).toHaveCount(0);
});

test("the board's test payment gets a plain thank-you, no number", async ({ page }) => {
  await open(page, SESSIONS.notCounted);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you');
  await expect(page.getByText(/Supporter \d/)).toHaveCount(0);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  await expect(main.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
});

test('with no session: a plain thank-you with links home and to Contribute', async ({ page }) => {
  const sent = thanksRequests(page);
  await page.goto('/thanks');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank you');
  await expect(page.getByText('Thank you for supporting the studio.', { exact: true })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  await expect(main.getByRole('link', { name: 'Contribute' })).toHaveAttribute('href', '/contribute');
  expect(sent).toEqual([]);
});
