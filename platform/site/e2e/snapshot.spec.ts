import type { Page } from '@playwright/test';
import { SUPABASE_URL } from './fixture-env';
import { expect, test } from './fixtures';

// The site's own documents (docs/specs/site-snapshot.md): every page reads /api/live and /api/cards
// from its own origin, never the Supabase host, and opens no WebSocket; a hidden tab makes no request;
// a visible one reads /api/live each minute and /api/cards only on the first load; an in-app route
// change asks which build is served and reloads a stale tab once, not twice.
const ROUTES = ['/', '/contribute', '/ledger', '/how-it-works', '/team', '/roadmap', '/terms', '/terms/1', '/privacy', '/refunds', '/refunds/1', '/contact', '/no-such-page', '/design-kit-7q4m'];

/** Lets a test hide and show the tab: visibilityState reads window.__hidden. */
async function controlVisibility(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const flag = window as unknown as { __hidden?: boolean };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (flag.__hidden === true ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => flag.__hidden === true });
  });
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as { __hidden?: boolean }).__hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Every /api request the page makes, by path. */
function apiRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) seen.push(url.pathname);
  });
  return seen;
}

test('no route requests the Supabase host or opens a WebSocket, and every route reads its own /api', async ({ page }) => {
  const offOrigin: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(SUPABASE_URL)) offOrigin.push(request.url());
  });
  page.on('websocket', (socket) => offOrigin.push(socket.url()));
  const api = apiRequests(page);
  for (const path of ROUTES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(offOrigin).toEqual([]);
  expect(api).toContain('/api/live');
  expect(api).toContain('/api/cards');
});

test('a hidden tab makes no /api request over three minutes, and a return reads /api/live at once', async ({ page }) => {
  await controlVisibility(page);
  await page.clock.install();
  const api = apiRequests(page);
  await page.goto('/');
  await expect(page.locator('main .pool-line .figure')).toHaveText('$12.34');
  await setHidden(page, true);
  const before = api.length;
  await page.clock.runFor(180_000);
  expect(api.slice(before)).toEqual([]);
  await setHidden(page, false);
  await expect.poll(() => api.slice(before)).toEqual(['/api/live']);
});

test('a tab opened hidden makes no /api request until it is shown', async ({ page }) => {
  await controlVisibility(page);
  await page.addInitScript(() => {
    (window as unknown as { __hidden?: boolean }).__hidden = true;
  });
  await page.clock.install();
  const api = apiRequests(page);
  await page.goto('/');
  await page.clock.runFor(180_000);
  expect(api).toEqual([]);
  await setHidden(page, false);
  await expect.poll(() => [...api].sort()).toEqual(['/api/cards', '/api/live']);
});

test('a visible tab reads /api/live every 60 seconds and /api/cards only on the first load', async ({ page }) => {
  await page.clock.install();
  const api = apiRequests(page);
  await page.goto('/');
  await expect(page.locator('main .pool-line .figure')).toHaveText('$12.34');
  expect([...api].sort()).toEqual(['/api/cards', '/api/live']);
  await page.clock.runFor(60_000);
  await expect.poll(() => api.filter((path) => path === '/api/live').length).toBe(2);
  await page.clock.runFor(60_000);
  await expect.poll(() => api.filter((path) => path === '/api/live').length).toBe(3);
  expect(api.filter((path) => path === '/api/cards')).toHaveLength(1);
});

test('an in-app route change reads /version.json once and leaves a current tab alone', async ({ page }) => {
  const versions: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/version.json') versions.push(request.url());
  });
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(versions).toEqual([]);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Terms', exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect.poll(() => versions.length).toBe(1);
  await page.waitForTimeout(300);
  expect(loads).toBe(1);
});

test('a stale tab reloads once on a route change, not twice', async ({ page }) => {
  await page.route('**/version.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'f'.repeat(40), builtAt: '2026-09-23T00:00:00.000Z' }) }),
  );
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(loads).toBe(1);
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('link', { name: 'Terms', exact: true }).click();
  // The reader lands on the page they chose, in a fresh load.
  await expect.poll(() => loads).toBe(2);
  await expect(page).toHaveURL(/\/terms$/);
  expect(await page.evaluate(() => sessionStorage.getItem('pg:reloaded-for'))).toBe('f'.repeat(40));
  // The CDN still serves the old page: the next move reads the version again and does not reload.
  await footer.getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await page.waitForTimeout(500);
  expect(loads).toBe(2);
});
