import type { Page, Route } from '@playwright/test';
import { expect, overflowsHorizontally, test } from './fixtures';
import { LIVE_CARD_ID, OPEN_CARD_ID, SUPPORTER_STUDIO } from './supporter-studio';

// "Tell me when this ships" (docs/specs/card-follows.md): on a card's page a signed-in player follows
// and unfollows the card; a signed-out visitor is offered the magic-link sign-in and comes back to the
// card with the follow made; when sign-in is not available the form says so; a shipped card shows no
// button; /me lists the follows with Unfollow. The community function is answered here, as
// community.mts would answer it, and every request stays on the site's own origin.
test.use({ studio: SUPPORTER_STUDIO });

const json = 'application/json; charset=utf-8';
type Post = { path: string; body: unknown; auth: string | null };
const SESSION = JSON.stringify({ accessToken: 'e2e-access', refreshToken: 'e2e-refresh', expiresAt: 4_102_444_800_000 });

const PROFILE = {
  handle: 'supporter-7',
  displayName: 'Supporter 7',
  level: 1,
  avatar: { body: 'round', eyes: 'two', antennae: 'none', pattern: 'plain', fill: 'mint' },
  frame: null,
  flair: null,
  xp: 0,
  tier: 'Spectator',
  nextLevelXp: 100,
  badges: [],
  collection: [],
  seeds: [],
  suggestions: [],
  joinedAt: '2026-10-17T00:00:00Z',
  publicByDefault: true,
  frames: ['spectator'],
  contributions: [],
};

const followOf = (cardId: string, title: string, state = 'open') => ({
  cardId,
  title,
  stage: 'proposed',
  suit: 'game',
  rarity: 'common',
  state,
  followedAt: '2026-10-17T00:00:00Z',
  liveAt: null,
});

/** Answers the community function: follows kept in `followed`, sign-in links answered with `otpStatus`. */
async function answerCommunity(page: Page, posts: Post[], options: { followed?: Map<string, string>; otpStatus?: number } = {}) {
  const followed = options.followed ?? new Map<string, string>();
  await page.route(/\/api\/community\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'POST') return route.fulfill({ status: 503, contentType: json, body: '{"error":"not in the e2e fixtures"}' });
    const body = request.postData() ? (JSON.parse(request.postData()!) as Record<string, string>) : {};
    posts.push({ path: url.pathname, body, auth: (await request.allHeaders()).authorization ?? null });
    const reply = (status: number, value: unknown) => route.fulfill({ status, contentType: json, body: JSON.stringify(value) });
    switch (url.pathname) {
      case '/api/community/auth/otp':
        return options.otpStatus ? reply(options.otpStatus, { error: 'Email sign-in is not enabled' }) : reply(200, { sent: true });
      case '/api/community/rpc/my_follows':
        return reply(200, { follows: [...followed].map(([id, title]) => followOf(id, title)), open: followed.size, cap: 100 });
      case '/api/community/rpc/follow_card':
        followed.set(body.card_id!, 'A followed card');
        return reply(200, { ...followOf(body.card_id!, 'A followed card'), following: true });
      case '/api/community/rpc/unfollow_card':
        followed.delete(body.card_id!);
        return reply(200, { cardId: body.card_id, following: false });
      case '/api/community/rpc/my_profile':
        return reply(200, PROFILE);
      default:
        return reply(503, { error: 'not in the e2e fixtures' });
    }
  });
}

const follows = (posts: Post[]) => posts.filter((p) => /follow_card$/.test(p.path));

test('a signed-in player follows a card from its page, sees it pressed, and unfollows it', async ({ page }) => {
  const posts: Post[] = [];
  await answerCommunity(page, posts);
  await page.addInitScript((session) => window.localStorage.setItem('mm:player-session', session), SESSION);
  await page.goto(`/card/${OPEN_CARD_ID}`);
  const button = page.getByRole('button', { name: 'Tell me when this ships' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.follow [role="status"]')).toHaveText('You follow this card. The studio emails you once when it goes live.');
  expect(follows(posts)).toEqual([{ path: '/api/community/rpc/follow_card', body: { card_id: OPEN_CARD_ID }, auth: 'Bearer e2e-access' }]);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.follow [role="status"]')).toHaveText('You no longer follow this card.');
  expect(posts.filter((p) => p.path.endsWith('/unfollow_card'))).toEqual([{ path: '/api/community/rpc/unfollow_card', body: { card_id: OPEN_CARD_ID }, auth: 'Bearer e2e-access' }]);
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('a card the player already follows opens pressed', async ({ page }) => {
  const posts: Post[] = [];
  await answerCommunity(page, posts, { followed: new Map([[OPEN_CARD_ID, 'An open card']]) });
  await page.addInitScript((session) => window.localStorage.setItem('mm:player-session', session), SESSION);
  await page.goto(`/card/${OPEN_CARD_ID}`);
  await expect(page.getByRole('button', { name: 'Tell me when this ships' })).toHaveAttribute('aria-pressed', 'true');
  expect(follows(posts)).toEqual([]);
});

test('a signed-out visitor signs in by email and comes back to the card with the follow made', async ({ page }) => {
  const posts: Post[] = [];
  await answerCommunity(page, posts);
  await page.goto(`/card/${OPEN_CARD_ID}`);
  const button = page.getByRole('button', { name: 'Tell me when this ships' });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const form = page.locator('.follow form');
  await expect(form).toContainText('Sign in with your email and the studio emails you once when this card goes live.');
  await form.getByLabel('Email').fill('visitor@example.com');
  await form.getByRole('button', { name: 'Send the link' }).click();
  await expect(form.getByRole('status')).toHaveText('Check your email for the link. Opening it signs you in and follows this card.');
  const origin = new URL(page.url()).origin;
  expect(posts).toEqual([{ path: '/api/community/auth/otp', body: { email: 'visitor@example.com', redirectTo: `${origin}/me` }, auth: null }]);
  expect(await page.evaluate(() => window.localStorage.getItem('mm:pending-follow'))).toBe(OPEN_CARD_ID);

  // The magic link lands on /me with the session in the fragment; /me sends the player back to the card.
  await page.goto('/me#access_token=e2e-link-access&refresh_token=e2e-link-refresh&expires_in=3600');
  await expect(page).toHaveURL(new RegExp(`/card/${OPEN_CARD_ID}$`));
  await expect(page.getByRole('button', { name: 'Tell me when this ships' })).toHaveAttribute('aria-pressed', 'true');
  expect(follows(posts)).toEqual([{ path: '/api/community/rpc/follow_card', body: { card_id: OPEN_CARD_ID }, auth: 'Bearer e2e-link-access' }]);
  expect(await page.evaluate(() => window.localStorage.getItem('mm:pending-follow'))).toBeNull();
});

test('when email sign-in is not available, the form says so and nothing is kept waiting', async ({ page }) => {
  const posts: Post[] = [];
  await answerCommunity(page, posts, { otpStatus: 400 });
  await page.goto(`/card/${OPEN_CARD_ID}`);
  await page.getByRole('button', { name: 'Tell me when this ships' }).click();
  const form = page.locator('.follow form');
  await form.getByLabel('Email').fill('visitor@example.com');
  await form.getByRole('button', { name: 'Send the link' }).click();
  await expect(form.getByRole('status')).toHaveText('Sign-in is not available right now.');
  expect(await page.evaluate(() => window.localStorage.getItem('mm:pending-follow'))).toBeNull();
  // The rest of the card's page is unchanged.
  await expect(page.getByRole('region', { name: 'The facts' })).toBeVisible();
});

test('a card that has shipped shows no button', async ({ page }) => {
  const posts: Post[] = [];
  await answerCommunity(page, posts);
  await page.goto(`/card/${LIVE_CARD_ID}`);
  await expect(page.getByRole('region', { name: 'The facts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tell me when this ships' })).toHaveCount(0);
});

test('/me lists the followed cards, each linking its page, and Unfollow removes one', async ({ page }) => {
  const posts: Post[] = [];
  await answerCommunity(page, posts, { followed: new Map([[OPEN_CARD_ID, 'An open card']]) });
  await page.addInitScript((session) => window.localStorage.setItem('mm:player-session', session), SESSION);
  await page.goto('/me');
  const list = page.getByRole('region', { name: 'Cards you follow' });
  await expect(list.getByRole('link', { name: 'An open card' })).toHaveAttribute('href', `/card/${OPEN_CARD_ID}`);
  await expect(list).toContainText('Waiting for it to ship');
  await list.getByRole('button', { name: 'Unfollow An open card' }).click();
  await expect(list).toContainText('You follow no cards yet.');
  expect(posts.filter((p) => p.path.endsWith('/unfollow_card'))).toEqual([{ path: '/api/community/rpc/unfollow_card', body: { card_id: OPEN_CARD_ID }, auth: 'Bearer e2e-access' }]);
  expect(await overflowsHorizontally(page)).toBe(false);
});
