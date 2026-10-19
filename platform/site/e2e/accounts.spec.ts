import type { Page, Route } from '@playwright/test';
import { expect, overflowsHorizontally, test } from './fixtures';

// Sign-in and sign-up (docs/specs/accounts.md): an email and a password, a provider button only once
// that provider is switched on, a reset link that lands on /reset-password, and a one-time sign-in
// link as the second way. The community function is answered here as community.mts would answer it.

const json = 'application/json; charset=utf-8';
type Post = { path: string; body: Record<string, unknown>; auth: string | null };

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

type Options = { providers?: string[]; password?: 'ok' | 'wrong' | 'unconfirmed' };

async function answer(page: Page, posts: Post[], options: Options = {}): Promise<void> {
  await page.route(/\/api\/community\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (status: number, value: unknown) => route.fulfill({ status, contentType: json, body: JSON.stringify(value) });
    if (request.method() === 'GET') {
      if (url.pathname === '/api/community/auth/settings') return reply(200, { signIn: true, providers: options.providers ?? [] });
      return reply(503, { error: 'not in the e2e fixtures' });
    }
    const body = request.postData() ? (JSON.parse(request.postData()!) as Record<string, unknown>) : {};
    posts.push({ path: url.pathname, body, auth: (await request.allHeaders()).authorization ?? null });
    switch (url.pathname) {
      case '/api/community/auth/password': {
        const password = options.password ?? 'ok';
        if (password === 'wrong') return reply(401, { error: 'Wrong email or password', code: 'wrong' });
        if (password === 'unconfirmed') return reply(403, { error: 'Confirm your email first', code: 'unconfirmed' });
        return reply(200, { access_token: 'e2e-password-access', refresh_token: 'e2e-password-refresh', expires_in: 3600 });
      }
      case '/api/community/auth/signup':
        return reply(200, { confirm: true });
      case '/api/community/auth/recover':
      case '/api/community/auth/resend':
      case '/api/community/auth/otp':
        return reply(200, { sent: true });
      case '/api/community/auth/new-password':
        return reply(200, { changed: true });
      case '/api/community/rpc/my_profile':
        return reply(200, PROFILE);
      case '/api/community/rpc/my_follows':
        return reply(200, { follows: [], open: 0, cap: 100 });
      case '/api/community/rpc/claim_contributions':
        return reply(200, { claimed: 0 });
      default:
        return reply(503, { error: 'not in the e2e fixtures' });
    }
  });
}

const authPosts = (posts: Post[]) => posts.filter((post) => post.path.includes('/auth/'));

test('signs in with an email and password and lands on the desk, which claims guest contributions', async ({ page }) => {
  const posts: Post[] = [];
  await answer(page, posts);
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('Player@Example.com ');
  await page.getByLabel('Password', { exact: true }).fill('a long password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your desk' })).toBeVisible();
  expect(authPosts(posts)).toEqual([{ path: '/api/community/auth/password', body: { email: 'Player@Example.com', password: 'a long password' }, auth: null }]);
  await expect.poll(() => posts.filter((post) => post.path.endsWith('/claim_contributions')).length).toBe(1);
  expect(await page.evaluate(() => JSON.parse(window.localStorage.getItem('mm:player-session') ?? '{}').accessToken)).toBe('e2e-password-access');
});

test('a password sign-in goes back to the page the visitor left to sign in', async ({ page }) => {
  const posts: Post[] = [];
  await answer(page, posts);
  await page.goto('/sign-in');
  await page.evaluate(() => window.localStorage.setItem('mm:return-to', '/suggest#suggest-send'));
  await page.getByLabel('Email').fill('player@example.com');
  await page.getByLabel('Password', { exact: true }).fill('a long password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/suggest#suggest-send$/);
});

test('a wrong password says so without saying which part was wrong, and an unconfirmed email offers the link again', async ({ page }) => {
  const posts: Post[] = [];
  await answer(page, posts, { password: 'wrong' });
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('player@example.com');
  await page.getByLabel('Password', { exact: true }).fill('nope');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('That email and password do not match. Try again, or reset your password.');
  await expect(page).toHaveURL(/\/sign-in$/);

  const later: Post[] = [];
  await page.unrouteAll();
  await answer(page, later, { password: 'unconfirmed' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Confirm your email first.');
  await page.getByRole('button', { name: 'Send the confirmation link again' }).click();
  await expect(page.getByRole('status')).toContainText('We sent a link to player@example.com.');
  expect(later.map((post) => post.path)).toEqual(['/api/community/auth/password', '/api/community/auth/resend']);
});

test('creates an account and asks the visitor to confirm their email, with the same link for any address', async ({ page }) => {
  const posts: Post[] = [];
  await answer(page, posts);
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
  await expect(page.getByText('At least 8 characters.')).toBeVisible();
  await page.getByLabel('Email').fill('new@example.com');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('a long password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  await expect(page.getByRole('status')).toContainText('We sent a link to new@example.com. Open it to confirm your address and sign in.');
  const origin = new URL(page.url()).origin;
  expect(authPosts(posts)).toEqual([{ path: '/api/community/auth/signup', body: { email: 'new@example.com', password: 'a long password', redirectTo: `${origin}/me` }, auth: null }]);
  expect(await overflowsHorizontally(page)).toBe(false);
});

test('a forgotten password: the reset link lands on /me, which sends the player to choose a new one', async ({ page }) => {
  const posts: Post[] = [];
  await answer(page, posts);
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel('Email').fill('player@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If player@example.com has an account, a link to choose a new password is on its way.');
  const origin = new URL(page.url()).origin;
  expect(authPosts(posts)).toEqual([{ path: '/api/community/auth/recover', body: { email: 'player@example.com', redirectTo: `${origin}/me` }, auth: null }]);

  await page.goto('/me#access_token=e2e-reset-access&refresh_token=e2e-reset-refresh&expires_in=3600&type=recovery');
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel('New password').fill('my new password');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('status')).toContainText('Your new password is saved. You are signed in.');
  expect(posts.filter((post) => post.path.endsWith('/new-password'))).toEqual([{ path: '/api/community/auth/new-password', body: { password: 'my new password' }, auth: 'Bearer e2e-reset-access' }]);
});

test('/reset-password without a reset link says the link ran out and offers a new one', async ({ page }) => {
  await answer(page, []);
  await page.goto('/reset-password');
  await expect(page.getByRole('status')).toContainText('That reset link has expired or was already used.');
  await expect(page.getByRole('link', { name: 'Send reset link' })).toHaveAttribute('href', '/forgot-password');
});

test('shows a provider button only for a provider that is switched on, sending it through this site', async ({ page }) => {
  await answer(page, [], { providers: [] });
  await page.goto('/sign-in');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Continue with/ })).toHaveCount(0);
  await expect(page.getByText('or', { exact: true })).toHaveCount(0);

  await page.unrouteAll();
  await answer(page, [], { providers: ['google', 'discord'] });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto('/sign-up');
  const buttons = page.getByRole('link', { name: /^Continue with/ });
  await expect(buttons).toHaveText(['Continue with Google', 'Continue with Discord']);
  const origin = new URL(page.url()).origin;
  await expect(buttons.first()).toHaveAttribute('href', `/api/community/auth/authorize?provider=google&redirectTo=${encodeURIComponent(`${origin}/me`)}`);
});

test('a provider sign-in lands on /me with the session and stays on the desk', async ({ page }) => {
  const posts: Post[] = [];
  await answer(page, posts);
  await page.goto('/me#access_token=e2e-google-access&refresh_token=e2e-google-refresh&expires_in=3600&token_type=bearer');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole('heading', { name: 'Edit your profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Password' })).toBeVisible();
});

test('a signed-in visitor opening /sign-in goes to their desk', async ({ page }) => {
  await answer(page, []);
  await page.addInitScript(() =>
    window.localStorage.setItem('mm:player-session', JSON.stringify({ accessToken: 'e2e-access', refreshToken: 'e2e-refresh', expiresAt: 4_102_444_800_000 })),
  );
  await page.goto('/sign-in');
  await expect(page).toHaveURL(/\/me$/);
});
