import { test as base, expect, type Page } from '@playwright/test';
import { SUPABASE_URL } from './fixture-env';
import { POSTED_TERMS, type StudioFixture } from './studio-fixture';

export { DEFAULT_STUDIO, fundingOrder, moneyRow, POSTED_TERMS, type StudioFixture } from './studio-fixture';

export { expect };

/** Answers every Supabase REST request from the fixture and holds realtime open with no server. */
export async function mockStudio(page: Page, studio: StudioFixture): Promise<void> {
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, () => {});
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
    const ids = url.searchParams.get('id');
    const rows: Record<string, unknown> = {
      pool: [studio.pool],
      cards:
        ids !== null && ids.startsWith('in.')
          ? studio.cards.filter((c) => ids.includes(String(c.id))).map((c) => ({ id: c.id, title: c.title }))
          : studio.cards,
      public_card_funding: studio.funding,
      public_card_spend: studio.spend,
      public_studio: [{ launched_at: studio.launchedAt, paused: studio.paused, platform_lane_open: false, pause_reason: studio.paused ? (studio.pauseReason ?? null) : null }],
      public_money: studio.money === null ? null : [studio.money],
      public_stopped_cards: studio.stopped,
      public_ledger_totals: [studio.totals],
      public_agent_events: studio.events,
      deploys: studio.deploys,
      public_roles: studio.roles,
      public_terms_versions: studio.terms ?? POSTED_TERMS,
    };
    if (table === undefined || !(table in rows) || route.request().method() !== 'GET') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: `${url.pathname} is not in the e2e fixture` }) });
      return;
    }
    // A read the fixture fails on purpose (money or stopped set to null).
    if (rows[table] === null) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: `${table} failed in the e2e fixture` }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[table]) });
  });
}

/** Every e2e test gets a page whose Supabase requests the fixture answers; override `studio` per test. */
export const test = base.extend<{ studio: StudioFixture }>({
  studio: [DEFAULT_STUDIO, { option: true }],
  page: async ({ page, studio }, use) => {
    await mockStudio(page, studio);
    await use(page);
  },
});

export async function overflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

export const WIDTHS = [
  { width: 375, height: 812 },
  { width: 1440, height: 1000 },
] as const;
