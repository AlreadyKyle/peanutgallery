import { auditLayout, LIMITS } from '../scripts/layout-audit.mjs';
import type { Page } from '@playwright/test';
import { DEFAULT_STUDIO, expect, fundingOrder, moneyRow, test, type StudioFixture } from './fixtures';
import { LIVE_STUDIO } from './live-studio';
import { SUPPORTER_ROUTES, SUPPORTER_STUDIO } from './supporter-studio';

// Layout balance (DESIGN.md, No dead space; docs/specs/home-and-design.md): on every public route,
// with realistic data, nothing leaves dead space. scripts/layout-audit.mjs holds the checks: no
// element past the viewport, no seam between bands, side-by-side blocks within max(160px, 35%) of
// each other, no run of empty space over 240px inside a band, grids with one item in each cell, a
// framed card or row that fills its frame to within 2px, card rows that line up with no hollow over
// 80px, headings spaced from the block above at least as far as that block from its own, buttons on
// one line, no orphaned glyph and a one-row top bar.
// /reports: two reports on the launch-shaped studio, none (the empty state) on the default fixture
// (docs/specs/studio-reports.md).
const ROUTES = ['/', '/contribute', '/ledger', '/how-it-works', '/team', '/roadmap', '/reports', '/terms', '/terms/1', '/privacy', '/refunds', '/refunds/1', '/contact', '/no-such-page', '/design-kit-7q4m'];

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
// The supporter pages (docs/specs/supporter-pages.md): /card/:id live, building and rejected, /thanks
// recorded, pending and not counted, /team with every running role paused and /roadmap with an
// opens-soon and a held card.
auditRoutes('the supporter pages', SUPPORTER_STUDIO, [375, 768, 1440], SUPPORTER_ROUTES.map(([, path]) => path));
// The default fixture: a building-free studio with a picked card, a queued card and two shipped.
auditRoutes('the default fixture', DEFAULT_STUDIO, [375, 768, 1440]);
// Nothing loaded that could be empty: no roles (home draws no team strip), no actions, no deploys.
// No contributions yet in Money in and no stopped cards, so the ledger draws its shortest bands.
auditRoutes('an empty studio', { ...LIVE_STUDIO, roles: [], events: [], deploys: [], money: moneyRow(), stopped: [] }, [375, 1440], ['/', '/team', '/ledger', '/how-it-works', '/contribute']);
// public_money and public_stopped_cards failing, as production reads them until money-logic's
// migration is applied: the Funding band's Not on a card yet row says "Not available right now." in
// place of its figure, which must not squeeze the label and description into a sliver at 320px.
auditRoutes('the money reads failing', { ...LIVE_STUDIO, money: null, stopped: null }, [320, 375, 768, 1440], ['/ledger', '/contribute', '/']);

// Home with each count of open cards a row can end on (one cell each, the last row part-empty), and
// one card with no brief.
const open = LIVE_STUDIO.cards.filter((card) => card.horizon === 'now' && (card.stage === 'proposed' || card.stage === 'voted'));
const rest = LIVE_STUDIO.cards.filter((card) => !open.includes(card));
const extra = { ...open[1]!, id: '10000000-0000-4000-8000-000000009999', title: 'One more open card to fund', created_at: '2026-09-22T00:01:00Z' };
for (const count of [1, 2, 4, 5, 7]) {
  const cards = count <= open.length ? open.slice(0, count) : [...open, extra];
  // Every open card takes money, so each is in the waterfall's order and draws its Fund this card.
  const money = { ...LIVE_STUDIO.money, funding_order: fundingOrder(cards.map((card) => card.id)) };
  auditRoutes(`home with ${count} open ${count === 1 ? 'card' : 'cards'}`, { ...LIVE_STUDIO, cards: [...cards, ...rest], money }, [768, 1024, 1440], ['/', '/contribute']);
}
// An open card the waterfall's order leaves out (a vetoed card): it takes no money, so it must not sit
// in a row of Fund this card buttons without one, which misaligns the row's bars.
auditRoutes(
  'home with an open card left out of the funding order',
  { ...LIVE_STUDIO, money: { ...LIVE_STUDIO.money, funding_order: fundingOrder(open.slice(0, -1).map((card) => card.id)) } },
  [768, 1024, 1440],
  ['/', '/contribute'],
);
// An open card the Game Designer drafted: its byline takes the card's own track (styles.css, the card
// subgrid), so it sits on no bar and the cards beside it keep their bars in line with no hollow.
const designer = LIVE_STUDIO.roles.find((role) => role.title === 'Game Designer')!;
auditRoutes(
  'home with an open card an agent drafted',
  { ...LIVE_STUDIO, cards: LIVE_STUDIO.cards.map((card) => (card === open[0] ? { ...card, source: 'agent', drafter_role_id: designer.id } : card)) },
  [768, 1024, 1440],
  ['/', '/roadmap'],
);
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
    // The site's own documents (/api/live, /api/cards): the page's every data read.
    await page.route('**/api/**', async (route) => {
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
    <header class="topbar" style="height:60px;background:#111111"></header>
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
          <li style="border:2px solid #111;height:80px;grid-column:span 2">One, stretched over two columns</li>
          <li style="border:2px solid #111;height:80px">Two</li>
          <li style="border:2px solid #111;height:80px;grid-column-start:2">Three, starting a row in its second column</li>
        </ul>
        <p style="width:1400px">A line wider than the page.</p>
        <figure style="margin:0;padding:16px;border:1px dashed #111;max-width:704px">
          <figcaption>Example with made-up figures</figcaption>
          <ul style="display:grid;grid-template-columns:minmax(0,368px);list-style:none;margin:0;padding:0">
            <li style="border:2px solid #111;height:80px">A lone card half the frame's width</li>
          </ul>
        </figure>
      </div>
    </main>
    <div style="height:20px"></div>
    <footer class="site-footer" style="height:60px;background:#111"></footer>
  </body></html>`);
  const findings = await page.evaluate(auditLayout, LIMITS);
  for (const kind of ['balance:', 'hollow:', 'grid cells:', 'frame:', 'overflow:', 'seam:', 'rhythm:']) {
    expect(findings.some((line) => line.startsWith(kind)), `${kind} in ${JSON.stringify(findings)}`).toBe(true);
  }
  // Both grid-cell faults are found: the item over two columns and the row that starts inside.
  const cells = findings.filter((line) => line.startsWith('grid cells:'));
  expect(cells.some((line) => /spans more than one column/.test(line)), JSON.stringify(cells)).toBe(true);
  expect(cells.some((line) => /starts \d+px in/.test(line)), JSON.stringify(cells)).toBe(true);
});

// A part-empty last row is correct (the board, 26 Sep 2026; PLAN §10 decision 49): four items in
// three columns, one to a cell, leave two cells of the last row empty and draw no finding.
test('passes a grid whose last row is part-empty', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.setContent(`<!doctype html><html><body style="margin:0;font:16px/1.5 sans-serif">
    <ul class="card-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;list-style:none;margin:0;padding:0">
      <li style="border:2px solid #111;height:80px">One</li><li style="border:2px solid #111;height:80px">Two</li>
      <li style="border:2px solid #111;height:80px">Three</li><li style="border:2px solid #111;height:80px">Four</li>
    </ul></body></html>`);
  expect(await page.evaluate(auditLayout, LIMITS)).toEqual([]);
});

// A link or chip alone on a wrapped line (the footer's Discord at 375px, the review of 26 Sep 2026):
// six 46px-plus links in a 335px row leave the last on a line of its own, which the old 32px rule let
// through. A row stacked one link to a line is a column, a line of text pieces (spans) wraps as prose
// does, and the same links in a grid of equal columns, one to a cell, draw nothing.
test('finds a link alone on a wrapped line, and passes a column, a line of text and a grid', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  // Six 50px links: five and their gaps fill 314px, so in a 320px row the sixth wraps alone.
  const links = ['Weekly reports', 'Terms', 'Privacy', 'Refunds', 'Contact', 'Discord'].map((word) => `<li style="width:50px;overflow:hidden"><a href="#" style="display:inline-flex;min-height:44px;align-items:center">${word}</a></li>`).join('');
  const html = (body: string) => `<!doctype html><html><body style="margin:0;padding:0 20px;font:14px/1.5 sans-serif">${body}</body></html>`;
  const ul = (style: string) => `<ul style="list-style:none;margin:0;padding:0;gap:8px 16px;${style}">${links}</ul>`;
  const found = async (kinds: string[]) => (await page.evaluate(auditLayout, LIMITS)).filter((line) => kinds.some((kind) => line.startsWith(kind)));
  await page.setContent(html(ul('display:flex;flex-wrap:wrap;max-width:320px')));
  expect(await found(['orphan:'])).toEqual([expect.stringMatching(/^orphan: li "Discord" alone on a line of ul/)]);
  // One link to a line is a column.
  await page.setContent(html(ul('display:flex;flex-wrap:wrap;max-width:60px')));
  expect(await found(['orphan:'])).toEqual([]);
  // Three 150px pieces of a meta line wrap two and one, as text does.
  await page.setContent(html(`<p style="display:flex;flex-wrap:wrap;gap:0 8px;margin:0;max-width:320px">${'<span style="width:150px">A piece of the meta line</span>'.repeat(3)}</p>`));
  expect(await found(['orphan:'])).toEqual([]);
  // The footer's fix: equal columns, one link to a cell.
  await page.setContent(html(ul('display:grid;grid-template-columns:repeat(auto-fill,minmax(6.5rem,1fr));max-width:320px')));
  expect(await found(['orphan:', 'grid cells:'])).toEqual([]);
});

// A dashed frame that hugs its lone card (width: fit-content, as /how-it-works draws it) is filled
// by it, and a bordered box that holds only a short line of text is not checked: prose ends where it
// ends. Neither draws a frame finding.
test('passes a frame its card fills and a box that holds only text', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.setContent(`<!doctype html><html><body style="margin:0;font:16px/1.5 sans-serif">
    <figure style="margin:0;padding:16px;border:1px dashed #111;width:fit-content;max-width:704px">
      <figcaption>Example with made-up figures</figcaption>
      <ul style="display:grid;grid-template-columns:minmax(0,368px);list-style:none;margin:0;padding:0">
        <li style="border:2px solid #111;height:80px">A lone card</li>
      </ul>
    </figure>
    <p style="margin:24px 0 0;padding:16px;border:1px solid #111;max-width:704px">A short notice.</p>
  </body></html>`);
  expect(await page.evaluate(auditLayout, LIMITS)).toEqual([]);
});

// A closed disclosure draws only its summary: the brief inside a card's closed "What the agents are
// told" is laid out but not painted, so it never makes a card look taller than its neighbour. Open,
// the same brief is drawn and counts.
test('counts only the summary of a closed disclosure as drawn', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  const card = (open: boolean) => `<li style="border:2px solid #111;padding:16px"><h3>A card</h3>
    <details${open ? ' open' : ''}><summary>What the agents are told</summary><p style="height:900px">A long brief.</p></details></li>`;
  const grid = (open: boolean) => `<!doctype html><html><body style="margin:0;font:16px/1.5 sans-serif">
    <ul style="display:grid;grid-template-columns:1fr 1fr;gap:24px;list-style:none;padding:0;align-items:start">
      ${card(open)}<li style="border:2px solid #111;padding:16px"><h3>Its neighbour</h3><p>Short.</p></li>
    </ul></body></html>`;
  await page.setContent(grid(false));
  expect((await page.evaluate(auditLayout, LIMITS)).filter((line) => line.startsWith('balance:'))).toEqual([]);
  await page.setContent(grid(true));
  expect((await page.evaluate(auditLayout, LIMITS)).some((line) => line.startsWith('balance:'))).toBe(true);
});

