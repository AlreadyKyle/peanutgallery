import type { Page, Request } from '@playwright/test';
import { DISCORD_INVITE, E2E_ORIGIN } from './fixture-env';
import { expect, test } from './fixtures';

// The site's benchmark counters (docs/specs/counter-senders.md): home views and their dwell, the
// broadcast's load and its QR landing, and a press on a Discord link. Each is a POST to the site's own
// /api/count carrying the event's name alone, with no cookie and no query string.

function countsOf(page: Page): { events: string[]; requests: Request[] } {
  const seen = { events: [] as string[], requests: [] as Request[] };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname !== '/api/count') return;
    seen.requests.push(request);
    seen.events.push(String((JSON.parse(request.postData() ?? '{}') as { event?: unknown }).event));
  });
  return seen;
}

async function plain(requests: Request[]): Promise<void> {
  for (const request of requests) {
    expect(request.method()).toBe('POST');
    expect(request.postData()).toMatch(/^\{"event":"[a-z0-9_]+"\}$/);
    expect(new URL(request.url()).origin).toBe(E2E_ORIGIN);
    expect(new URL(request.url()).search).toBe('');
    expect(await request.headerValue('cookie')).toBeNull();
  }
}

test('home counts its view, then its dwell at 15 and 45 seconds, and stops on another page', async ({ page }) => {
  await page.clock.install();
  const seen = countsOf(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => seen.events).toEqual(['home_load']);
  await page.clock.runFor(16_000);
  await expect.poll(() => seen.events).toEqual(['home_load', 'home_dwell_mid']);
  await page.clock.runFor(30_000);
  await expect.poll(() => seen.events).toEqual(['home_load', 'home_dwell_mid', 'home_dwell_long']);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await page.clock.runFor(60_000);
  expect(seen.events).toEqual(['home_load', 'home_dwell_mid', 'home_dwell_long']);
  await plain(seen.requests);
  // Nothing was stored in the browser to count: no cookie, and only the home page's own last visit
  // (lib/last-visit.ts, docs/specs/whats-new.md) in local storage.
  expect(await page.evaluate(() => document.cookie)).toBe('');
  expect(await page.evaluate(() => Object.keys(window.localStorage))).toEqual(['peanutgallery.home.lastVisit']);
});

test('/broadcast counts its load, and its QR code carries the source tag', async ({ page }) => {
  const seen = countsOf(page);
  await page.goto('/broadcast');
  await expect(page.getByRole('img', { name: 'A code that opens mobmachine.games/contribute' })).toBeVisible();
  await expect.poll(() => seen.events).toEqual(['broadcast_load']);
  await plain(seen.requests);
});

test('a landing from the QR code counts broadcast_qr once and drops the tag from the address', async ({ page }) => {
  const seen = countsOf(page);
  await page.goto('/contribute?from=broadcast');
  await expect.poll(() => new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).pathname).toBe('/contribute');
  await expect.poll(() => seen.events).toEqual(['broadcast_qr']);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(seen.events).toEqual(['broadcast_qr']);
  await plain(seen.requests);
});

test('a press on the Discord link counts discord_click and still opens Discord', async ({ page }) => {
  await page.route(`${DISCORD_INVITE}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Discord</title>' }));
  const seen = countsOf(page);
  await page.goto('/faq');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const counted = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/count');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Discord' }).click();
  await counted;
  await expect(page).toHaveURL(DISCORD_INVITE);
  expect(seen.events).toEqual(['discord_click']);
  await plain(seen.requests);
});
