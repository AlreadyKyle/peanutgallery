import type { Page, Route } from '@playwright/test';
import { answerCommunity, PLAYER, signIn } from './community-fixture';
import { expect, test } from './fixtures';
import { SUPPORTER_STUDIO } from './supporter-studio';

// Cumulative layout shift on the pages whose body arrives after first paint (/me, /u/:handle, the
// account pages): each page draws its final layout, or holds the space for it, before its answers
// come, so nothing visible moves when they do. The community function answers late here, as it does
// on a phone in production, so a page that draws one layout while waiting and another after shows it.
test.use({ studio: SUPPORTER_STUDIO });

/** CLS's "good" line (web.dev): a page past it moves enough for a reader to lose their place. */
const GOOD = 0.1;
const LATE_MS = 600;

async function late(page: Page): Promise<void> {
  // A route added later runs first: hold every community answer, then hand it to the fixture.
  await page.route(/\/api\/community\//, async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, LATE_MS));
    await route.fallback();
  });
}

async function profileAnswer(page: Page): Promise<void> {
  const json = 'application/json; charset=utf-8';
  await page.route(/\/api\/community\/profile\/[^/]+$/, (route) =>
    route.request().url().endsWith('/wren')
      ? route.fulfill({ status: 200, contentType: json, body: JSON.stringify(PLAYER) })
      : route.fulfill({ status: 404, contentType: json, body: '{"error":"No player"}' }),
  );
}

/** The page's layout shifts, summed as CLS sums them (none within 500ms of an input), once it settles. */
async function shiftAfterLoad(page: Page, path: string): Promise<{ total: number; shifts: string[] }> {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: { value: number; sources: string[] }[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] }[]) {
        if (entry.hadRecentInput) continue;
        const sources = (entry.sources ?? []).map(({ node }) => {
          const el = node instanceof Element ? node : node?.parentElement;
          return el === null || el === undefined ? '?' : `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`;
        });
        w.__shifts.push({ value: entry.value, sources });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(LATE_MS + 400);
  const shifts = await page.evaluate(() => (window as unknown as { __shifts: { value: number; sources: string[] }[] }).__shifts);
  return { total: shifts.reduce((sum, s) => sum + s.value, 0), shifts: shifts.map((s) => `${s.value.toFixed(3)} ${s.sources.join(' ')}`) };
}

const PAGES: { name: string; path: string; signedIn: boolean; profile?: boolean }[] = [
  { name: '/me signed out', path: '/me', signedIn: false },
  { name: '/me signed in', path: '/me', signedIn: true },
  { name: '/u/:handle', path: '/u/wren', signedIn: false, profile: true },
  { name: '/u/:handle with no player', path: '/u/nobody', signedIn: false, profile: true },
  { name: '/sign-up', path: '/sign-up', signedIn: false },
  { name: '/sign-in', path: '/sign-in', signedIn: false },
];

for (const { width, height } of [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  for (const { name, path, signedIn, profile } of PAGES) {
    test(`${name} holds still while its answers arrive (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await answerCommunity(page);
      if (profile) await profileAnswer(page);
      await late(page);
      if (signedIn) await signIn(page);
      const { total, shifts } = await shiftAfterLoad(page, path);
      console.log(`CLS ${name} ${width}px: ${total.toFixed(4)}`);
      expect(total, shifts.join('\n')).toBeLessThan(GOOD);
    });
  }
}
