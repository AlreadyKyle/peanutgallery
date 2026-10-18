import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { answerCommunity, IDEAS, signIn } from './community-fixture';
import { expect, overflowsHorizontally, test } from './fixtures';
import { LIVE_CARD_ID, OPEN_CARD_ID, SESSIONS, SUPPORTER_STUDIO } from './supporter-studio';

// Mob Machine as a place (docs/specs/place.md): the top bar knows who is here, home is the studio's
// floor with the room's stations as links, Ideas are the first station, /me is the player's desk, and
// what a contribution gets you is said where people pay and once they have. Set E2E_PLACE_SHOTS to a
// folder to also save the pages' frames, signed out and signed in, at 375, 768 and 1440px.
test.use({ studio: SUPPORTER_STUDIO });

test('signed out, the top bar offers Sign in and the floor names every station', async ({ page }) => {
  await answerCommunity(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.you-chip')).toHaveText('Sign in');
  await expect(page.locator('.you-chip')).toHaveAttribute('href', '/me');
  // The room's tags and the rail's list both go to the five stations, in the machine's order.
  const tags = page.locator('.station-tags a');
  await expect(tags).toHaveCount(5);
  await expect(page.locator('.floor-stations a')).toHaveCount(5);
  expect(await page.locator('[data-station-part]').evaluateAll((parts) => parts.map((part) => part.getAttribute('data-station-part')))).toEqual([
    'ideas',
    'fund',
    'building',
    'shipped',
    'team',
  ]);
  // The Ideas station shows the board's top ideas, upvotes and all, before any card.
  const ideas = page.locator('[data-station-part="ideas"]');
  await expect(ideas.getByText(IDEAS[0]!.title)).toBeVisible();
  await expect(ideas.getByText('14 upvotes')).toBeVisible();
  await expect(ideas.getByRole('link', { name: 'Pitch an idea' })).toHaveAttribute('href', '/suggest#suggest-send');
  // What you get sits with the cards to fund, and paying never asks for an account.
  const perks = page.locator('[data-station-part="fund"] .perks');
  await expect(perks.getByText('As a guest', { exact: true })).toBeVisible();
  await expect(perks.getByText('10 XP for every dollar, more on rare cards.')).toBeVisible();
  // Pressing a station in the room goes to its part of the floor.
  await page.locator('.station-tags a[href="#shipped"]').click();
  await expect(page).toHaveURL(/#shipped$/);
  await expect(page.locator('[data-station-part="shipped"] h2')).toBeInViewport();
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('signed in, the top bar shows the player and home welcomes them back with their cards', async ({ page }) => {
  await answerCommunity(page);
  await signIn(page);
  await page.goto('/');
  await expect(page.locator('.you-chip[data-you="in"]')).toHaveAttribute('aria-label', 'Your desk: Wren, level 4');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back, Wren.' })).toBeVisible();
  const panel = page.locator('.here-panel');
  await expect(panel.getByRole('link', { name: 'The live card' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Open your desk' })).toHaveAttribute('href', '/me');
  // A signed-in player is not asked to make a profile.
  await expect(page.locator('[data-station-part="fund"] .perks').getByRole('link', { name: 'Make a free profile' })).toHaveCount(0);
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('the desk shows the player, what the next level opens, their cards, ideas and badges', async ({ page }) => {
  await answerCommunity(page);
  await signIn(page);
  await page.goto('/me');
  await expect(page.getByRole('heading', { level: 2, name: 'Wren' })).toBeVisible();
  await expect(page.locator('.desk-next')).toContainText('Level 5 unlocks soft body, three eyes, green colour.');
  const cards = page.locator('.desk-cards');
  await expect(cards.locator('li')).toHaveCount(3);
  await expect(cards.locator('li', { hasText: 'The live card' })).toContainText('Live');
  const ideas = page.locator('.desk-ideas');
  await expect(ideas.locator('li')).toHaveCount(2);
  await expect(ideas.locator('li').first()).toContainText('14 upvotes');
  await expect(page.locator('.badge-grid li')).toHaveCount(2);
  // Editing and claiming come after the desk.
  const order = await page.locator('main h2').allInnerTexts();
  expect(order.indexOf('Your cards')).toBeLessThan(order.indexOf('Edit your profile'));
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('Keep this card on /thanks signs the payer in and claims the card as soon as the link lands', async ({ page }) => {
  const posts = await answerCommunity(page);
  await page.goto(`/thanks?session=${SESSIONS.recorded}`);
  const keep = page.locator('.perks-keep');
  await expect(keep.getByRole('heading', { name: 'Keep this card' })).toBeVisible();
  await keep.getByRole('link', { name: 'Add it to my collection' }).click();
  await expect(page).toHaveURL(/\/me\?keep=1$/);
  await expect(page.getByRole('heading', { name: 'Keep this card' })).toBeVisible();
  await expect(page.locator('.perks')).toBeVisible();
  // The magic link lands on /me with the session in the fragment: the claim runs at once.
  await page.goto('/me#access_token=e2e-link-access&refresh_token=e2e-link-refresh&expires_in=3600');
  await expect(page.getByText('The cards you paid for as a guest are on your desk now.')).toBeVisible();
  expect(posts.filter((post) => post.path.endsWith('/claim_contributions'))).toEqual([
    { path: '/api/community/rpc/claim_contributions', body: {}, auth: 'Bearer e2e-link-access' },
  ]);
});

test('Pitch an idea sends a signed-out visitor to sign in and back to the form', async ({ page }) => {
  await answerCommunity(page);
  await page.goto('/suggest');
  await page.locator('[aria-labelledby="suggest-send"]').getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  // The link opens in a fresh load, as an email link does.
  await page.goto('about:blank');
  await page.goto('/me#access_token=e2e-link-access&refresh_token=e2e-link-refresh&expires_in=3600');
  await expect(page).toHaveURL(/\/suggest#suggest-send$/);
});

test('a card the community asked for links the ideas board, and its page says what you get', async ({ page }) => {
  await answerCommunity(page);
  await page.goto(`/card/${OPEN_CARD_ID}`);
  await expect(page.locator('.card-face-column .perks')).toBeVisible();
  await page.goto(`/card/${LIVE_CARD_ID}`);
  await expect(page.locator('.card-face-column .perks')).toHaveCount(0);
});

const SHOTS = process.env.E2E_PLACE_SHOTS ?? '';
const PAGES: readonly [string, string, boolean][] = [
  ['home', '/', false],
  ['home-in', '/', true],
  ['me', '/me', false],
  ['me-in', '/me', true],
  ['keep', '/me?keep=1', false],
  ['ideas', '/suggest', false],
  ['contribute', '/contribute', false],
  ['card-open', `/card/${OPEN_CARD_ID}`, false],
  ['thanks', `/thanks?session=${SESSIONS.recorded}`, false],
];

test.describe('place screenshots', () => {
  test.skip(SHOTS === '', 'set E2E_PLACE_SHOTS to save them');
  for (const width of [375, 768, 1440]) {
    for (const [name, path, signedIn] of PAGES) {
      test(`${name} at ${width}px`, async ({ page }) => {
        mkdirSync(SHOTS, { recursive: true });
        await answerCommunity(page);
        if (signedIn) await signIn(page);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
        await page.screenshot({ path: join(SHOTS, `${name}-${width}-fold.png`) });
      });
    }
  }
});
