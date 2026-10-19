import type { Page, Request } from '@playwright/test';
import { DISCORD_INVITE, E2E_ORIGIN, PAYMENT_LINK, PLAY_URL } from './fixture-env';
import { expect, test } from './fixtures';

// The site's benchmark counters (docs/specs/counter-senders.md): home views and their dwell, the
// broadcast's load and its QR landing, a press on a Discord link, and the funnel: /contribute's load,
// a press on a Payment Link and a press from home into the game. Each is a POST to the site's own
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

// Two beacons sent in one moment may reach the network in either order.
const sorted = (events: string[]): string[] => [...events].sort();

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

// An automated browser (a check, a screenshot run) is not a visitor: it says so in
// navigator.webdriver, and the site counts nothing there, however long it stays on home.
test('an automated browser counts nothing: no home view, no dwell, no /contribute load', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => true, configurable: true }));
  await page.clock.install();
  const seen = countsOf(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.clock.runFor(50_000);
  await page.goto('/contribute');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  expect(seen.events).toEqual([]);
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
  await expect.poll(() => sorted(seen.events)).toEqual(['broadcast_qr', 'contribute_load']);
  // The reload is another load of /contribute, and no landing.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => sorted(seen.events)).toEqual(['broadcast_qr', 'contribute_load', 'contribute_load']);
  await plain(seen.requests);
});

test("a landing from a channel's tagged link counts from_<channel> once and drops the tag (docs/specs/channel-counters.md)", async ({ page }) => {
  const seen = countsOf(page);
  await page.goto('/contribute?from=reddit');
  await expect.poll(() => new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).pathname).toBe('/contribute');
  await expect.poll(() => sorted(seen.events)).toEqual(['contribute_load', 'from_reddit']);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => sorted(seen.events)).toEqual(['contribute_load', 'contribute_load', 'from_reddit']);
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

test('/contribute counts its load once, and a press on a Payment Link counts checkout_open and still opens checkout', async ({ page }) => {
  await page.route(`${PAYMENT_LINK}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Checkout</title>' }));
  const seen = countsOf(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => seen.events).toEqual(['home_load']);
  // The top bar's Contribute moves inside the site: a view of /contribute, no new page load.
  await page.getByRole('banner').getByRole('link', { name: 'Contribute' }).click();
  await expect(page).toHaveURL(/\/contribute$/);
  await expect.poll(() => seen.events).toEqual(['home_load', 'contribute_load']);
  const counted = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/count' && request.postData() === '{"event":"checkout_open"}');
  const choice = page.getByRole('main').locator(`a.choice-primary[href^="${PAYMENT_LINK}"]`);
  await choice.click();
  await counted;
  await expect(page).toHaveURL(new RegExp(`^${PAYMENT_LINK}`));
  expect(seen.events).toEqual(['home_load', 'contribute_load', 'checkout_open']);
  await plain(seen.requests);
});

test("a press on home's Play counts home_play_click once and still opens the game; Play on another page counts nothing", async ({ page }) => {
  await page.route(`${PLAY_URL}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Dust</title>' }));
  const seen = countsOf(page);
  await page.goto('/faq');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // A middle-button press on the top bar's Play away from home counts nothing.
  await page.getByRole('banner').getByRole('link', { name: 'Play', exact: true }).dispatchEvent('auxclick', { button: 1, bubbles: true });
  await page.waitForTimeout(500);
  expect(seen.events).toEqual([]);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => seen.events).toEqual(['home_load']);
  const counted = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/count' && request.postData() === '{"event":"home_play_click"}');
  await page.getByRole('main').getByRole('link', { name: 'Play free' }).click();
  await counted;
  await expect(page).toHaveURL(new RegExp(`^${PLAY_URL}`));
  expect(seen.events).toEqual(['home_load', 'home_play_click']);
  await plain(seen.requests);
});
