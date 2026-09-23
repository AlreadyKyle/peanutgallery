import { auditLayout, LIMITS } from '../scripts/layout-audit.mjs';
import type { Page } from '@playwright/test';
import { SUPABASE_URL } from './fixture-env';
import { DEFAULT_STUDIO, expect, test, type StudioFixture } from './fixtures';
import { LIVE_STUDIO } from './live-studio';

// Layout balance (DESIGN.md, No dead space; docs/specs/home-and-design.md): on every public route,
// with realistic data, nothing leaves dead space. scripts/layout-audit.mjs holds the checks: no
// element past the viewport, no seam between bands, side-by-side blocks within max(160px, 35%) of
// each other, no run of empty space over 240px inside a band, grids that fill every row, card rows
// that line up with no hollow over 80px, headings spaced from the block above at least as far as that
// block from its own, buttons on one line, no orphaned glyph and a one-row top bar.
const ROUTES = ['/', '/contribute', '/ledger', '/how-it-works', '/team', '/roadmap', '/terms', '/terms/1', '/privacy', '/refunds', '/refunds/1', '/contact', '/no-such-page', '/design-kit-7q4m'];

async function audit(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // The figures arrive after first paint; wait for the loading lines to go.
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, undefined, { timeout: 5_000 }).catch(() => {});
  return page.evaluate(auditLayout, LIMITS);
}

function auditRoutes(label: string, studio: StudioFixture, widths: readonly number[], routes: readonly string[] = ROUTES) {
  test.describe(`layout balance, ${label}`, () => {
    test.use({ studio });
    for (const width of widths) {
      test(`leaves no dead space at ${width}px`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height: 900 });
        const findings: string[] = [];
        for (const path of routes) findings.push(...(await audit(page, path)).map((line) => `${path} ${line}`));
        expect(findings).toEqual([]);
      });
    }
  });
}

// The studio as production has it at launch, with long lists: six open cards, six shipped, twenty
// agent actions, ten deploys and every role.
auditRoutes('the launch-shaped studio', LIVE_STUDIO, [320, 375, 768, 1024, 1440]);
// The default fixture: a building-free studio with a picked card, a queued card and two shipped.
auditRoutes('the default fixture', DEFAULT_STUDIO, [375, 768, 1440]);
// Nothing loaded that could be empty: no roles (home draws no team strip), no actions, no deploys.
auditRoutes('an empty studio', { ...LIVE_STUDIO, roles: [], events: [], deploys: [] }, [375, 1440], ['/', '/team', '/ledger', '/how-it-works']);

// Home with each count of open cards the fill rule has to handle, and one card with no brief.
const open = LIVE_STUDIO.cards.filter((card) => card.horizon === 'now' && (card.stage === 'proposed' || card.stage === 'voted'));
const rest = LIVE_STUDIO.cards.filter((card) => !open.includes(card));
const extra = { ...open[1]!, id: '10000000-0000-4000-8000-000000009999', title: 'One more open card to fund', created_at: '2026-09-22T00:01:00Z' };
for (const count of [1, 2, 4, 5, 7]) {
  const cards = count <= open.length ? open.slice(0, count) : [...open, extra];
  auditRoutes(`home with ${count} open ${count === 1 ? 'card' : 'cards'}`, { ...LIVE_STUDIO, cards: [...cards, ...rest] }, [768, 1024, 1440], ['/', '/contribute']);
}
auditRoutes(
  'home with a card that has no brief',
  { ...LIVE_STUDIO, cards: LIVE_STUDIO.cards.map((card) => (card === open[1] ? { ...card, intent: '' } : card)) },
  [768, 1024, 1440],
  ['/'],
);

// While the data loads the page may be short, but its title holds still: the signal plate does not
// grow to fill the window and set the title at its foot, only to jump back when the data arrives.
// The title moves by no more than the header's own content under it changes (a notice or a version
// line that arrives with the data).
for (const width of [375, 768, 1440]) {
  test(`every title holds still while the data loads, at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    let release = () => {};
    let held = Promise.resolve();
    await page.route(`${SUPABASE_URL}/rest/v1/**`, async (route) => {
      await held;
      await route.fallback();
    });
    const measure = () =>
      page.evaluate(() => {
        const h1 = document.querySelector('main h1')!;
        const hero = h1.parentElement!;
        return { top: h1.getBoundingClientRect().top, under: hero.getBoundingClientRect().bottom - h1.getBoundingClientRect().bottom };
      });
    const moved: string[] = [];
    for (const path of ROUTES) {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const loading = await measure();
      release();
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, undefined, { timeout: 5_000 }).catch(() => {});
      const loaded = await measure();
      const shift = Math.abs(loaded.top - loading.top);
      if (shift > Math.abs(loaded.under - loading.under) + 1) moved.push(`${path}: the title moved ${Math.round(shift)}px`);
    }
    expect(moved).toEqual([]);
  });
}

// The audit bites: a page with each kind of gap planted in it gets a finding for each.
test('finds each planted gap', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.setContent(`<!doctype html><html><body style="margin:0;font:16px/1.5 sans-serif">
    <header class="topbar" style="height:60px;background:#1a2fc8"></header>
    <main>
      <div class="band" style="padding:40px;background:#fff">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div><p>A short column.</p></div>
          <div><p style="height:900px;border:1px solid #111">A tall column.</p></div>
        </div>
      </div>
      <div class="band" style="padding:40px;background:#111;color:#fff">
        <p>A block.</p>
        <p style="margin-top:400px">A block far below it.</p>
      </div>
      <div class="band" style="padding:40px;background:#fff">
        <p style="margin:0 0 40px">A block.</p>
        <p style="margin:0 0 8px">A caption that hugs the heading below it.</p>
        <h2 style="margin:0 0 16px">The next section</h2>
        <ul class="card-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;list-style:none;padding:0">
          <li style="border:2px solid #111;height:80px">One</li><li style="border:2px solid #111;height:80px">Two</li>
          <li style="border:2px solid #111;height:80px">Three</li><li style="border:2px solid #111;height:80px">Four</li>
        </ul>
        <p style="width:1400px">A line wider than the page.</p>
      </div>
    </main>
    <div style="height:20px"></div>
    <footer class="site-footer" style="height:60px;background:#111"></footer>
  </body></html>`);
  const findings = await page.evaluate(auditLayout, LIMITS);
  for (const kind of ['balance:', 'hollow:', 'grid fill:', 'overflow:', 'seam:', 'rhythm:']) {
    expect(findings.some((line) => line.startsWith(kind)), `${kind} in ${JSON.stringify(findings)}`).toBe(true);
  }
});
