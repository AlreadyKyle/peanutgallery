import { test as base, expect, type Page } from '@playwright/test';
import { SUPABASE_URL } from './fixture-env';
import { toCardDetail, toDocuments } from './snapshot-documents';
import { DEFAULT_STUDIO, type StudioFixture } from './studio-fixture';

export { DEFAULT_STUDIO, fundingOrder, moneyRow, POSTED_TERMS, type StudioFixture } from './studio-fixture';

export { expect };

/**
 * Serves /api/live and /api/cards from the fixture, built the way site_live() and site_cards() build
 * them (snapshot-documents.ts), /api/reports from its reports, and /api/card/:id and /api/thanks as
 * card.mts does. Any request to the Supabase host fails the test: the public site
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
  // netlify/functions/card.mts (docs/specs/supporter-pages.md): a card's own document, 400 for an id
  // that is not a uuid and 404 for no card; and the /thanks answer by session, pending when unknown.
  const json = 'application/json; charset=utf-8';
  await page.route(/\/api\/card\/[^/?]*(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, contentType: json, body: '{"error":"Only GET is allowed"}' });
    if (!UUID.test(id) || url.search !== '') return route.fulfill({ status: 400, contentType: json, body: '{"error":"Not a card id"}' });
    const detail = toCardDetail(studio, id.toLowerCase());
    if (detail === null) return route.fulfill({ status: 404, contentType: json, body: '{"error":"There is no card at this address"}' });
    return route.fulfill({ status: 200, contentType: json, body: JSON.stringify(detail) });
  });
  // /api/reports (docs/specs/studio-reports.md), as snapshot.mts answers it: GET only, no query.
  await page.route(/\/api\/reports(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, contentType: json, body: '{"error":"Only GET is allowed"}' });
    if (new URL(route.request().url()).search !== '') return route.fulfill({ status: 400, contentType: json, body: '{"error":"No query string is allowed"}' });
    return route.fulfill({ status: 200, contentType: json, body: JSON.stringify({ reports: studio.reports ?? [] }) });
  });
  await page.route(/\/api\/thanks(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 405, contentType: json, body: '{"error":"Only POST is allowed"}' });
    let session = '';
    try {
      session = String((JSON.parse(route.request().postData() ?? '{}') as { session?: unknown }).session ?? '');
    } catch {
      session = '';
    }
    if (!SESSION.test(session)) return route.fulfill({ status: 400, contentType: json, body: '{"error":"Send a session"}' });
    const answer = studio.thanks?.[session] ?? { status: 'pending' };
    return route.fulfill({ status: 200, contentType: json, headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(answer) });
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^cs_(live|test)_[A-Za-z0-9]{10,250}$/;

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
