import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser } from '@playwright/test';
import { loadConfigFromDir } from '../bots/config';
import { greedyTick } from '../bots/greedy';
import { serializeState } from '../sim/save';
import { createSim } from '../sim/sim';

// The game's frames for the gate's frames job and the Game Director's visual review
// (docs/specs/design-review.md): the canvas at four fixed states and the page at 375px. Each state is
// built here from the sim with seed 1, stepped a second at a time as the headless bot steps it
// (bots/greedy.ts), and saved under the key the game already reads, so there is no save file to keep
// and nothing on the page tells the game it is being drawn. The page clock is fixed and paused, and
// each draw advances it 3 seconds, so the same build draws the same pixels: every state is drawn
// twice and the two must be byte-identical. Set E2E_FRAMES to a folder to save the frames as
// game-<seconds>.png and page-375.png; without it they are drawn and compared, not saved. A request
// to any origin but the preview fails the run.
const FRAMES = process.env.E2E_FRAMES ?? '';
const SEED = 1;
const STATES = [0, 600, 3_600, 21_600];
const START = Date.parse('2026-01-01T12:00:00Z');
const RUN_MS = 3_000;

const here = (file: string): string => fileURLToPath(new URL(file, import.meta.url));
const SAVE_KEY = /export const SAVE_KEY = '([^']+)'/.exec(readFileSync(here('../render/scene.ts'), 'utf8'))?.[1];
const config = loadConfigFromDir(here('../config'));

function stateAt(seconds: number): string {
  let state = createSim(config, SEED);
  for (let tick = 1; tick <= seconds; tick += 1) state = greedyTick(state, config);
  return serializeState(state);
}

interface Drawn {
  canvas: Buffer;
  page: Buffer;
  refused: string[];
}

// One draw in a fresh browser context: the save in local storage, a paused page clock, the page
// loaded, the canvas awaited, then 3 seconds of game time.
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
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await canvas.waitFor();
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
