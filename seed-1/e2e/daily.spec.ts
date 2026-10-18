import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Request } from '@playwright/test';

// Daily Dust (docs/specs/daily-dust.md; render/daily.ts, render/daily-ui.ts): "Today's run" opens
// ?daily=<today, UTC>, the same four-minute run for everyone, kept under dust.daily and never in the
// player's own save; at its end the result opens with a card drawn in code and text to share. Every
// file this spec imports is a package (platform/dispatcher/test/frames-kernel.test.ts), so the day's
// seed is worked out here as the sim works it out: the first 32 bits of the sim's two-pass FNV-1a
// hash (sim/hash.ts) of "dust-daily:<date>". Set E2E_DAILY_SHOTS to a folder to save the result
// card's page at 390 and 1440 pixels wide.

const SAVE_KEY = 'dust.save';
const DAILY_KEY = 'dust.daily';
const SHOTS = process.env.E2E_DAILY_SHOTS ?? '';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const today = (): string => new Date().toISOString().slice(0, 10);
const longDate = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

function daySeed(date: string): number {
  const text = `dust-daily:${date}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const OWN = JSON.stringify({
  version: 1,
  savedAt: Date.parse('2026-01-01T12:00:00Z'),
  state: {
    seed: 7,
    rngState: 123456,
    elapsedSeconds: 900,
    dust: 40,
    totalDust: 300,
    owned: { gatherer: 3, cart: 2, mill: 0, forge: 0, foundry: 0 },
    unlocked: [{ id: 'cart', atSeconds: 90 }],
  },
});

// A run four seconds from its end: seven half-minute marks behind it and two dust devils caught.
function nearlyOver(date: string): string {
  const seed = daySeed(date);
  return JSON.stringify({
    version: 1,
    date,
    state: {
      seed,
      rngState: seed,
      elapsedSeconds: 236,
      dust: 2500,
      totalDust: 14000,
      owned: { gatherer: 12, cart: 4, mill: 1, forge: 0, foundry: 0 },
      unlocked: [
        { id: 'cart', atSeconds: 13 },
        { id: 'mill', atSeconds: 36 },
      ],
    },
    marks: [120, 700, 1600, 3000, 5200, 8000, 11000],
    caught: 2,
  });
}

// Counts are fire-and-forget: the preview has no /api/count, so this answers 204 and keeps the names.
async function countsOf(page: Page): Promise<string[]> {
  const names: string[] = [];
  await page.route('**/api/count', async (route) => {
    const body = (route.request() as Request).postData() ?? '';
    try {
      names.push((JSON.parse(body) as { event: string }).event);
    } catch {
      names.push(body);
    }
    await route.fulfill({ status: 204 });
  });
  return names;
}

async function plant(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((items) => {
    if (window.sessionStorage.getItem('planted') !== null) return;
    for (const [key, value] of Object.entries(items)) window.localStorage.setItem(key, value);
    window.sessionStorage.setItem('planted', '1');
  }, entries);
}

test("Today's run opens today's run, which starts at the first strike and never touches the main save", async ({ page }) => {
  const counts = await countsOf(page);
  await plant(page, { [SAVE_KEY]: OWN });
  await page.goto('/');
  const entry = page.getByRole('link', { name: /^Today's run/ });
  await expect(entry).toBeVisible();
  if (SHOTS !== '') {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, 'daily-entry-390.png') });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await entry.click();
  await page.waitForURL((url) => url.search === `?daily=${today()}`);
  // The main game wrote its save as the page went (time away credited, as ever); from here it stays put.
  const own = await page.evaluate((key) => window.localStorage.getItem(key), SAVE_KEY);
  expect(own).not.toBeNull();
  const line = page.locator('#daily-words');
  await expect(line).toHaveText(`Daily Dust, ${longDate(today())}: the same run for everyone. It starts with your first strike.`);
  await expect(page.getByRole('button', { name: 'Share your run' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Back to my game' })).toBeVisible();
  await page.getByRole('button', { name: 'Strike' }).click();
  await expect(line).toContainText(/: 0:0[1-9] of 4:00 played$/, { timeout: 15_000 });
  // The record lands under its own key (on pagehide, here a reload), and the main save is as planted.
  await page.reload();
  const stored = await page.evaluate(([own, daily]) => ({ own: window.localStorage.getItem(own), daily: window.localStorage.getItem(daily) }), [SAVE_KEY, DAILY_KEY] as const);
  expect(stored.own).toBe(own);
  const record = JSON.parse(stored.daily ?? '{}') as { date: string; state: { seed: number; elapsedSeconds: number } };
  expect(record.date).toBe(today());
  expect(record.state.seed).toBe(daySeed(today()));
  expect(record.state.elapsedSeconds).toBeGreaterThan(0);
  expect(counts.filter((name) => name === 'dust_daily_start')).toHaveLength(1);
  // Back to the player's own game: the planted save, with its time away credited as ever.
  await page.getByRole('link', { name: 'Back to my game' }).click();
  await page.waitForURL((url) => url.search === '');
  await expect(page.getByRole('button', { name: /^Buy Gatherer: costs [\d,]+ dust, 3 owned$/ })).toBeAttached();
});

test('a daily run ends at four minutes with a result to share as text and as a card', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const counts = await countsOf(page);
  await plant(page, { [SAVE_KEY]: OWN, [DAILY_KEY]: nearlyOver(today()) });
  await page.goto(`/?daily=${today()}`);
  await page.getByRole('button', { name: 'Strike' }).click();
  const dialog = page.getByRole('dialog', { name: `Daily Dust · ${longDate(today())}` });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#daily-words')).toHaveText(`Daily Dust, ${longDate(today())}: run over.`);
  const text = (await dialog.locator('.daily-text').textContent()) ?? '';
  const lines = text.split('\n');
  expect(lines).toHaveLength(5);
  expect(lines[0]).toBe(`Daily Dust · ${longDate(today())}`);
  expect(lines[1]).toMatch(/^[\d,]+ dust in 4 minutes$/);
  expect(lines[2]).toMatch(/^[▁▂▃▄▅▆▇█]{8}$/);
  expect(lines[3]).toMatch(/^\d+ of \d+ unlocks · 2 dust devils caught$/);
  expect(lines[4]).toBe(`https://play.mobmachine.games/?daily=${today()}`);
  await expect(dialog.locator('canvas.daily-card')).toBeVisible();
  expect(counts).toContain('dust_daily_finish');

  if (SHOTS !== '') {
    mkdirSync(SHOTS, { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, `daily-result-${width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  await page.evaluate(() => {
    // The share sheet, where a browser has one, would take the text and the card; this checks the clipboard.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await dialog.getByRole('button', { name: 'Share' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Copied your Daily Dust to the clipboard.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  expect(counts).toContain('dust_daily_share');

  // Nothing played on after the end, and the main save was never written.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'See my result' }).click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate((key) => window.localStorage.getItem(key), SAVE_KEY)).toBe(OWN);
});

test('a future day opens today’s run and says so', async ({ page }) => {
  await page.goto('/?daily=2999-01-01');
  await page.waitForURL((url) => url.search === `?daily=${today()}`);
  await expect(page.locator('#share-status')).toHaveText("That day's run is not open, so here is today's.");
  await expect(page.locator('#daily-words')).toContainText(longDate(today()));
});
