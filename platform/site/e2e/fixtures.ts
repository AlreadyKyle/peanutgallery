import { test as base, expect, type Page } from '@playwright/test';
import { SUPABASE_URL } from './fixture-env';
import { toDocuments } from './snapshot-documents';
import { DEFAULT_STUDIO, type StudioFixture } from './studio-fixture';

export { DEFAULT_STUDIO, fundingOrder, moneyRow, POSTED_TERMS, type StudioFixture } from './studio-fixture';

export { expect };

/**
 * Serves /api/live and /api/cards from the fixture, built the way site_live() and site_cards() build
 * them (snapshot-documents.ts). Any request to the Supabase host fails the test: the public site
 * reads only its own origin (docs/specs/site-snapshot.md). The documents are rebuilt on each request,
 * so a test can change the fixture between loads.
 */
export async function mockStudio(page: Page, studio: StudioFixture): Promise<void> {
  await page.route(`${SUPABASE_URL}/**`, (route) => route.fulfill({ status: 500, body: 'The public site must not read Supabase' }));
  await page.route(/\/api\/(live|cards)(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, contentType: 'application/json; charset=utf-8', body: '{"error":"Only GET is allowed"}' });
      return;
    }
    if (url.search !== '') {
      await route.fulfill({ status: 400, contentType: 'application/json; charset=utf-8', body: '{"error":"No query string is allowed"}' });
      return;
    }
    const docs = toDocuments(studio);
    const body = url.pathname === '/api/live' ? docs.live : docs.cards;
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  });
}

/**
 * Every e2e test gets a page whose /api requests the fixture answers; override `studio` per test. A
 * test fails when its page requested the Supabase host or opened a WebSocket.
 */
export const test = base.extend<{ studio: StudioFixture }>({
  studio: [DEFAULT_STUDIO, { option: true }],
  page: async ({ page, studio }, use) => {
    const offOrigin: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).host === new URL(SUPABASE_URL).host) offOrigin.push(request.url());
    });
    page.on('websocket', (socket) => offOrigin.push(socket.url()));
    await mockStudio(page, studio);
    await use(page);
    expect(offOrigin, 'the public site requested the Supabase host or opened a WebSocket').toEqual([]);
  },
});

export async function overflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

export const WIDTHS = [
  { width: 375, height: 812 },
  { width: 1440, height: 1000 },
] as const;
