import type { Page, Route } from '@playwright/test';
import { expect, overflowsHorizontally, test } from './fixtures';

// /seeds?save=<code> (docs/specs/final-state.md, Seeds and instances): the game links here to save a
// run as a seed. The community function is answered here, as community.mts would answer it; every
// request stays on the site's own origin under the enforced policy. And with no VITE_TWITCH_CHANNEL in
// the build (the e2e build sets none), home shows no Twitch link.

const json = 'application/json; charset=utf-8';
type Post = { path: string; body: unknown; auth: string | null };

async function answerCommunity(page: Page, posts: Post[]) {
  await page.route(/\/api\/community\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      const body = request.postData() ? (JSON.parse(request.postData()!) as unknown) : null;
      // The top bar's you slot reads the player's profile on every page (docs/specs/place.md); the
      // writes are what this spec counts.
      if (url.pathname === '/api/community/rpc/my_profile') return route.fulfill({ status: 503, contentType: json, body: '{"error":"not in the e2e fixtures"}' });
      posts.push({ path: url.pathname, body, auth: (await request.allHeaders()).authorization ?? null });
      if (url.pathname === '/api/community/rpc/save_seed') return route.fulfill({ status: 200, contentType: json, body: '{"id":"5eed0000-0000-4000-8000-000000000001"}' });
      if (url.pathname === '/api/community/auth/otp') return route.fulfill({ status: 200, contentType: json, body: '{"sent":true}' });
      return route.fulfill({ status: 503, contentType: json, body: '{"error":"not in the e2e fixtures"}' });
    }
    if (url.pathname === '/api/community/seeds') return route.fulfill({ status: 200, contentType: json, body: '{"items":[],"next":null}' });
    return route.fulfill({ status: 503, contentType: json, body: '{"error":"not in the e2e fixtures"}' });
  });
}

async function watchPolicy(page: Page): Promise<string[]> {
  const reports: string[] = [];
  await page.exposeFunction('e2eSeedPolicyReport', (line: string) => reports.push(line));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { e2eSeedPolicyReport: (line: string) => void }).e2eSeedPolicyReport(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  return reports;
}

const SESSION = JSON.stringify({ accessToken: 'e2e-access', refreshToken: 'e2e-refresh', expiresAt: 4_102_444_800_000 });

test('a signed-in player saves a linked seed once, sees it, and the address drops ?save=', async ({ page }) => {
  const reports = await watchPolicy(page);
  const posts: Post[] = [];
  await answerCommunity(page, posts);
  await page.addInitScript((session) => window.localStorage.setItem('mm:player-session', session), SESSION);
  await page.goto('/seeds?save=dust%3Av3%3AAbC_-9');
  const save = page.getByRole('region', { name: 'Save this seed' });
  await expect(save.getByRole('status')).toHaveText('Saved to your profile.');
  await expect(save).toContainText('dust:v3:AbC_-9');
  await expect(save.getByRole('link', { name: 'Play this seed' })).toHaveAttribute('href', 'https://play.mobmachine.games/?seed=dust%3Av3%3AAbC_-9');
  expect(new URL(page.url()).search).toBe('');
  expect(posts).toEqual([{ path: '/api/community/rpc/save_seed', body: { game: 'dust', code: 'dust:v3:AbC_-9', title: null, publish: false }, auth: 'Bearer e2e-access' }]);
  expect(await overflowsHorizontally(page)).toBe(false);
  expect(reports).toEqual([]);
});

test('a code outside the rule is never sent', async ({ page }) => {
  const posts: Post[] = [];
  await answerCommunity(page, posts);
  await page.addInitScript((session) => window.localStorage.setItem('mm:player-session', session), SESSION);
  await page.goto('/seeds?save=dust%3Av3%3A%3Cimg%3E');
  await expect(page.getByRole('region', { name: 'Save this seed' })).toContainText('This link does not hold a seed code');
  expect(posts).toEqual([]);
});

test('a signed-out player signs in by email and the save completes when the link brings them back', async ({ page }) => {
  const reports = await watchPolicy(page);
  const posts: Post[] = [];
  await answerCommunity(page, posts);
  await page.goto('/seeds?save=dust%3Av3%3Aabc');
  const save = page.getByRole('region', { name: 'Save this seed' });
  await expect(save).toContainText('Sign in to keep this seed on your profile.');
  await save.getByLabel('Email').fill('player@example.com');
  await save.getByRole('button', { name: 'Send the link' }).click();
  await expect(save.getByRole('status')).toHaveText('Check your email for the link. It works once.');
  const origin = new URL(page.url()).origin;
  expect(posts).toEqual([{ path: '/api/community/auth/otp', body: { email: 'player@example.com', redirectTo: `${origin}/me` }, auth: null }]);

  // The magic link lands on /me with the session in the fragment; /me sends the player back to save.
  await page.goto('/me#access_token=e2e-link-access&refresh_token=e2e-link-refresh&expires_in=3600');
  await expect(page).toHaveURL(/\/seeds$/);
  await expect(page.getByRole('region', { name: 'Save this seed' }).getByRole('status')).toHaveText('Saved to your profile.');
  // The sign-in also claims any guest payments (docs/specs/place.md); the save is the one other post.
  expect(posts.slice(1).filter((post) => post.path !== '/api/community/rpc/claim_contributions')).toEqual([{ path: '/api/community/rpc/save_seed', body: { game: 'dust', code: 'dust:v3:abc', title: null, publish: false }, auth: 'Bearer e2e-link-access' }]);
  expect(await page.evaluate(() => window.localStorage.getItem('mm:pending-seed'))).toBeNull();
  expect(reports).toEqual([]);
});

test('home shows no Twitch link when the build names no channel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The studio, live' })).toBeVisible();
  await expect(page.locator('a[href*="twitch.tv"]')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
});
