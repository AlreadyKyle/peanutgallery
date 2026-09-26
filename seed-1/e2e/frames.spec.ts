import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser } from '@playwright/test';

// The game's frames for the gate's frames job and the Game Director's visual review
// (docs/specs/design-review.md): the canvas at four fixed states and the page at 375px. The states
// are the sim with seed 1 at 0, 600, 3,600 and 21,600 seconds, each as the save the game reads, from
// the JSON file named by E2E_FRAME_STATES that e2e/frame-states.ts writes. This spec only reads that
// file: the sim is code a card can change, and the frames job runs this spec on the change, so the job
// makes the file from the base commit before the change's draw, and `pnpm e2e` makes it from the
// checkout first for a local run. Every file this spec and the Playwright config import is kernel
// (platform/dispatcher/test/frames-kernel.test.ts). The saves go under the key the game already reads,
// so there is no save file to keep. The page clock is fixed and paused, and each draw advances it 3
// seconds, so the same build draws the same pixels: every state is drawn twice and the two must be
// byte-identical. Set E2E_FRAMES to a folder to save the frames as game-<seconds>.png and
// page-375.png; without it they are drawn and compared, not saved. A request to any origin but the
// preview fails the run.
const FRAMES = process.env.E2E_FRAMES ?? '';
const STATES_FILE = process.env.E2E_FRAME_STATES ?? '';
const STATES = [0, 600, 3_600, 21_600];
const START = Date.parse('2026-01-01T12:00:00Z');
const RUN_MS = 3_000;

const here = (file: string): string => fileURLToPath(new URL(file, import.meta.url));
// Read as text, never imported: render/scene.ts is card code.
const SAVE_KEY = /export const SAVE_KEY = '([^']+)'/.exec(readFileSync(here('../render/scene.ts'), 'utf8'))?.[1];

// The saves by seconds, read once from E2E_FRAME_STATES.
let saves: Record<string, unknown> | null = null;

function stateAt(seconds: number): string {
  if (STATES_FILE === '') throw new Error('E2E_FRAME_STATES names no states file: run `pnpm --filter @backseat/seed-1 e2e`, which writes one');
  saves ??= JSON.parse(readFileSync(STATES_FILE, 'utf8')) as Record<string, unknown>;
  const save = saves[String(seconds)];
  if (typeof save !== 'string' || save === '') throw new Error(`${STATES_FILE} holds no save for ${seconds} s`);
  return save;
}

interface Drawn {
  canvas: Buffer;
  page: Buffer;
  refused: string[];
}

// One draw in a fresh browser context: the save in local storage, a paused page clock, the page
// loaded, the canvas awaited, the game loop awaited, then 3 seconds of game time. Phaser starts its
// loop only once its built-in textures have decoded, which takes real time, so the clock runs only
// after the page has asked for its first animation frame: otherwise a slow decode would start the
// loop partway through the 3 seconds and the game would draw a frame's worth less. The frame count
// is read by a wrapper around the page clock's own requestAnimationFrame; the game sees no change.
async function draw(browser: Browser, baseURL: string, save: string, viewport: { width: number; height: number }): Promise<Drawn> {
  const context = await browser.newContext({ baseURL, viewport });
  const page = await context.newPage();
  const origin = new URL(baseURL).origin;
  const refused: string[] = [];
  await page.route(
    (url) => url.origin !== origin,
    async (route) => {
      refused.push(route.request().url());
      await route.abort('blockedbyclient');
    },
  );
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [SAVE_KEY!, save] as const);
  await page.clock.install({ time: START });
  await page.clock.pauseAt(START + 1_000);
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const counted = window as unknown as { framesRequested: number };
    counted.framesRequested = 0;
    window.requestAnimationFrame = (callback) => {
      counted.framesRequested += 1;
      return request(callback);
    };
  });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await canvas.waitFor();
  await page.waitForFunction(() => (window as unknown as { framesRequested: number }).framesRequested > 0);
  // The paused clock stopped a few real milliseconds into the document, a different few each time,
  // and Phaser took its start time there. A jump to a fixed time makes the first frame's gap over
  // 200 ms, which Phaser replaces with its steady step, so every draw runs the same frames.
  await page.clock.pauseAt(START + 2_000);
  await page.clock.runFor(RUN_MS);
  const drawn = { canvas: await canvas.screenshot(), page: await page.screenshot({ fullPage: true }), refused };
  await context.close();
  return drawn;
}

function save(name: string, bytes: Buffer): void {
  if (FRAMES === '') return;
  mkdirSync(FRAMES, { recursive: true });
  writeFileSync(join(FRAMES, name), bytes);
}

test('the game reads its save under the key the spec writes', () => {
  expect(SAVE_KEY).toBeTruthy();
});

test('the states file holds a save for every state and nothing else', () => {
  for (const seconds of STATES) expect(stateAt(seconds).length).toBeGreaterThan(0);
  expect(Object.keys(saves!).sort()).toEqual(STATES.map(String).sort());
});

for (const seconds of STATES) {
  test(`draws the canvas at ${seconds} s the same way twice`, async ({ browser, baseURL }) => {
    const saved = stateAt(seconds);
    const first = await draw(browser, baseURL!, saved, { width: 1280, height: 720 });
    const second = await draw(browser, baseURL!, saved, { width: 1280, height: 720 });
    expect(first.refused).toEqual([]);
    expect(second.refused).toEqual([]);
    expect(first.canvas.equals(second.canvas), 'two draws of the same state differ').toBe(true);
    save(`game-${seconds}.png`, first.canvas);
  });
}

test('draws the page at 375px the same way twice', async ({ browser, baseURL }) => {
  const saved = stateAt(STATES[0]!);
  const first = await draw(browser, baseURL!, saved, { width: 375, height: 812 });
  const second = await draw(browser, baseURL!, saved, { width: 375, height: 812 });
  expect(first.refused).toEqual([]);
  expect(first.page.equals(second.page), 'two draws of the page differ').toBe(true);
  save('page-375.png', first.page);
});
