import { expect, test, type Page } from '@playwright/test';

// Seeds (docs/specs/final-state.md, Seeds and instances; render/seed-code.ts, render/seed-ui.ts): a
// link https://play.mobmachine.games/?seed=dust:v1:<base64url(save JSON)> offers its run and never
// replaces the player's own save without asking; "Save as seed" copies such a link. The codes are
// built here from plain JSON, never by importing the game's code: every file this spec imports is a
// package (platform/dispatcher/test/frames-kernel.test.ts).

const SAVE_KEY = 'dust.save';
const BACKUP_KEY = 'dust.save.before-seed';

function state(dust: number, totalDust: number, gatherers: number) {
  return {
    seed: 7,
    rngState: 123456,
    elapsedSeconds: 900,
    dust,
    totalDust,
    owned: { gatherer: gatherers, cart: 2, mill: 0, forge: 0, foundry: 0 },
    unlocked: [
      { id: 'cart', atSeconds: 90 },
      { id: 'mill', atSeconds: 500 },
    ],
  };
}

function seedCode(value: unknown): string {
  return `dust:v1:${Buffer.from(JSON.stringify({ version: 1, state: value })).toString('base64url')}`;
}

async function savedTotal(page: Page, key: string): Promise<number | null> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw === null ? null : (JSON.parse(raw) as { state: { totalDust: number } }).state.totalDust;
  }, key);
}

const OWN = { version: 1, savedAt: Date.parse('2026-01-01T12:00:00Z'), state: state(40, 300, 3) };
const SHARED = state(1500, 4321, 12);

test('a seed link offers its run and keeps the player game when they say so', async ({ page }) => {
  await page.addInitScript(([key, value]) => {
    if (window.sessionStorage.getItem('planted') === null) {
      window.localStorage.setItem(key, value);
      window.sessionStorage.setItem('planted', '1');
    }
  }, [SAVE_KEY, JSON.stringify(OWN)] as const);
  await page.goto(`/?seed=${seedCode(SHARED)}`);
  const dialog = page.getByRole('dialog', { name: 'Someone shared a Dust run' });
  await expect(dialog).toBeVisible();
  // 25 unlocks in the live config since the layers after the units (docs/specs/final-state.md, Games).
  await expect(dialog).toContainText('4,321 dust and 2 of 25 unlocks.');
  await expect(dialog).toContainText('replaces your game in this browser');
  await dialog.getByRole('button', { name: 'Keep my game' }).click();
  await expect(dialog).toBeHidden();
  expect(new URL(page.url()).search).toBe('');
  expect(await savedTotal(page, SAVE_KEY)).toBeLessThan(4321);
});

test('starting from a seed loads its run and keeps the old save as a backup', async ({ page }) => {
  await page.addInitScript(([key, value]) => {
    if (window.sessionStorage.getItem('planted') === null) {
      window.localStorage.setItem(key, value);
      window.sessionStorage.setItem('planted', '1');
    }
  }, [SAVE_KEY, JSON.stringify(OWN)] as const);
  await page.goto(`/?seed=${seedCode(SHARED)}`);
  await page.getByRole('button', { name: 'Start from this seed' }).click();
  await page.waitForURL((url) => url.search === '');
  await expect(page.getByRole('button', { name: /^Buy Gatherer: costs [\d,]+ dust, 12 owned$/ })).toBeAttached();
  expect(await savedTotal(page, BACKUP_KEY)).toBe(300);
  await expect(page.getByRole('dialog')).toBeHidden();
});

// The benchmarks' counters (docs/specs/counter-senders.md): a seed link that opens counts
// dust_seed_open, Save as seed counts dust_seed_save, each once in the page load, each the event's
// name alone to this origin's /api/count.
test('a seed link and Save as seed are each counted once, by name alone', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  const events: string[] = [];
  await page.route('**/api/count', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(new URL(request.url()).search).toBe('');
    expect(await request.headerValue('cookie')).toBeNull();
    events.push(String((JSON.parse(request.postData() ?? '{}') as { event?: unknown }).event));
    await route.fulfill({ status: 204 });
  });
  await page.goto(`/?seed=${seedCode(SHARED)}`);
  const dialog = page.getByRole('dialog', { name: 'Someone shared a Dust run' });
  await dialog.getByRole('button', { name: 'Keep my game' }).click();
  await expect.poll(() => events.filter((event) => event === 'dust_seed_open')).toHaveLength(1);
  const save = page.getByRole('button', { name: 'Save as seed' });
  await save.click();
  await save.click();
  await expect.poll(() => events.filter((event) => event === 'dust_seed_save')).toHaveLength(1);
  expect(events.filter((event) => event === 'dust_seed_save')).toHaveLength(1);
  expect(events).toContain('dust_load');
  expect(events.filter((event) => event.startsWith('dust_return'))).toEqual([]);
});

test('a load from a save a day old counts dust_return_1d, read from the save it already holds', async ({ page }) => {
  const events: string[] = [];
  await page.route('**/api/count', async (route) => {
    events.push(String((JSON.parse(route.request().postData() ?? '{}') as { event?: unknown }).event));
    await route.fulfill({ status: 204 });
  });
  await page.addInitScript(([key, value]) => {
    const save = JSON.parse(value) as { savedAt: number };
    save.savedAt = Date.now() - 30 * 60 * 60 * 1000;
    window.localStorage.setItem(key, JSON.stringify(save));
  }, [SAVE_KEY, JSON.stringify(OWN)] as const);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Strike' })).toBeAttached();
  await expect.poll(() => events).toContain('dust_return_1d');
  expect(events.filter((event) => event.startsWith('dust_return'))).toEqual(['dust_return_1d']);
  // Counting stores nothing: the keys are the game's own save and its last visit (render/whats-new.ts).
  for (const key of await page.evaluate(() => Object.keys(window.localStorage))) expect(['dust.save', 'dust.lastVisit']).toContain(key);
});

test('a broken seed link opens the player own game and says so', async ({ page }) => {
  await page.goto('/?seed=dust:v1:not-a-real-seed');
  await expect(page.getByRole('button', { name: 'Strike' })).toBeAttached();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#share-status')).toHaveText('That seed link did not open, so here is your own game.');
});

test('Save as seed copies a link that opens the same run', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify({ version: 1, state: SHARED })] as const);
  await page.goto('/');
  await page.evaluate(() => {
    // The share sheet, where a browser has one, would take the link instead; this checks the clipboard path.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  await page.getByRole('button', { name: 'Save as seed' }).click();
  await expect(page.locator('#share-status')).toHaveText('Copied a seed link to the clipboard.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const link = /https:\/\/play\.mobmachine\.games\/\?seed=(dust:v1:[A-Za-z0-9_-]+)/.exec(copied);
  expect(link).not.toBeNull();
  const body = JSON.parse(Buffer.from(link![1]!.slice('dust:v1:'.length), 'base64url').toString('utf8')) as { version: number; state: { owned: Record<string, number> } };
  expect(body.version).toBe(1);
  expect(body.state.owned['gatherer']).toBe(12);
});
